import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ConfigCliEnv } from "./env";

/** A key `catalyst login` saved, under the origin of the instance it belongs to. */
export interface StoredCredential {
  apiKey: string;
  keyId: string;
  name: string;
  /** What the key may do, as it was issued. Left out by a CLI before `catalyst setup`. */
  scopes?: string[];
  expiresAt: string;
  savedAt: string;
}

interface CredentialFile {
  version: 1;
  instances: Record<string, StoredCredential>;
}

const CREDENTIALS_FILENAME = "credentials.json";

/**
 * Where saved keys live: outside every working copy, readable by the user alone.
 * `CATALYST_CONFIG_HOME` moves the folder, `XDG_CONFIG_HOME` its parent.
 */
function credentialsPath(env: ConfigCliEnv): string {
  const folder =
    env.CATALYST_CONFIG_HOME ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "catalyst");
  return resolve(folder, CREDENTIALS_FILENAME);
}

/** A key is sent to the origin it was saved for and to nothing else. */
export function credentialOrigin(url: string): string {
  return new URL(url).origin;
}

export async function readStoredCredential(
  env: ConfigCliEnv,
  url: string
): Promise<StoredCredential | undefined> {
  return (await readCredentialFile(credentialsPath(env))).instances[credentialOrigin(url)];
}

/** The origins a key is saved for, in the order they were first saved. */
export async function savedInstanceOrigins(env: ConfigCliEnv): Promise<string[]> {
  return Object.keys((await readCredentialFile(credentialsPath(env))).instances);
}

export async function saveCredential(
  env: ConfigCliEnv,
  url: string,
  credential: StoredCredential
): Promise<string> {
  const path = credentialsPath(env);
  const file = await readCredentialFile(path);
  file.instances[credentialOrigin(url)] = credential;
  await writeCredentialFile(path, file);
  return path;
}

/** Whether a key was saved for the origin; it is gone from the file either way. */
export async function removeCredential(env: ConfigCliEnv, url: string): Promise<boolean> {
  const path = credentialsPath(env);
  const file = await readCredentialFile(path);
  const origin = credentialOrigin(url);
  if (file.instances[origin] === undefined) return false;
  delete file.instances[origin];
  await writeCredentialFile(path, file);
  return true;
}

async function readCredentialFile(path: string): Promise<CredentialFile> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { version: 1, instances: {} };
    }
    throw error;
  }
  // As ssh does with a private key: a file others may read is refused, not used.
  if (process.platform !== "win32" && ((await stat(path)).mode & 0o077) !== 0) {
    throw new Error(
      `${path} can be read by other users of this machine. Run 'chmod 600 ${path}', or remove it and run 'catalyst login' again.`
    );
  }
  const parsed: unknown = JSON.parse(contents);
  if (!isCredentialFile(parsed)) {
    throw new Error(`${path} is not a credentials file of this CLI. Remove it and log in again.`);
  }
  return parsed;
}

async function writeCredentialFile(path: string, file: CredentialFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

function isCredentialFile(value: unknown): value is CredentialFile {
  if (typeof value !== "object" || value === null) return false;
  if (!("version" in value) || value.version !== 1) return false;
  if (!("instances" in value) || typeof value.instances !== "object" || value.instances === null) {
    return false;
  }
  return Object.values(value.instances).every(
    (entry: unknown) =>
      typeof entry === "object" &&
      entry !== null &&
      "apiKey" in entry &&
      typeof entry.apiKey === "string" &&
      "keyId" in entry &&
      typeof entry.keyId === "string" &&
      "name" in entry &&
      typeof entry.name === "string" &&
      "expiresAt" in entry &&
      typeof entry.expiresAt === "string" &&
      "savedAt" in entry &&
      typeof entry.savedAt === "string"
  );
}
