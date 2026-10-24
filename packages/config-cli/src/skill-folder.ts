import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  skillResourceMediaTypeForPath,
  type SkillResourceConfig
} from "@work-shape/catalyst-asset-schemas";
import { refuseLinks, sha256 } from "./asset-folder";

export type SkillFolderFile =
  { path: string; text: string; base64?: never } | { path: string; base64: string; text?: never };
const SKILL_STATE_FILES = [".catalyst-skill.json", ".catalyst-state.json"];
const FILE_MAX_BYTES = 2 * 1024 * 1024;
const FOLDER_MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 500;
const TEXT_EXTENSIONS = /\.(py|js|mjs|ts|sh|rb|md|txt|json|yaml|yml|xml|html|css|csv)$/iu;
const EXECUTABLE_PREFIXES = [
  [0x7f, 0x45, 0x4c, 0x46],
  [0xfe, 0xed, 0xfa, 0xce],
  [0xfe, 0xed, 0xfa, 0xcf],
  [0xce, 0xfa, 0xed, 0xfe],
  [0xcf, 0xfa, 0xed, 0xfe],
  [0xca, 0xfe, 0xba, 0xbe]
];

export function fileBytes(file: { text?: string; base64?: string }): Buffer {
  return file.base64 === undefined
    ? Buffer.from(file.text ?? "", "utf8")
    : Buffer.from(file.base64, "base64");
}

/** Preserve the BOM as bytes when sending a UTF-8 file. */
export function utf8Text(bytes: Uint8Array): string | undefined {
  if (bytes.includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

export function resourceMediaType(path: string): SkillResourceConfig["mediaType"] | undefined {
  return path.startsWith("scripts/") ? undefined : skillResourceMediaTypeForPath(path);
}

export function folderHashes(files: readonly SkillFolderFile[]): Record<string, string> {
  return Object.fromEntries(files.map((file) => [file.path, sha256(fileBytes(file))]));
}

/** Non-resource hashes alone decide whether a push needs the whole folder. */
export function extraHashes(hashes: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(hashes)
      .filter(([path]) => path !== "SKILL.md" && !resourceMediaType(path))
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

function refuse(reason: string, path: string, message: string): never {
  throw new Error(`${reason}: '${path}': ${message}`);
}

/** The same limits and reason names as the server's skill-files boundary, before any send. */
export async function readSkillFolder(directory: string) {
  await refuseLinks(directory);
  const paths: Array<{ path: string; size: number }> = [];
  const walk = async (folder: string, prefix = "") => {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const path = `${prefix}${entry.name}`;
      if (
        SKILL_STATE_FILES.includes(basename(path)) ||
        (entry.name === ".DS_Store" && entry.isFile())
      )
        continue;
      if (entry.isDirectory()) await walk(join(folder, entry.name), `${path}/`);
      else {
        if (!entry.isFile()) refuse("skill_path_invalid", path, "must be a regular file");
        if (
          path.includes("\\") ||
          path.length > 240 ||
          path
            .split("/")
            .some(
              (segment) =>
                segment.length > 100 ||
                !/^[A-Za-z0-9._@()+-][A-Za-z0-9._@()+ -]*$/u.test(segment) ||
                segment.endsWith(" ") ||
                segment.toLowerCase() === "__catalyst"
            )
        )
          refuse("skill_path_invalid", path, "invalid skill path");
        if (path.toLowerCase().endsWith("/skill.md"))
          refuse("skill_path_invalid", path, "SKILL.md belongs at the root");
        const { size } = await lstat(join(directory, path));
        if (size > FILE_MAX_BYTES)
          refuse("skill_file_too_large", path, `at most ${FILE_MAX_BYTES} bytes`);
        paths.push({ path, size });
        if (paths.length > MAX_FILES)
          refuse("skill_too_many_files", path, `at most ${MAX_FILES} files`);
      }
    }
  };
  await walk(directory);
  const seen = new Set<string>();
  let total = 0;
  const files: SkillFolderFile[] = [];
  const resources: SkillResourceConfig[] = [];
  for (const { path } of paths) {
    if (seen.has(path.toLowerCase()))
      refuse("skill_path_duplicate", path, "paths differing only in case count as one");
    seen.add(path.toLowerCase());
    const bytes = await readFile(join(directory, path));
    if (bytes.length > FILE_MAX_BYTES)
      refuse("skill_file_too_large", path, `at most ${FILE_MAX_BYTES} bytes`);
    total += bytes.length;
    if (total > FOLDER_MAX_BYTES)
      refuse("skill_too_large", path, `at most ${FOLDER_MAX_BYTES} bytes per skill`);
    const peAt = bytes.length >= 64 ? bytes.readUInt32LE(60) : bytes.length;
    const pe =
      bytes[0] === 0x4d &&
      bytes[1] === 0x5a &&
      peAt + 4 <= bytes.length &&
      bytes.subarray(peAt, peAt + 4).equals(Buffer.from([0x50, 0x45, 0, 0]));
    if (
      pe ||
      EXECUTABLE_PREFIXES.some((prefix) => prefix.every((byte, index) => bytes[index] === byte))
    )
      refuse("skill_file_executable", path, "compiled programs are not skill files");
    if (
      /^version https:\/\/git-lfs\.[a-z0-9.-]+\/spec\/v\d+\r?\n/u.test(
        bytes.subarray(0, 128).toString("latin1")
      )
    )
      refuse("skill_file_lfs_pointer", path, "send the file instead of its Git LFS pointer");
    const text = utf8Text(bytes);
    if (
      text === undefined &&
      (path === "SKILL.md" || path.startsWith("scripts/") || TEXT_EXTENSIONS.test(path))
    )
      refuse("skill_file_not_text", path, "must be UTF-8 text");
    files.push(text === undefined ? { path, base64: bytes.toString("base64") } : { path, text });
    const mediaType = resourceMediaType(path);
    if (path !== "SKILL.md" && mediaType && text !== undefined)
      resources.push({ path, mediaType, content: text });
  }
  if (!files.some((file) => file.path === "SKILL.md"))
    refuse("skill_manifest_missing", "SKILL.md", "every skill folder holds SKILL.md");
  return { files, resources };
}
