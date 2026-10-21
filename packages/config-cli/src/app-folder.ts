import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { PlatformContext } from "@work-shape/catalyst-api-contract";

import {
  sha256,
  readFolderState,
  writeFolderState,
  localChanges as folderChanges,
  type FolderState
} from "./asset-folder";

// The folder of one App on this machine: what `catalyst app pull` writes and `push` reads. The
// folder holds the App's source files as they are, `app.yaml` at its root, and one file of
// local state that is never sent. Which files a push leaves out, and the limits it holds the
// folder to, are decided here before anything is sent; the instance checks again.

/** The local state of a pulled App. It is a dotfile, so a push never sends it. */
export const APP_STATE_FILE = ".catalyst-app.json";

/** Folder names a push leaves out wherever they are. Dot-folders are left out as well. */
const IGNORED_FOLDERS = new Set(["node_modules"]);

/** What a pull recorded: where the App lives, and the revision and files the folder holds. */
export interface AppFolderState extends FolderState {
  app: string;
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

export async function readAppState(directory: string): Promise<AppFolderState | undefined> {
  const state = await readFolderState(directory, APP_STATE_FILE, "app");
  if (state === undefined) return undefined;
  const { name, ...base } = state;
  return { ...base, app: name };
}

export async function writeAppState(directory: string, state: AppFolderState): Promise<void> {
  await writeFolderState(directory, APP_STATE_FILE, state);
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
  return folderChanges(directory, state, APP_STATE_FILE, true);
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
