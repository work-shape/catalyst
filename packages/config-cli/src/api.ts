import { isRecord } from "@work-shape/catalyst-asset-schemas";
import { setTimeout as defaultSleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import {
  MAX_LIST_LIMIT,
  RELEASE_VERSION,
  isUnknownOperationResponse,
  type Asset,
  type AssetSummary
} from "@work-shape/catalyst-api-contract";
import {
  ApiError,
  createApiClient,
  type ApiClient,
  type OperationInput
} from "@work-shape/catalyst-api-client";

import { CliVersionError, cliCompatibilityError } from "./instance-output";

export class ConfigApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly correlationId?: string;

  constructor(status: number, payload: unknown) {
    const error = readApiError(payload);
    super(error.message ?? `Catalyst API request failed with HTTP ${status}`);
    this.name = "ConfigApiError";
    this.status = status;
    this.code = error.code;
    this.details = error.details;
    this.correlationId = error.correlationId;
  }
}

export class ApiKeyExchangeError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(error: unknown, apiKey: string) {
    const status = error instanceof ConfigApiError ? error.status : undefined;
    const code = error instanceof ConfigApiError ? error.code : undefined;
    const causeMessage = error instanceof Error ? error.message : String(error);
    const statusLabel = status === undefined ? "" : ` (HTTP ${status})`;
    super(`API key exchange failed${statusLabel}: ${redactSecret(causeMessage, apiKey)}`);
    this.name = "ApiKeyExchangeError";
    this.status = status;
    this.code = code;
  }
}

export interface ConfigApiOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Waits between tries. Tests pass one that does not wait. */
  sleep?: (milliseconds: number) => Promise<void>;
  /**
   * The workspace whose own assets the working copy holds, for a root bound with
   * `--workspace`. Left out, the instance's own. The reads of assets name it.
   */
  workspaceId?: string;
}

type FetchImpl = NonNullable<ConfigApiOptions["fetchImpl"]>;

export async function createConfigApi(options: ConfigApiOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/u, "");
  const fetchImpl = instanceFetch(options.fetchImpl);
  assertSafeApiKeyExchangeUrl(baseUrl);
  const accessToken = await exchangeApiKey(fetchImpl, baseUrl, options.apiKey);
  const client = createApiClient({
    baseUrl,
    getToken: () => accessToken,
    fetchImpl
  });

  const sleep = options.sleep ?? defaultSleep;
  const scope = options.workspaceId === undefined ? {} : { workspaceId: options.workspaceId };

  /**
   * Sends one changing call, all its tries under one key: a try whose answer never arrived is
   * sent again with it, and the instance answers what the first one did instead of writing
   * twice. `unanswered` is what the caller is told when no try got an answer.
   */
  const change = async <Output>(
    request: (client: ApiClient, idempotencyKey: string) => Promise<Output>,
    unanswered: string
  ): Promise<Output> => {
    const idempotencyKey = randomUUID();
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await request(client, idempotencyKey);
      } catch (error) {
        if (isDroppedConnection(error) && attempt < CHANGE_ATTEMPTS) {
          await sleep(CHANGE_RETRY_DELAY_MS * attempt);
          continue;
        }
        if (isDroppedConnection(error)) {
          throw new Error(
            `The connection to the instance dropped ${CHANGE_ATTEMPTS} times and the call has no answer. ${unanswered}`,
            { cause: error }
          );
        }
        throw toConfigApiError(error);
      }
    }
  };

  return {
    /** Any reading operation of the instance. A refusal throws as `ConfigApiError`. */
    read: <Output>(
      request: (client: ApiClient) => Promise<Output>,
      onRateLimitWait?: (seconds: number) => void
    ): Promise<Output> => read(sleep, () => request(client), onRateLimitWait),
    change,
    /** The version of the instance's asset set and the name of its default agent. */
    getOverview: async (): Promise<{ version: number; defaultAgentName?: string }> => {
      const overview = await read(sleep, () => client.config_assets.get_overview());
      return {
        version: overview.version,
        ...(overview.defaultAgentName === undefined
          ? {}
          : { defaultAgentName: overview.defaultAgentName })
      };
    },
    /** Every asset of one kind the key may read, page by page, without its content. */
    listAssets: async (kind: string): Promise<AssetSummary[]> => {
      const assets: AssetSummary[] = [];
      let cursor: string | undefined;
      do {
        const page = await read(sleep, () =>
          client.assets.list({
            params: { kind },
            query: {
              limit: MAX_LIST_LIMIT,
              ...scope,
              ...(cursor === undefined ? {} : { cursor })
            }
          })
        );
        assets.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      return assets;
    },
    /** One asset with its content, or nothing where the instance holds none of that name. */
    getAsset: async (kind: string, name: string, files = false): Promise<Asset | undefined> => {
      try {
        return await read(sleep, () =>
          client.assets.get({
            params: { kind, name },
            query: { ...scope, ...(files ? { files: "true" as const } : {}) }
          })
        );
      } catch (error) {
        if (isMissingAsset(error)) return undefined;
        throw error;
      }
    },
    /** Who wrote the latest revision of one asset, a deleted one included. */
    getLatestRevision: async (kind: string, name: string) => {
      const page = await read(sleep, () =>
        client.assets.revisions.list({ params: { kind, name }, query: { limit: 1, ...scope } })
      );
      return page.items[0];
    },
    /** Asks whether a sync of the batch would be applied. A refusal throws as the sync's. */
    checkSync: (batch: SyncBatch) => read(sleep, () => client.assets.sync_check({ body: batch })),
    /**
     * Applies the batch, all of it or nothing. The call carries one key for all its tries: a
     * try whose answer never arrived is sent again with it, and the instance answers what the
     * first one did instead of writing twice.
     */
    syncAssets: async (batch: SyncBatch): Promise<SyncOutcome> => {
      const outcome = await change(
        (operations, idempotencyKey) => operations.assets.sync({ body: batch, idempotencyKey }),
        "It may have been applied: run 'catalyst config diff' before pushing again."
      );
      return outcome.status === "done"
        ? { status: "done", output: outcome.output }
        : { status: "pending_approval", operationRunId: outcome.run.id };
    }
  };
}

export type ConfigApi = Awaited<ReturnType<typeof createConfigApi>>;
export type SyncBatch = OperationInput<"assets.sync">["body"];
type SyncCall = Awaited<ReturnType<ReturnType<typeof createApiClient>["assets"]["sync"]>>;
export type SyncOutput = Extract<SyncCall, { status: "done" }>["output"];
export type SyncOutcome =
  | { status: "done"; output: SyncOutput }
  /** Nothing was written yet: the instance holds the push for another person's approval. */
  | { status: "pending_approval"; operationRunId: string };

/** How often one changing call is sent before a dropped connection is reported. */
const CHANGE_ATTEMPTS = 3;
const CHANGE_RETRY_DELAY_MS = 500;
/** How often a read that is over the rate limit waits and asks again. */
const READ_ATTEMPTS = 5;
/** The longest one wait for the rate limit. A longer one is reported instead. */
const MAX_RATE_LIMIT_WAIT_SECONDS = 60;

/** A reading call. Over the rate limit it waits as long as the instance says and asks again. */
async function read<Output>(
  sleep: (milliseconds: number) => Promise<void>,
  request: () => Promise<Output>,
  onRateLimitWait?: (seconds: number) => void
): Promise<Output> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      const wait = error instanceof ApiError ? error.retryAfterSeconds : undefined;
      if (wait === undefined || wait > MAX_RATE_LIMIT_WAIT_SECONDS || attempt >= READ_ATTEMPTS) {
        throw toConfigApiError(error);
      }
      onRateLimitWait?.(wait);
      await sleep(wait * 1000);
    }
  }
}

function isDroppedConnection(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status === 0 && !(error.payload instanceof CliVersionError)
  );
}

function isMissingAsset(error: unknown): boolean {
  return (
    error instanceof ConfigApiError &&
    error.status === 404 &&
    !isUnknownOperationResponse({ error: { code: error.code, details: error.details } })
  );
}

/**
 * Refuses an address a key would cross the network to in plain text. `what` names the act:
 * sending the key, or receiving it at login.
 */
export function assertSafeApiKeyExchangeUrl(url: string, what = "send CATALYST_API_KEY"): void {
  const parsed = new URL(url);
  if (parsed.protocol === "https:") {
    return;
  }
  if (parsed.protocol === "http:") {
    if (isLoopbackHostname(parsed.hostname)) {
      return;
    }
    throw new Error(
      `Refusing to ${what} over plain HTTP to '${parsed.hostname}'. Use HTTPS; HTTP is allowed only for localhost, 127.0.0.0/8, or ::1.`
    );
  }
  throw new Error(
    `Refusing to ${what} using unsupported URL scheme '${parsed.protocol}'. Use HTTPS; HTTP is allowed only for localhost, 127.0.0.0/8, or ::1.`
  );
}

/**
 * No request of this tool follows a redirect. The key and the access token are headers of a
 * request, and a followed redirect would send them to an address the caller never named.
 * The redirect comes back as the answer and is reported.
 */
function withoutRedirects(fetchImpl: FetchImpl): FetchImpl {
  return (input, init) => fetchImpl(input, { ...init, redirect: "manual" });
}

/** The fetch of every request to an instance: the one given, or the global one, never redirected. */
export function instanceFetch(
  fetchImpl?: FetchImpl,
  diagnostics: {
    checkVersion?: boolean;
    onServerVersion?: (version: string) => void;
    timeoutMs?: number;
  } = {}
): FetchImpl {
  const send = withoutRedirects(fetchImpl ?? fetch);
  return async (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    headers.set("catalyst-cli-version", RELEASE_VERSION);
    const timeout =
      diagnostics.timeoutMs === undefined ? undefined : AbortSignal.timeout(diagnostics.timeoutMs);
    const requestedSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal =
      timeout && requestedSignal
        ? AbortSignal.any([timeout, requestedSignal])
        : (timeout ?? requestedSignal);
    const response = await send(input, { ...init, headers, signal });
    const serverVersion = response.headers.get("catalyst-server-version");
    if (serverVersion !== null) {
      diagnostics.onServerVersion?.(serverVersion);
      const mismatch = cliCompatibilityError(RELEASE_VERSION, serverVersion);
      if (diagnostics.checkVersion !== false && mismatch) {
        await response.body?.cancel();
        throw mismatch;
      }
    }
    return response;
  };
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname)
  );
}

async function exchangeApiKey(
  fetchImpl: FetchImpl,
  baseUrl: string,
  apiKey: string
): Promise<string> {
  try {
    const issued = await createApiClient({
      baseUrl,
      getToken: () => apiKey,
      fetchImpl
    }).access_tokens.exchange();
    return issued.accessToken;
  } catch (error) {
    throw new ApiKeyExchangeError(toConfigApiError(error), apiKey);
  }
}

export function toConfigApiError(error: unknown): unknown {
  if (!(error instanceof ApiError)) {
    return error;
  }
  if (error.status === 0) {
    return error.payload;
  }
  if (error.status >= 300 && error.status < 400) {
    return new Error(
      `The instance answered with a redirect (HTTP ${error.status}). This tool follows none, so that the key reaches only the address it was given. Use the address the instance is served at.`
    );
  }
  if (error.responseInfo !== undefined) {
    const { url, contentType, body } = error.responseInfo;
    return new Error(
      `Catalyst API at ${url} returned ${body} (HTTP ${error.status}, ${contentType}); check the instance address with 'catalyst doctor'.`
    );
  }
  if (error.payload instanceof SyntaxError || typeof error.payload === "string") {
    return new Error(`Catalyst API returned invalid JSON (HTTP ${error.status})`);
  }
  if (error.payload instanceof Error) {
    return new Error(`Catalyst API returned an unexpected response (HTTP ${error.status})`, {
      cause: error.payload
    });
  }
  return new ConfigApiError(error.status, error.payload);
}

function readApiError(payload: unknown): {
  code?: string;
  message?: string;
  details?: unknown;
  correlationId?: string;
} {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return {};
  }
  return {
    ...(typeof payload.error.correlationId === "string"
      ? { correlationId: payload.error.correlationId }
      : {}),
    ...(typeof payload.error.code === "string" ? { code: payload.error.code } : {}),
    ...(typeof payload.error.message === "string" ? { message: payload.error.message } : {}),
    ...(payload.error.details === undefined ? {} : { details: payload.error.details })
  };
}

export function redactSecret(message: string, secret: string): string {
  return secret ? message.split(secret).join("[redacted]") : message;
}
