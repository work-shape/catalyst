import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Asset, PlatformContext } from "@work-shape/catalyst-api-contract";

// The folder of one App on this machine: what `catalyst app pull` writes and `push` reads. The
// folder holds the App's source files as they are, `app.yaml` at its root, and one file of
// local state that is never sent. Which files a push leaves out, and the limits it holds the
// folder to, are decided here before anything is sent; the instance checks again.

/** The local state of a pulled App. It is a dotfile, so a push never sends it. */
export const APP_STATE_FILE = ".catalyst-app.json";

/** Folder names a push leaves out wherever they are. Dot-folders are left out as well. */
const IGNORED_FOLDERS = new Set(["node_modules"]);

/** What a pull recorded: where the App lives, and the revision and files the folder holds. */
export interface AppFolderState {
  instance: string;
  workspaceId: string;
  app: string;
  assetId: string;
  /** The revision the files are of. A push names it as the revision it was made against. */
  revision: number;
  /** The SHA-256 of each file as it was pulled or pushed, by its path in the folder. */
  files: Record<string, string>;
}

/** One file a push sends. */
type AppFileInput = { path: string; text: string } | { path: string; base64: string };

interface AppFolderRead {
  files: AppFileInput[];
  /** The SHA-256 of each file sent, by its path. */
  hashes: Record<string, string>;
  /** What the folder holds and the push leaves out, by path, with the reason. */
  leftOut: string[];
}

type KindLimits = NonNullable<PlatformContext["kinds"][number]["limits"]>;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function readAppState(directory: string): Promise<AppFolderState | undefined> {
  let contents: string;
  try {
    contents = await readFile(join(directory, APP_STATE_FILE), "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
  const parsed: unknown = JSON.parse(contents);
  if (
    !isRecord(parsed) ||
    typeof parsed.instance !== "string" ||
    typeof parsed.workspaceId !== "string" ||
    typeof parsed.app !== "string" ||
    typeof parsed.assetId !== "string" ||
    typeof parsed.revision !== "number" ||
    !isRecord(parsed.files)
  ) {
    throw new Error(
      `'${join(directory, APP_STATE_FILE)}' is not the state of a pulled App. Pull the App into an empty folder again.`
    );
  }
  const files: Record<string, string> = {};
  for (const [path, hash] of Object.entries(parsed.files)) {
    if (typeof hash === "string") files[path] = hash;
  }
  return {
    instance: parsed.instance,
    workspaceId: parsed.workspaceId,
    app: parsed.app,
    assetId: parsed.assetId,
    revision: parsed.revision,
    files
  };
}

export async function writeAppState(directory: string, state: AppFolderState): Promise<void> {
  const path = join(directory, APP_STATE_FILE);
  await writeFile(`${path}.tmp`, `${JSON.stringify(state, null, 2)}\n`);
  await rename(`${path}.tmp`, path);
}

/**
 * Every file a push sends, by its path in the folder. Left out, and named: dotfiles and
 * dot-folders, `node_modules`, and what is not a regular file such as a link. A dotfile the
 * App already holds, as the last pull or push recorded it, is sent like any other file, so a
 * pull and a push give the App back as it was. The limits of the kind are checked before a
 * file is read.
 */
export async function readAppFolder(
  directory: string,
  limits: KindLimits | undefined,
  tracked: ReadonlySet<string>
): Promise<AppFolderRead> {
  const stats = await lstat(directory).catch(() => undefined);
  if (!stats?.isDirectory()) {
    throw new Error(`'${directory}' is not a folder. An App is pushed from its folder.`);
  }
  const found: Array<{ path: string; absolute: string; bytes: number }> = [];
  const leftOut: string[] = [];
  await walk(directory, directory, tracked, found, leftOut);
  if (!found.some((file) => file.path === "app.yaml")) {
    throw new Error(
      `'${directory}' holds no app.yaml at its root. An App's folder starts with it.`
    );
  }
  if (limits) {
    if (found.length > limits.FILE_SET_MAX_FILES) {
      throw new Error(
        `'${directory}' holds ${found.length} files to send, and an App holds at most ${limits.FILE_SET_MAX_FILES}.`
      );
    }
    const large = found.filter((file) => file.bytes > limits.FILE_SET_MAX_FILE_BYTES);
    if (large.length > 0) {
      throw new Error(
        [
          `A file of an App holds at most ${formatBytes(limits.FILE_SET_MAX_FILE_BYTES)}. Keep larger media as Managed Files. Too large:`,
          ...large.map((file) => `- ${file.path}: ${formatBytes(file.bytes)}`)
        ].join("\n")
      );
    }
    const total = found.reduce((sum, file) => sum + file.bytes, 0);
    const cap = Math.min(limits.FILE_SET_MAX_TOTAL_BYTES, limits.ASSET_PUT_FILES_MAX_BYTES);
    if (total > cap) {
      throw new Error(
        `The files to send hold ${formatBytes(total)} together, and one push of an App carries at most ${formatBytes(cap)}.`
      );
    }
  }
  const files: AppFileInput[] = [];
  const hashes: Record<string, string> = {};
  for (const file of found.sort((left, right) => compare(left.path, right.path))) {
    const bytes = await readFile(file.absolute);
    hashes[file.path] = sha256(bytes);
    const text = utf8Text(bytes);
    files.push(
      text === undefined
        ? { path: file.path, base64: Buffer.from(bytes).toString("base64") }
        : { path: file.path, text }
    );
  }
  return { files, hashes, leftOut: leftOut.sort(compare) };
}

async function walk(
  root: string,
  directory: string,
  tracked: ReadonlySet<string>,
  found: Array<{ path: string; absolute: string; bytes: number }>,
  leftOut: string[]
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    const path = relative(root, absolute).split(sep).join("/");
    if (path === APP_STATE_FILE) continue;
    if (entry.isDirectory()) {
      const holdsTracked = [...tracked].some((file) => file.startsWith(`${path}/`));
      if (IGNORED_FOLDERS.has(entry.name) || (entry.name.startsWith(".") && !holdsTracked)) {
        leftOut.push(`${path}/`);
        continue;
      }
      await walk(root, absolute, tracked, found, leftOut);
    } else if (!entry.isFile()) {
      leftOut.push(`${path} (not a regular file)`);
    } else if (entry.name.startsWith(".") && !tracked.has(path)) {
      leftOut.push(path);
    } else {
      found.push({ path, absolute, bytes: (await lstat(absolute)).size });
    }
  }
}

/** What a folder holds that differs from the state: files changed, added and removed. */
export async function localChanges(
  directory: string,
  state: AppFolderState
): Promise<{ changed: string[]; added: string[]; removed: string[] }> {
  const read = await readAppFolder(directory, undefined, new Set(Object.keys(state.files))).catch(
    () => undefined
  );
  const now = read?.hashes ?? {};
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const [path, hash] of Object.entries(now)) {
    const before = state.files[path];
    if (before === undefined) added.push(path);
    else if (before !== hash) changed.push(path);
  }
  for (const path of Object.keys(state.files)) {
    if (now[path] === undefined) removed.push(path);
  }
  return { changed, added, removed };
}

/**
 * Writes the source files of one revision into the folder, byte for byte, and removes the
 * files of the last pull the revision no longer holds. Each file is checked against the hash
 * the instance answered before the state names it.
 */
export async function writeAppFiles(
  directory: string,
  files: NonNullable<Asset["files"]>,
  previous: AppFolderState | undefined
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  const written = new Set<string>();
  for (const file of files) {
    const target = safeTarget(directory, file.path);
    const bytes =
      file.base64 !== undefined
        ? Buffer.from(file.base64, "base64")
        : Buffer.from(file.text ?? "", "utf8");
    const hash = sha256(bytes);
    if (hash !== file.sha256) {
      throw new Error(
        `The file '${file.path}' did not arrive as the instance holds it (its SHA-256 differs). Nothing else was written after it; pull again.`
      );
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
    hashes[file.path] = hash;
    written.add(file.path);
  }
  for (const path of Object.keys(previous?.files ?? {})) {
    if (!written.has(path)) await rm(safeTarget(directory, path), { force: true });
  }
  return hashes;
}

/** Whether a folder holds anything a pull could overwrite. */
export async function folderIsEmpty(directory: string): Promise<boolean> {
  try {
    return (await readdir(directory)).length === 0;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return true;
    throw error;
  }
}

/** The place of a file the instance named, refused where it would leave the folder. */
function safeTarget(directory: string, path: string): string {
  const target = resolve(directory, path);
  if (path.includes("\\") || !target.startsWith(`${resolve(directory)}${sep}`)) {
    throw new Error(`The instance named the file '${path}', which lies outside the folder.`);
  }
  return target;
}

function utf8Text(bytes: Uint8Array): string | undefined {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return text.includes("\u0000") ? undefined : text;
  } catch {
    return undefined;
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} bytes`;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
