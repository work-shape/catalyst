import {
  isUnknownOperationResponse,
  type LocaleCode,
  type Operation
} from "@work-shape/catalyst-api-contract";
import { refusalError, transportError } from "./errors";

export interface ApiClientOptions {
  baseUrl: string;
  /**
   * The bearer credential of every request. Without a token source the client relies on the
   * browser's session cookie instead; with one, cookies are never sent.
   */
  getToken?: () => string | undefined | Promise<string | undefined>;
  fetchImpl?: typeof fetch;
  /** Cancels this client's requests when its owning session ends. */
  signal?: AbortSignal;
  /**
   * The language every request asks the server to answer in, read at each request. A browser's
   * own Accept-Language names its settings, not the language a person chose in the interface.
   */
  locale?: LocaleCode;
  /** Only available without a token source; browser navigation cannot send a bearer token. */
  browserManagedDownloads?: boolean;
  /**
   * Called when the server answers that a method and path is no operation of its catalog:
   * this client was built for another release than the server now runs.
   */
  onUnknownOperation?: () => void;
  /**
   * Called when a successful answer does not match the schema of its operation, which reads
   * the same way: the server speaks another release's contract than this client.
   */
  onResponseMismatch?: () => void;
}

/** What one call may carry. Which parts an operation takes is decided by its descriptor. */
export interface OperationRequest {
  params?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  file?: Blob;
  idempotencyKey?: string;
  unattended?: boolean;
  signal?: AbortSignal;
  onCaughtUp?: () => void;
  onSkipped?: (value: unknown) => void;
}

/**
 * The one place a request to a catalog operation is built and sent. It resolves to a successful
 * response; a refusal, a missing answer and an abort all reject.
 */
export function createApiTransport(options: ApiClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/u, "");
  const cookieMode = options.getToken === undefined;

  const urlFor = (operation: Operation, request: Pick<OperationRequest, "params" | "query">) =>
    `${baseUrl}${operation.buildPath({ params: request.params, query: request.query })}`;

  return {
    browserManagedDownloads: cookieMode && (options.browserManagedDownloads ?? true),
    urlFor,
    reportResponseMismatch: () => options.onResponseMismatch?.(),
    async send(operation: Operation, request: OperationRequest): Promise<Response> {
      const url = urlFor(operation, request);
      const headers = new Headers();
      if (operation.response.kind === "sse") {
        headers.set("accept", "text/event-stream");
      }
      let body: FormData | string | undefined;
      if (operation.multipart) {
        if (!request.file) {
          throw new Error(`Operation "${operation.id}" needs a file`);
        }
        // No content type here: the runtime writes it together with the multipart boundary.
        body = new FormData();
        body.append("file", request.file);
      } else if (operation.body) {
        headers.set("content-type", "application/json");
        body = JSON.stringify(operation.body.parse(request.body));
      }
      if (operation.headers?.request?.includes("Idempotency-Key")) {
        headers.set("idempotency-key", request.idempotencyKey ?? createIdempotencyKey());
      }
      if (request.unattended && operation.headers?.request?.includes("Catalyst-Unattended")) {
        headers.set("catalyst-unattended", "1");
      }
      const token = await options.getToken?.();
      const sessionSignal = options.signal;
      const signal =
        sessionSignal && request.signal
          ? AbortSignal.any([sessionSignal, request.signal])
          : (sessionSignal ?? request.signal);
      if (token) {
        headers.set("authorization", `Bearer ${token}`);
      }
      const locale = options.locale;
      if (locale !== undefined) {
        headers.set("accept-language", locale);
      }

      signal?.throwIfAborted();
      let response: Response;
      try {
        response = await (options.fetchImpl ?? fetch)(url, {
          method: operation.method,
          headers,
          body,
          credentials: cookieMode ? "include" : "omit",
          signal
        });
      } catch (error) {
        throw signal?.aborted ? error : transportError(error);
      }
      if (response.ok) {
        return response;
      }
      const refusal = await refusalError(response);
      if (response.status === 404 && isUnknownOperationResponse(refusal.payload)) {
        options.onUnknownOperation?.();
      }
      throw refusal;
    }
  };
}

/** A key no other call has: 128 random bits, from the source every runtime of the client has. */
function createIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type ApiTransport = ReturnType<typeof createApiTransport>;
