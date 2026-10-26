import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  isPlainConfigObject,
  loadYamlData,
  mergeConfigObjects
} from "@work-shape/catalyst-asset-schemas";
import {
  isMap,
  isNode,
  isScalar,
  isSeq,
  parseDocument,
  stringify,
  type Pair,
  type YAMLMap
} from "yaml";

/**
 * Where a deployment repository keeps its release config, the first that exists. A repository
 * with one environment has `config/app.yaml`; one with several keeps what they share in
 * `config/app.base.yaml`, which each environment's file extends.
 */
export const RELEASE_CONFIG_CANDIDATES = ["config/app.yaml", "config/app.base.yaml"] as const;

/** A release config that cannot be read, or a change that cannot be placed. Nothing was written. */
export class ReleaseConfigError extends Error {}

export interface ReleaseConfigFile {
  path: string;
  text: string;
  /** The file as the instance reads it, without its `extends`. */
  data: Record<string, unknown>;
}

/** A release config file and the files it extends, in that order. */
export interface ReleaseConfig {
  /** The file the command was pointed at, the first of the chain. */
  file: ReleaseConfigFile;
  chain: ReleaseConfigFile[];
  /** What the instance loads: the chain merged the way the instance merges it. */
  merged: Record<string, unknown>;
}

/** Something to add to a release config file. Nothing in the file is ever replaced. */
export type ReleaseConfigAddition =
  /** A new key of the mapping at `path`. */
  | { path: readonly string[]; key: string; value: unknown }
  /** A new last item of the list at `path`. */
  | { path: readonly string[]; item: unknown };

/** The file `--config` names, or the first of `RELEASE_CONFIG_CANDIDATES` that exists. */
export async function locateReleaseConfig(cwd: string, named: string | undefined): Promise<string> {
  if (named !== undefined) {
    const path = resolve(cwd, named);
    if (!(await exists(path))) throw new ReleaseConfigError(`There is no file ${named}.`);
    return path;
  }
  for (const candidate of RELEASE_CONFIG_CANDIDATES) {
    const path = resolve(cwd, candidate);
    if (await exists(path)) return path;
  }
  throw new ReleaseConfigError(
    `No release config here: looked for ${RELEASE_CONFIG_CANDIDATES.join(" and ")}. Run the command in the deployment repository, or name the file with --config <file>.`
  );
}

/** Reads a release config file with every file it extends. */
export async function readReleaseConfig(path: string): Promise<ReleaseConfig> {
  const chain: ReleaseConfigFile[] = [];
  for (let next: string | undefined = path; next !== undefined;) {
    if (chain.some((file) => file.path === next)) {
      throw new ReleaseConfigError(
        `The files extend each other in a circle: ${[...chain.map((file) => file.path), next].join(" -> ")}`
      );
    }
    const text = (await readFile(next, "utf8")).replaceAll("\r\n", "\n");
    const raw = loadYamlData(text, next);
    if (!isPlainConfigObject(raw))
      throw new ReleaseConfigError(`${next} holds no mapping of settings.`);
    const { extends: extendsValue, ...data } = raw;
    chain.push({ path: next, text, data });
    if (extendsValue === undefined) next = undefined;
    else if (typeof extendsValue === "string" && extendsValue.length > 0)
      next = resolve(dirname(next), extendsValue);
    else throw new ReleaseConfigError(`'extends' in ${next} must name a file.`);
  }
  const [file] = chain;
  if (file === undefined) throw misplaced();
  return {
    file,
    chain,
    merged: chain.reduceRight<Record<string, unknown>>(
      (base, file) => mergeConfigObjects(base, file.data),
      {}
    )
  };
}

/** The value at `path`, or undefined where any step is missing. */
export function valueAt(data: unknown, path: readonly string[]): unknown {
  let current = data;
  for (const key of path) {
    if (!isPlainConfigObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

/** The first file of the chain that sets `path` itself, or undefined when none does. */
export function fileSetting(
  config: ReleaseConfig,
  path: readonly string[]
): ReleaseConfigFile | undefined {
  return config.chain.find((file) => valueAt(file.data, path) !== undefined);
}

/**
 * The other release config files beside `path` that extend it and set one of `lists` themselves:
 * their list replaces the one of `path`, so an item added to `path` does not reach them.
 */
export async function overlaysReplacing(
  path: string,
  lists: readonly (readonly string[])[]
): Promise<{ file: string; list: readonly string[] }[]> {
  const directory = dirname(path);
  const found: { file: string; list: readonly string[] }[] = [];
  for (const name of (await readdir(directory)).sort()) {
    if (![".yaml", ".yml"].includes(extname(name))) continue;
    const candidate = resolve(directory, name);
    if (candidate === path) continue;
    let config: ReleaseConfig;
    try {
      config = await readReleaseConfig(candidate);
    } catch {
      continue;
    }
    const position = config.chain.findIndex((file) => file.path === path);
    if (position <= 0) continue;
    for (const list of lists) {
      const setting = fileSetting(config, list);
      if (setting !== undefined && config.chain.indexOf(setting) < position) {
        found.push({ file: candidate, list });
      }
    }
  }
  return found;
}

/**
 * Writes the additions into one file. The rest of the file stays as it is, comments and layout
 * included: each addition is placed as new lines after what is there. The result is read back
 * the way the instance reads it and must equal the old file with the additions; otherwise
 * nothing is written.
 */
export async function addToReleaseConfigFile(
  file: ReleaseConfigFile,
  additions: readonly ReleaseConfigAddition[],
  shown: string
): Promise<void> {
  const original = await readFile(file.path, "utf8");
  const lineEnding = original.includes("\r\n") ? "\r\n" : "\n";
  const text = additions.reduce(
    (current, addition, index) => placeAddition(current, addition, shown, index === 0),
    original.replaceAll("\r\n", "\n")
  );
  const expected = loadYamlData(original.replaceAll("\r\n", "\n"), file.path);
  for (const addition of additions) applyToData(expected, addition);
  if (!isDeepStrictEqual(loadYamlData(text, file.path), expected)) {
    throw new ReleaseConfigError(
      `The change could not be placed in ${shown} without touching what is there. Nothing was written.`
    );
  }
  await writeFile(file.path, lineEnding === "\n" ? text : text.replaceAll("\n", "\r\n"));
}

/** The path of a file as the person reads it: relative to where they run the command. */
export function shownPath(cwd: string, path: string): string {
  const shown = relative(cwd, path).replaceAll("\\", "/");
  return shown.startsWith("..") ? path : shown;
}

function placeAddition(
  text: string,
  addition: ReleaseConfigAddition,
  shown: string,
  original: boolean
): string {
  const document = parseDocument(text);
  const [invalid] = document.errors;
  if (invalid !== undefined) {
    // After the first addition the text is this command's own, not the file as it was.
    throw new ReleaseConfigError(
      original
        ? `${shown} is not valid YAML: ${invalid.message}`
        : `The change could not be placed in ${shown} without touching what is there. Nothing was written.`
    );
  }
  const root = document.contents;
  const path = addition.path;
  const rest = (from: number): Record<string, unknown> =>
    nested(
      path.slice(from),
      "item" in addition ? [addition.item] : { [addition.key]: addition.value }
    );
  if (root === null)
    return `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}${block(rest(0), 0)}\n`;
  if (!isMap(root) || root.flow)
    throw new ReleaseConfigError(`${shown} holds no mapping of settings.`);
  let map: YAMLMap = root;
  for (let depth = 0; depth < path.length; depth += 1) {
    const pair = map.items.find((candidate) => keyOf(candidate) === path[depth]);
    if (pair === undefined) return appendToMap(text, map, rest(depth));
    const value = pair.value;
    const where = path.slice(0, depth + 1).join(".");
    if (depth === path.length - 1 && "item" in addition) {
      if (isSeq(value) && !value.flow && value.items.length > 0) {
        return appendToSequence(text, value.items, addition.item);
      }
      if (isEmpty(value)) return fillEmptyKey(text, pair, [addition.item]);
      throw new ReleaseConfigError(
        `'${where}' in ${shown} is not a list written one item per line. Add the item there by hand.`
      );
    }
    if (isMap(value) && !value.flow && value.items.length > 0) {
      map = value;
      continue;
    }
    if (isEmpty(value)) return fillEmptyKey(text, pair, rest(depth + 1));
    throw new ReleaseConfigError(
      `'${where}' in ${shown} is not a mapping written one key per line. Add the setting there by hand.`
    );
  }
  if ("key" in addition && map.items.some((candidate) => keyOf(candidate) === addition.key)) {
    throw new ReleaseConfigError(
      `'${[...path, addition.key].join(".")}' is already set in ${shown}.`
    );
  }
  return appendToMap(text, map, rest(path.length));
}

/** Adds keys after the last key of a mapping written one key per line, at its indentation. */
function appendToMap(text: string, map: YAMLMap, value: Record<string, unknown>): string {
  const first = map.items[0];
  const last = map.items.at(-1);
  if (first === undefined || last === undefined) throw misplaced();
  const indent = column(text, rangeOf(first.key)[0]);
  return insertLines(text, endOf(last), block(value, indent), indent);
}

/** Adds an item after the last item of a list written one item per line, at its indentation. */
function appendToSequence(text: string, items: readonly unknown[], item: unknown): string {
  const first = rangeOf(items[0])[0];
  const lineStart = text.lastIndexOf("\n", first - 1) + 1;
  const dash = text.lastIndexOf("-", first - 1);
  if (dash < lineStart) throw misplaced();
  const indent = dash - lineStart;
  return insertLines(text, rangeOf(items.at(-1))[1], block([item], indent), indent);
}

/** Writes the value under a key that has none yet, such as `models:`, `models: {}` or `[]`. */
function fillEmptyKey(text: string, pair: Pair, value: unknown): string {
  const keyRange = rangeOf(pair.key);
  const indent = column(text, keyRange[0]) + 2;
  const colon = text.indexOf(":", keyRange[1]);
  const end = pair.value ? rangeOf(pair.value)[1] : colon + 1;
  const written = text.slice(colon + 1, end);
  // `models: {}` or `models: ~`, on the key's line or below: the empty value gives way, and
  // what follows it on its line, such as a comment, stays.
  const empty = /^\s*(?:\{\}|\[\]|~|null|Null|NULL)/u.exec(written);
  const cleared =
    empty === null ? text : text.slice(0, colon + 1) + text.slice(colon + 1 + empty[0].length);
  return insertLines(cleared, colon + 1, block(value, indent), indent);
}

/**
 * Inserts lines after the line that holds `offset`, keeping a comment at that line's end and
 * the comment lines below it that are indented deeper than `indent`: they belong to what is there.
 */
function insertLines(text: string, offset: number, lines: string, indent: number): string {
  const atLineStart = offset > 0 && text[offset - 1] === "\n";
  let at = atLineStart ? offset - 1 : text.indexOf("\n", offset);
  while (at !== -1) {
    const next = text.indexOf("\n", at + 1);
    const line = text.slice(at + 1, next === -1 ? text.length : next);
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("#") || line.length - trimmed.length <= indent) break;
    at = next;
  }
  if (at === -1) at = text.length;
  return `${text.slice(0, at)}\n${lines}${text.slice(at)}`;
}

/** The value as YAML block lines at the indentation, without a final line ending. */
function block(value: unknown, indent: number): string {
  const lines = stringify(value, { indent: 2, indentSeq: true, lineWidth: 0 }).replace(/\n$/u, "");
  const pad = " ".repeat(indent);
  return lines
    .split("\n")
    .map((line) => (line === "" ? line : pad + line))
    .join("\n");
}

function nested(path: readonly string[], leaf: unknown): Record<string, unknown> {
  if (path.length === 0) {
    if (!isPlainConfigObject(leaf)) throw new ReleaseConfigError("A list cannot stand alone.");
    return leaf;
  }
  const [head, ...tail] = path;
  if (head === undefined) throw misplaced();
  return { [head]: tail.length === 0 ? leaf : nested(tail, leaf) };
}

function applyToData(data: unknown, addition: ReleaseConfigAddition): void {
  if (!isPlainConfigObject(data))
    throw new ReleaseConfigError("The file holds no mapping of settings.");
  let current: Record<string, unknown> = data;
  const steps = "item" in addition ? addition.path.slice(0, -1) : addition.path;
  for (const key of steps) {
    const next = current[key];
    if (isPlainConfigObject(next)) current = next;
    else {
      const created: Record<string, unknown> = {};
      current[key] = created;
      current = created;
    }
  }
  if ("item" in addition) {
    const last = addition.path.at(-1);
    if (last === undefined) throw misplaced();
    const existing = current[last];
    current[last] = [...(Array.isArray(existing) ? existing : []), addition.item];
  } else current[addition.key] = addition.value;
}

function keyOf(pair: Pair): unknown {
  return isScalar(pair.key) ? pair.key.value : pair.key;
}

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (isScalar(value) && value.value === null) ||
    ((isMap(value) || isSeq(value)) && value.flow === true && value.items.length === 0)
  );
}

function rangeOf(node: unknown): [number, number] {
  if (!isNode(node) || !node.range) throw misplaced();
  return [node.range[0], node.range[1]];
}

/** The parsed file did not hold what its own reading said; nothing is written. */
function misplaced(): ReleaseConfigError {
  return new ReleaseConfigError("A setting was not where it was expected. Nothing was written.");
}

/** Where the last line of a key and its value ends. */
function endOf(pair: Pair): number {
  return rangeOf(pair.value ?? pair.key)[1];
}

function column(text: string, offset: number): number {
  return offset - (text.lastIndexOf("\n", offset - 1) + 1);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
