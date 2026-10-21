import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile
} from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { Asset } from "@work-shape/catalyst-api-contract";

/** The common baseline of a pulled folder; each kind keeps its own name and state filename. */
export interface FolderState {
  instance: string;
  workspaceId: string;
  assetId: string;
  revision: number;
  /** The SHA-256 of every file when it was pulled or pushed. */
  files: Record<string, string>;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function readFolderState(directory: string, filename: string, kind: string) {
  let contents: string;
  try {
    contents = await readFile(join(directory, filename), "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
  const parsed: unknown = JSON.parse(contents);
  if (
    !isRecord(parsed) ||
    typeof parsed.instance !== "string" ||
    typeof parsed.workspaceId !== "string" ||
    typeof parsed.assetId !== "string" ||
    typeof parsed.revision !== "number" ||
    !Number.isInteger(parsed.revision) ||
    parsed.revision < 1 ||
    !isRecord(parsed.files) ||
    typeof parsed[kind] !== "string"
  )
    throw new Error(
      `'${join(directory, filename)}' is not the state of a pulled ${kind}. Pull into an empty folder again.`
    );
  const name = parsed[kind];
  const files: Record<string, string> = {};
  for (const [path, hash] of Object.entries(parsed.files)) {
    safeTarget(directory, path);
    if (typeof hash !== "string") throw new Error(`Invalid hash for '${path}' in ${filename}.`);
    files[path] = hash;
  }
  return {
    instance: parsed.instance,
    workspaceId: parsed.workspaceId,
    assetId: parsed.assetId,
    revision: parsed.revision,
    files,
    name
  };
}

export async function writeFolderState(
  directory: string,
  filename: string,
  state: FolderState
): Promise<void> {
  const path = join(directory, filename);
  await writeFile(`${path}.tmp`, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o644 });
  await rename(`${path}.tmp`, path);
}

/** Refuse links before reading a baseline or replacing a folder, including untracked entries. */
export async function refuseLinks(directory: string, recursive = true): Promise<void> {
  let stats;
  try {
    stats = await lstat(directory);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
  if (stats.isSymbolicLink())
    throw new Error(`'${directory}' is a symbolic link. Pull into a folder without links.`);
  if (recursive && stats.isDirectory()) {
    for (const entry of await readdir(directory)) await refuseLinks(join(directory, entry));
  }
}

/** What differs from a baseline. App pulls keep their existing untracked-file exclusions. */
export async function localChanges(
  directory: string,
  state: FolderState,
  filename: string,
  ignoreUntracked = false
) {
  const now: Record<string, string> = {};
  const walk = async (folder: string, prefix: string) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      if (path === filename || (entry.name === ".DS_Store" && entry.isFile())) continue;
      const tracked =
        Object.hasOwn(state.files, path) ||
        Object.keys(state.files).some((file) => file.startsWith(`${path}/`));
      if (
        ignoreUntracked &&
        !tracked &&
        (entry.name.startsWith(".") || (entry.isDirectory() && entry.name === "node_modules"))
      )
        continue;
      if (entry.isDirectory()) await walk(join(folder, entry.name), `${path}/`);
      else {
        if (ignoreUntracked && !entry.isFile()) continue;
        if (!entry.isFile()) throw new Error(`'${path}' is not a regular file.`);
        now[path] = sha256(await readFile(join(folder, entry.name)));
      }
    }
  };
  await walk(directory, "");
  return {
    changed: Object.keys(now).filter(
      (path) => Object.hasOwn(state.files, path) && now[path] !== state.files[path]
    ),
    added: Object.keys(now).filter((path) => !Object.hasOwn(state.files, path)),
    removed: Object.keys(state.files).filter(
      (path) => basename(path) !== ".DS_Store" && !Object.hasOwn(now, path)
    )
  };
}

/** Hash and path checks shared by App pulls and staged skill pulls. */
export async function writeFolderFiles(
  directory: string,
  files: NonNullable<Asset["files"]>,
  previous?: FolderState
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const file of files) {
    const target = safeTarget(directory, file.path);
    if (basename(file.path) === ".DS_Store") continue;
    const bytes =
      file.base64 !== undefined
        ? Buffer.from(file.base64, "base64")
        : Buffer.from(file.text ?? "", "utf8");
    const hash = sha256(bytes);
    if (hash !== file.sha256)
      throw new Error(
        `The file '${file.path}' did not arrive as the instance holds it (its SHA-256 differs). Pull again.`
      );
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { mode: 0o644 });
    hashes[file.path] = hash;
  }
  for (const path of Object.keys(previous?.files ?? {})) {
    if (!Object.hasOwn(hashes, path)) await rm(safeTarget(directory, path), { force: true });
  }
  return hashes;
}

/** A fresh sibling receives the entire pull before the target is moved. Roll back a failed swap. */
export async function replaceFolder(
  directory: string,
  files: NonNullable<Asset["files"]>,
  filename: string,
  state: Omit<FolderState, "files"> & { skill: string },
  beforeReplace: () => Promise<void>
): Promise<number> {
  const createdParent = await mkdir(dirname(directory), { recursive: true });
  let temporary: string | undefined;
  let installed = false;
  let moved = false;
  try {
    temporary = await mkdtemp(join(dirname(directory), ".catalyst-pull-"));
    const backup = join(temporary, "previous");
    const staged = join(temporary, "next");
    await mkdir(staged);
    if (files.some((file) => file.path === filename))
      throw new Error(`The instance named the reserved state file '${filename}'.`);
    const hashes = await writeFolderFiles(staged, files);
    await writeFolderState(staged, filename, { ...state, files: hashes });
    await beforeReplace();
    try {
      await rename(directory, backup);
      moved = true;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    }
    try {
      await rename(staged, directory);
    } catch (error) {
      if (moved) await rename(backup, directory);
      throw error;
    }
    installed = true;
    return Object.keys(hashes).length;
  } finally {
    if (temporary !== undefined) await rm(temporary, { recursive: true, force: true });
    if (!installed && createdParent !== undefined) {
      // Remove only empty parents this pull created; preserve concurrent additions.
      for (let parent = dirname(directory); ; parent = dirname(parent)) {
        const removed = await rmdir(parent).then(
          () => true,
          () => false
        );
        if (!removed || parent === createdParent) break;
      }
    }
  }
}

export async function folderIsEmpty(directory: string): Promise<boolean> {
  try {
    return (await readdir(directory, { withFileTypes: true })).every(
      (entry) => entry.name === ".DS_Store" && entry.isFile()
    );
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return true;
    throw error;
  }
}

function safeTarget(directory: string, path: string): string {
  const target = resolve(directory, path);
  if (
    path.includes("\\") ||
    path.split("/").some((part) => part === "." || part === ".." || part === "") ||
    !target.startsWith(`${resolve(directory)}${sep}`)
  ) {
    throw new Error(`The instance named the file '${path}', which lies outside the folder.`);
  }
  return target;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
