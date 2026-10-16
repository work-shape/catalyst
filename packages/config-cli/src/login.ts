import { hostname } from "node:os";
import { createApiClient } from "@work-shape/catalyst-api-client";
import { assertSafeApiKeyExchangeUrl, instanceFetch, toConfigApiError } from "./api";
import {
  type ConfigCommandOptions,
  formatCommandError,
  resolveWorkingDir,
  writeError,
  writeOutput
} from "./command-support";
import { credentialOrigin, removeCredential, saveCredential } from "./credentials";
import { readConfigCliEnv } from "./env";
import { readManifestIfPresent, resolveInstance } from "./working-copy";

/**
 * Logs in by a connect code: the instance gives a short code, the person confirms it in
 * Settings with the scopes and expiry the key gets, and this CLI collects the key with its own
 * long code and saves it. The key is never printed and never passes through a shell.
 */
export async function loginCommand(options: ConfigCommandOptions): Promise<number> {
  try {
    const url = await resolveInstanceUrl(options);
    const key = await loginByConnectCode(options, url, `catalyst CLI on ${hostname()}`);
    if (key === undefined) {
      writeError(options, "The code expired before it was confirmed. Run 'catalyst login' again.");
      return 1;
    }
    writeOutput(
      options,
      [
        `Logged in to ${credentialOrigin(url)} with the key '${key.name}' (${key.keyPrefix}…).`,
        `It may: ${key.scopes.join(", ")}, as far as your rights reach, until ${formatTime(key.expiresAt)}.`,
        `Saved in ${key.path}. See and revoke it at ${apiKeysAddress(url)}.`
      ].join("\n")
    );
    return 0;
  } catch (error) {
    writeError(options, formatCommandError(error));
    return 1;
  }
}

/** The key a confirmed connect code issued, as it was saved. It holds no secret. */
export interface ConnectedKey {
  name: string;
  keyPrefix: string;
  scopes: string[];
  expiresAt: string;
  /** The credential file it was saved in. */
  path: string;
}

/**
 * Starts a connect code under `clientLabel`, prints where to confirm it, waits for the
 * confirmation and saves the key it issues. `openUrl` also opens the address in a browser.
 * Answers nothing when the code expired unconfirmed. A refusal throws.
 */
export async function loginByConnectCode(
  options: ConfigCommandOptions,
  url: string,
  clientLabel: string,
  openUrl?: (address: string) => void
): Promise<ConnectedKey | undefined> {
  assertSafeApiKeyExchangeUrl(url, "receive an API key");
  const sleep = options.sleep ?? defaultSleep;
  const client = createApiClient({
    baseUrl: url,
    fetchImpl: instanceFetch(options.fetchImpl)
  });
  const started = await call(() => client.connect_codes.start({ body: { clientLabel } }));
  const address = `${url}${started.confirmPath}`;
  writeOutput(
    options,
    [
      `Open ${address}`,
      `and confirm the code ${started.userCode} with the scopes this key may use.`,
      `Waiting for the confirmation until ${formatTime(started.expiresAt)}…`
    ].join("\n")
  );
  openUrl?.(address);
  const deadline = Date.parse(started.expiresAt);
  while (Date.now() < deadline) {
    await sleep(started.intervalSeconds * 1000);
    const answer = await call(() =>
      client.connect_codes.redeem({ body: { deviceCode: started.deviceCode } })
    );
    if (answer.status === "pending") continue;
    const path = await saveCredential(readConfigCliEnv(options.env), url, {
      apiKey: answer.secret,
      keyId: answer.key.id,
      name: answer.key.name,
      scopes: answer.key.scopes,
      expiresAt: answer.key.expiresAt,
      savedAt: new Date().toISOString()
    });
    return {
      name: answer.key.name,
      keyPrefix: answer.key.keyPrefix,
      scopes: answer.key.scopes,
      expiresAt: answer.key.expiresAt,
      path
    };
  }
  return undefined;
}

/** Forgets the saved key of the instance. Revoking it is the interface's, in Settings. */
export async function logoutCommand(options: ConfigCommandOptions): Promise<number> {
  try {
    const url = await resolveInstanceUrl(options);
    const removed = await removeCredential(readConfigCliEnv(options.env), url);
    writeOutput(
      options,
      removed
        ? `Removed the saved key of ${credentialOrigin(url)}. It stays valid until you revoke it at ${apiKeysAddress(url)}.`
        : `No key is saved for ${credentialOrigin(url)}.`
    );
    return 0;
  } catch (error) {
    writeError(options, formatCommandError(error));
    return 1;
  }
}

/**
 * An address given as it is, or the instance `resolveInstance` selects: one named in the working
 * copy's manifest, its default, or outside a working copy the one a key is saved for.
 */
export async function resolveInstanceUrl(options: ConfigCommandOptions): Promise<string> {
  const requested = options.instance;
  if (requested !== undefined && /^https?:\/\//u.test(requested)) {
    return requested.replace(/\/+$/u, "");
  }
  const manifest = await readManifestIfPresent(resolveWorkingDir(options));
  return (await resolveInstance(manifest, options)).url;
}

/** Where the person sees and revokes their keys: Settings, You, API keys of the instance. */
export function apiKeysAddress(url: string): string {
  return `${url}/settings/you/api-keys`;
}

async function call<Output>(request: () => Promise<Output>): Promise<Output> {
  try {
    return await request();
  } catch (error) {
    throw toConfigApiError(error);
  }
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}
