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

// Repository folders share their file selection, size checks and baseline. Only the
// manifest filename and the words in diagnostics depend on the kind.

/** Shared state filename, kept for compatibility with App folders; never sent. */
export const APP_STATE_FILE = ".catalyst-app.json";

/** Folder names a push leaves out wherever they are. Dot-folders are left out as well. */
const IGNORED_FOLDERS = new Set(["node_modules"]);

/** Where the asset lives, and the revision and files the folder holds. */
export interface RepositoryFolderState extends FolderState {
  name: string;
}

export const REPOSITORY_KINDS = {
  app: { kind: "app", label: "App", plural: "Apps", article: "An", manifest: "app.yaml" },
  workflow: {
    kind: "workflow",
    label: "Workflow",
    plural: "Workflows",
    article: "A",
    manifest: "workflow.yaml"
  }
} as const;
export type RepositoryKind = (typeof REPOSITORY_KINDS)[keyof typeof REPOSITORY_KINDS];

/** One file a push sends. */
type RepositoryFileInput = { path: string; text: string } | { path: string; base64: string };

interface RepositoryFolderRead {
  files: RepositoryFileInput[];
  /** The SHA-256 of each file sent, by its path. */
  hashes: Record<string, string>;
  /** What the folder holds and the push leaves out, by path, with the reason. */
  leftOut: string[];
}

type KindLimits = NonNullable<PlatformContext["kinds"][number]["limits"]>;

export async function readRepositoryState(
  directory: string,
  kind: RepositoryKind
): Promise<RepositoryFolderState | undefined> {
  const state = await readFolderState(directory, APP_STATE_FILE, kind.kind);
  if (state === undefined) return undefined;
  return state;
}

export async function writeRepositoryState(
  directory: string,
  state: RepositoryFolderState,
  kind: RepositoryKind
): Promise<void> {
  await writeFolderState(directory, APP_STATE_FILE, {
    instance: state.instance,
    workspaceId: state.workspaceId,
    [kind.kind]: state.name,
    assetId: state.assetId,
    revision: state.revision,
    files: state.files
  });
}

/**
 * Every file a push sends, by its path in the folder. Left out, and named: dotfiles and
 * dot-folders, `node_modules`, and what is not a regular file such as a link. A dotfile the
 * asset already holds, as the last pull or push recorded it, is sent like any other file, so a
 * pull and a push give the asset back as it was. The limits of the kind are checked before a
 * file is read.
 */
export async function readRepositoryFolder(
  directory: string,
  limits: KindLimits | undefined,
  tracked: ReadonlySet<string>,
  kind: RepositoryKind
): Promise<RepositoryFolderRead> {
  const stats = await lstat(directory).catch(() => undefined);
  if (!stats?.isDirectory()) {
    throw new Error(
      `'${directory}' is not a folder. ${kind.article} ${kind.label} is pushed from its folder.`
    );
  }
  const found: Array<{ path: string; absolute: string; bytes: number }> = [];
  const leftOut: string[] = [];
  await walk(directory, directory, tracked, found, leftOut);
  if (!found.some((file) => file.path === kind.manifest)) {
    throw new Error(
      `'${directory}' holds no ${kind.manifest} at its root. ${kind.article} ${kind.label}'s folder starts with it.`
    );
  }
  if (limits) {
    if (found.length > limits.FILE_SET_MAX_FILES) {
      throw new Error(
        `'${directory}' holds ${found.length} files to send, and ${kind.article.toLowerCase()} ${kind.label} holds at most ${limits.FILE_SET_MAX_FILES}.`
      );
    }
    const large = found.filter((file) => file.bytes > limits.FILE_SET_MAX_FILE_BYTES);
    if (large.length > 0) {
      throw new Error(
        [
          `A file of ${kind.article.toLowerCase()} ${kind.label} holds at most ${formatBytes(limits.FILE_SET_MAX_FILE_BYTES)}. Keep larger media as Managed Files. Too large:`,
          ...large.map((file) => `- ${file.path}: ${formatBytes(file.bytes)}`)
        ].join("\n")
      );
    }
    const total = found.reduce((sum, file) => sum + file.bytes, 0);
    const cap = Math.min(limits.FILE_SET_MAX_TOTAL_BYTES, limits.ASSET_PUT_FILES_MAX_BYTES);
    if (total > cap) {
      throw new Error(
        `The files to send hold ${formatBytes(total)} together, and one push of ${kind.article.toLowerCase()} ${kind.label} carries at most ${formatBytes(cap)}.`
      );
    }
  }
  const files: RepositoryFileInput[] = [];
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
  state: RepositoryFolderState
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
