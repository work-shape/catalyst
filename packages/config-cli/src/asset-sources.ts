import {
  ASSET_PUT_FILES_MAX_BYTES,
  ASSET_SYNC_ITEM_MAX_BYTES,
  FILE_SET_MAX_FILES
} from "@work-shape/catalyst-api-contract";
import {
  ASSET_REPRESENTATIONS,
  loadYamlData,
  parseSkillMarkdown
} from "@work-shape/catalyst-asset-schemas";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { GUARDRAIL_FILE, readGuardrailFolder } from "./guardrail-files";
import { readSkillResources, walkFiles } from "./working-copy";

// What `--from` names, read as a write of one asset carries it: the definition of a kind whose
// revision is its config, or every file of the folder of a kind whose revision holds files.
// The forms are the working copy's, so a file a pull wrote is sent as it is. The instance
// checks what arrives; this file only reads it.

type AssetFileInput = { path: string; text: string } | { path: string; base64: string };

/** What one write of an asset carries, by the representation of its kind. */
type AssetSource = { config: Record<string, unknown> } | { files: AssetFileInput[] };

const SKILL_FILE = "SKILL.md";

export async function readAssetSource(
  path: string,
  representation: (typeof ASSET_REPRESENTATIONS)[number]
): Promise<AssetSource> {
  return representation === "files"
    ? { files: await readFileSet(path) }
    : { config: await readDefinition(path) };
}

/**
 * A definition from a YAML or JSON file, from a `SKILL.md` with the files of its folder as
 * the skill's resources, or from the folder of a guardrail, its `guardrail.yaml` with the
 * `check.md` beside it. A folder that holds a `SKILL.md` is read as that file.
 */
async function readDefinition(path: string): Promise<Record<string, unknown>> {
  const folder = (await stat(path)).isDirectory();
  const guardrailFolder = folder
    ? path
    : basename(path) === GUARDRAIL_FILE
      ? dirname(path)
      : undefined;
  if (
    guardrailFolder !== undefined &&
    (await stat(join(guardrailFolder, GUARDRAIL_FILE)).then(
      (found) => found.isFile(),
      () => false
    ))
  ) {
    return readGuardrailFolder(guardrailFolder).catch((error: unknown) => {
      throw new Error(
        `'${path}' cannot be read: ${error instanceof Error ? error.message : String(error)}`
      );
    });
  }
  const file = folder ? join(path, SKILL_FILE) : path;
  const { size } = await stat(file).catch(() => {
    throw new Error(
      `'${path}' is a folder without a ${SKILL_FILE}. Name the YAML or JSON file of the definition.`
    );
  });
  if (size > ASSET_SYNC_ITEM_MAX_BYTES) {
    throw new Error(
      `'${file}' has ${size} bytes, and a definition holds at most ${ASSET_SYNC_ITEM_MAX_BYTES}.`
    );
  }
  const contents = await readFile(file, "utf8");
  const definition = await parseDefinition(file, contents).catch((error: unknown) => {
    throw new Error(
      `'${file}' cannot be read: ${error instanceof Error ? error.message : String(error)}`
    );
  });
  if (!isMapping(definition)) {
    throw new Error(`'${file}' holds no definition: its top level is not a mapping.`);
  }
  return { ...definitionOfShown(definition) };
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The definition in what `show --json` printed: the answer of `assets.get` carries it under
 * `config`, beside the asset's kind and revision. Sent as it stands, the whole answer would be
 * the definition, with no field of the agent at the top, so a write would change every field.
 */
function definitionOfShown(value: Record<string, unknown>): Record<string, unknown> {
  const { config, kind, revision } = value;
  return isMapping(config) && typeof kind === "string" && typeof revision === "number"
    ? config
    : value;
}

async function parseDefinition(file: string, contents: string): Promise<unknown> {
  if (basename(file) === SKILL_FILE) {
    const skill = parseSkillMarkdown(contents, file, file.split(sep).join("/"));
    const resources = await readSkillResources(resolve(file));
    return resources.length === 0 || typeof skill !== "object" ? skill : { ...skill, resources };
  }
  switch (extname(file).toLowerCase()) {
    case ".yaml":
    case ".yml":
      return loadYamlData(contents, file);
    case ".json":
      return JSON.parse(contents);
    default:
      throw new Error(
        `'${file}' is not a definition this tool reads: name a .yaml, .yml or .json file, or a ${SKILL_FILE}.`
      );
  }
}

/**
 * Every file of a folder, by its path inside it. A file that is UTF-8 text without a NUL byte
 * travels as text, any other as base64. The count and the size are checked before a file is
 * read, against the limits of one write.
 */
async function readFileSet(directory: string): Promise<AssetFileInput[]> {
  if (!(await stat(directory)).isDirectory()) {
    throw new Error(
      `'${directory}' is not a folder. An asset of files is written from its folder.`
    );
  }
  const paths: string[] = [];
  await walkFiles(directory, directory, paths);
  if (paths.length === 0) {
    throw new Error(`'${directory}' holds no file.`);
  }
  if (paths.length > FILE_SET_MAX_FILES) {
    throw new Error(
      `'${directory}' holds ${paths.length} files, and one write carries at most ${FILE_SET_MAX_FILES}.`
    );
  }
  let total = 0;
  for (const path of paths) total += (await stat(path)).size;
  if (total > ASSET_PUT_FILES_MAX_BYTES) {
    throw new Error(
      `'${directory}' holds ${total} bytes, and one write carries at most ${ASSET_PUT_FILES_MAX_BYTES}.`
    );
  }
  const files: AssetFileInput[] = [];
  for (const path of paths.sort()) {
    const bytes = await readFile(path);
    const relativePath = relative(directory, path).split(sep).join("/");
    const text = utf8Text(bytes);
    files.push(
      text === undefined
        ? { path: relativePath, base64: bytes.toString("base64") }
        : { path: relativePath, text }
    );
  }
  return files;
}

function utf8Text(bytes: Uint8Array): string | undefined {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.includes("\u0000") ? undefined : text;
  } catch {
    return undefined;
  }
}
