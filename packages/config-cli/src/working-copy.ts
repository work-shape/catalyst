import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import yaml from "js-yaml";
import {
  agentConfigSchema,
  isRecord,
  loadYamlData,
  parseSkillMarkdown,
  skillConfigSchema,
  type AgentConfig,
  type SkillConfig,
  type SkillResourceConfig
} from "@work-shape/catalyst-asset-schemas";
import { readSkillFolder, type SkillFolderFile } from "./skill-folder";
import { savedInstanceOrigins } from "./credentials";
import { type ConfigCliEnv, readConfigCliEnv } from "./env";
import { GUARDRAIL_FILE, readGuardrailFolder, type GuardrailDefinition } from "./guardrail-files";

export const MANIFEST_FILENAME = "catalyst.yaml";
export const STATE_FILENAME = ".catalyst-state.json";

export interface ManifestInstance {
  url: string;
  /**
   * The workspace this working copy is bound to, by its id: `catalyst config pull
   * --workspace <id>` writes it. The root holds what that workspace owns, and everything it
   * pushes is owned by that workspace.
   */
  workspace?: string;
}

export interface CatalystManifest {
  instances: Record<string, ManifestInstance>;
  defaultInstance?: string;
  defaultAgentName?: string;
  agents: string[];
  skills: string[];
  /** The globs of `guardrail.yaml` files. Left out, the working copy holds no guardrails. */
  guardrails?: string[];
}

export interface ResolvedInstance extends ManifestInstance {
  key: string;
}

export interface AssetBaseline {
  /** Absent in older copies, whose omitted fields and hashes cannot safely be reused. */
  canonicalFormVersion?: number;
  /**
   * The id of the asset the revision counts. A revision number alone does not say which
   * asset it belongs to: in a database that was replaced or restored, another asset of the
   * same name can be at the same number. An entry of an earlier CLI has none.
   */
  id?: string;
  /** For an agent: its live revision. A draft never moves it. */
  revision: number;
  hash: string;
  /** SHA-256 of every file in a skill folder. */
  files?: Record<string, string>;
  /**
   * For an agent: the draft revision the last pull or push saw, or null where it saw none. A
   * push names it, so it never writes over a draft somebody changed since. Left out by a CLI
   * from before agent drafts, whose baseline cannot be pushed until one pull.
   */
  draftRevision?: number | null;
  /**
   * For an agent: `hash` is of the draft this working copy pushed, not of the live revision,
   * so a pull reads the live revision again and a diff compares against it.
   */
  draftPushed?: true;
}

/** The delete of an asset as a pull or a push saw it. */
export interface DeletedAssetBaseline {
  id?: string;
  revision: number;
}

export interface InstanceBaseline {
  lastPulledVersion: number;
  assets?: Record<string, AssetBaseline>;
  /**
   * Assets this working copy saw deleted on the instance, each with the revision of its
   * delete. A push that creates one again names that revision.
   */
  deleted?: Record<string, DeletedAssetBaseline>;
  defaultAgentName?: string | null;
}

export interface CatalystState {
  instances: Record<string, InstanceBaseline>;
}

export interface WorkingCopyBundle {
  defaultAgentName?: string;
  agents: AgentConfig[];
  skills: SkillConfig[];
  skillFiles?: Record<string, SkillFolderFile[]>;
  guardrails: GuardrailDefinition[];
}

export interface WorkingCopyIssue {
  file: string;
  message: string;
  path?: string;
}

export class WorkingCopyValidationError extends Error {
  readonly issues: WorkingCopyIssue[];

  constructor(issues: WorkingCopyIssue[]) {
    super("Local config assets are invalid");
    this.name = "WorkingCopyValidationError";
    this.issues = issues;
  }
}

export function parseManifest(contents: string, source = MANIFEST_FILENAME): CatalystManifest {
  const input = loadYamlData(contents, source);
  if (!isRecord(input)) {
    throw new Error(`${source} must contain a YAML object`);
  }
  const instancesInput = input.instances;
  if (!isRecord(instancesInput)) {
    throw new Error(`${source} must define an instances mapping`);
  }
  const instances: Record<string, ManifestInstance> = {};
  for (const [name, value] of Object.entries(instancesInput)) {
    if (!isRecord(value) || typeof value.url !== "string" || value.url.length === 0) {
      throw new Error(`${source} instance '${name}' must define a url`);
    }
    const workspace = readOptionalString(value, "workspace", `${source} instance '${name}'`);
    instances[name] = {
      url: normalizeUrl(value.url, `${source} instance '${name}'`),
      ...(workspace === undefined ? {} : { workspace })
    };
  }

  const defaultInstance = readOptionalString(input, "defaultInstance", source);
  const defaultAgentName = readOptionalString(input, "defaultAgentName", source);
  return {
    instances,
    ...(defaultInstance === undefined ? {} : { defaultInstance }),
    ...(defaultAgentName === undefined ? {} : { defaultAgentName }),
    agents: readStringArray(input, "agents", source),
    skills: readStringArray(input, "skills", source),
    ...(input.guardrails === undefined
      ? {}
      : { guardrails: readStringArray(input, "guardrails", source) })
  };
}

export async function readManifest(workingDir: string): Promise<CatalystManifest> {
  const path = resolve(workingDir, MANIFEST_FILENAME);
  return parseManifest(await readFile(path, "utf8"), path);
}

/** The manifest of the folder, or none where the folder is no working copy. */
export async function readManifestIfPresent(
  workingDir: string
): Promise<CatalystManifest | undefined> {
  try {
    return await readManifest(workingDir);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * The instance a command works on: `instance` as an instance of the manifest or as an address,
 * else the manifest's default instance. A working copy that names neither is refused with the
 * instances it names: it belongs to one of them, and a saved key never chooses among them.
 * Outside a working copy (`manifest` undefined), the one instance a key is saved for is taken,
 * unless `CATALYST_API_KEY` is set, whose instance a saved key does not tell.
 */
export async function resolveInstance(
  manifest: CatalystManifest | undefined,
  options: { instance?: string | undefined; env?: ConfigCliEnv | undefined } = {}
): Promise<ResolvedInstance> {
  const key = options.instance ?? manifest?.defaultInstance;
  if (key !== undefined && key !== "") {
    const configured = manifest?.instances[key];
    if (configured) return { key, ...configured };
    return { key, url: normalizeUrl(key, `Instance '${key}'`) };
  }
  const refusal = `No instance selected; pass --instance or set defaultInstance in ${MANIFEST_FILENAME}.`;
  if (manifest !== undefined) {
    const names = Object.keys(manifest.instances);
    throw new Error(
      names.length === 0 ? refusal : `${refusal} ${MANIFEST_FILENAME} names ${names.join(", ")}.`
    );
  }
  // Read as connectApi reads it: only whether it is set matters here.
  if (readConfigCliEnv(options.env).CATALYST_API_KEY) {
    throw new Error(`${refusal} CATALYST_API_KEY is set: name the instance it belongs to.`);
  }
  const saved = await savedInstanceOrigins(readConfigCliEnv(options.env));
  const [origin, ...more] = saved;
  if (origin === undefined) {
    throw new Error(
      `${refusal} No key is saved; 'catalyst login --instance <https-url>' saves one.`
    );
  }
  if (more.length > 0) throw new Error(`${refusal} Keys are saved for ${saved.join(", ")}.`);
  return { key: origin, url: origin };
}

/** The key of an asset in the state file: its kind and its name. */
const ASSET_KEY_PATTERN = /^(agent|skill|guardrail):.+$/u;

export async function readStateFile(path: string): Promise<CatalystState> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { instances: {} };
    }
    throw error;
  }
  const input: unknown = JSON.parse(contents);
  if (!isRecord(input) || !isRecord(input.instances)) {
    throw new Error(`${path} must contain an instances object`);
  }
  const instances: CatalystState["instances"] = {};
  for (const [name, value] of Object.entries(input.instances)) {
    if (
      !isRecord(value) ||
      typeof value.lastPulledVersion !== "number" ||
      !Number.isInteger(value.lastPulledVersion) ||
      value.lastPulledVersion < 0
    ) {
      throw new Error(`${path} has an invalid lastPulledVersion for '${name}'`);
    }
    const baseline: InstanceBaseline = { lastPulledVersion: value.lastPulledVersion };
    if (value.assets !== undefined) {
      if (!isRecord(value.assets)) {
        throw new Error(`${path} has invalid asset baselines for '${name}'`);
      }
      baseline.assets = {};
      for (const [key, asset] of Object.entries(value.assets)) {
        if (
          !ASSET_KEY_PATTERN.test(key) ||
          !isRecord(asset) ||
          typeof asset.revision !== "number" ||
          !Number.isInteger(asset.revision) ||
          asset.revision < 1 ||
          typeof asset.hash !== "string" ||
          !/^[a-f0-9]{64}$/u.test(asset.hash) ||
          (asset.canonicalFormVersion !== undefined &&
            (typeof asset.canonicalFormVersion !== "number" ||
              !Number.isInteger(asset.canonicalFormVersion) ||
              asset.canonicalFormVersion < 1)) ||
          (asset.id !== undefined && typeof asset.id !== "string") ||
          !(
            asset.draftRevision === undefined ||
            asset.draftRevision === null ||
            (typeof asset.draftRevision === "number" &&
              Number.isInteger(asset.draftRevision) &&
              asset.draftRevision >= 1)
          ) ||
          (asset.files !== undefined &&
            (!isRecord(asset.files) ||
              Object.values(asset.files).some(
                (hash) => typeof hash !== "string" || !/^[a-f0-9]{64}$/u.test(hash)
              ))) ||
          (asset.draftPushed !== undefined && asset.draftPushed !== true)
        ) {
          throw new Error(`${path} has an invalid asset baseline for '${key}'`);
        }
        baseline.assets[key] = {
          ...(asset.canonicalFormVersion === undefined
            ? {}
            : { canonicalFormVersion: asset.canonicalFormVersion }),
          ...(asset.id === undefined ? {} : { id: asset.id }),
          revision: asset.revision,
          hash: asset.hash,
          ...(asset.files === undefined ? {} : { files: readBaselineHashes(asset.files) }),
          ...(asset.draftRevision === undefined ? {} : { draftRevision: asset.draftRevision }),
          ...(asset.draftPushed === true ? { draftPushed: true as const } : {})
        };
      }
    }
    if (value.deleted !== undefined) {
      if (!isRecord(value.deleted)) {
        throw new Error(`${path} has invalid deleted-asset baselines for '${name}'`);
      }
      baseline.deleted = {};
      for (const [key, entry] of Object.entries(value.deleted)) {
        // A number alone is the entry of an earlier CLI, which kept no id.
        const deleted = typeof entry === "number" ? { revision: entry } : entry;
        if (
          !ASSET_KEY_PATTERN.test(key) ||
          !isRecord(deleted) ||
          typeof deleted.revision !== "number" ||
          !Number.isInteger(deleted.revision) ||
          deleted.revision < 1 ||
          (deleted.id !== undefined && typeof deleted.id !== "string")
        ) {
          throw new Error(`${path} has an invalid deleted-asset baseline for '${key}'`);
        }
        baseline.deleted[key] = {
          ...(deleted.id === undefined ? {} : { id: deleted.id }),
          revision: deleted.revision
        };
      }
    }
    if (value.defaultAgentName !== undefined) {
      if (value.defaultAgentName !== null && typeof value.defaultAgentName !== "string") {
        throw new Error(`${path} has an invalid default-agent baseline for '${name}'`);
      }
      baseline.defaultAgentName = value.defaultAgentName;
    }
    instances[name] = baseline;
  }
  return { instances };
}

function readBaselineHashes(input: unknown): Record<string, string> {
  if (!isRecord(input)) throw new Error("Invalid skill file hashes");
  return Object.fromEntries(
    Object.entries(input).map(([path, hash]) => {
      if (typeof hash !== "string") throw new Error(`Invalid skill file hash: ${path}`);
      return [path, hash];
    })
  );
}

export async function writeStateFile(path: string, state: CatalystState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

export async function readWorkingCopy(
  workingDir: string,
  manifest: CatalystManifest
): Promise<WorkingCopyBundle> {
  const [agentFiles, skillPaths, guardrailFiles] = await Promise.all([
    matchManifestFiles(workingDir, manifest.agents),
    matchManifestFiles(workingDir, manifest.skills),
    matchManifestFiles(workingDir, manifest.guardrails ?? [])
  ]);
  const agents: AgentConfig[] = [];
  const skills: SkillConfig[] = [];
  const skillFiles: Record<string, SkillFolderFile[]> = {};
  const guardrails: GuardrailDefinition[] = [];
  const issues: WorkingCopyIssue[] = [];

  for (const path of agentFiles) {
    const file = toRelativePath(workingDir, path);
    try {
      const input = loadYamlData(await readFile(path, "utf8"), file);
      const parsed = agentConfigSchema.safeParse(input);
      if (parsed.success) {
        agents.push(parsed.data);
      } else {
        issues.push(...schemaIssues(file, parsed.error.issues));
      }
    } catch (error) {
      issues.push({ file, message: errorMessage(error) });
    }
  }

  for (const path of skillPaths) {
    const file = toRelativePath(workingDir, path);
    try {
      const contents = await readFile(path, "utf8");
      const parsedMarkdown = parseSkillMarkdown(contents, file, toPosixPath(path));
      const { resources, files } = await readSkillFolder(dirname(path));
      const parsed = skillConfigSchema.safeParse(
        isRecord(parsedMarkdown)
          ? { ...parsedMarkdown, ...(resources.length ? { resources } : {}) }
          : parsedMarkdown
      );
      if (parsed.success) {
        skills.push(parsed.data);
        skillFiles[parsed.data.name] = files;
      } else {
        issues.push(...schemaIssues(file, parsed.error.issues));
      }
    } catch (error) {
      const extracted = extractErrorIssues(file, error);
      issues.push(...(extracted.length > 0 ? extracted : [{ file, message: errorMessage(error) }]));
    }
  }

  // A guardrail is read as its files say and checked by the instance, which knows its events.
  for (const path of guardrailFiles) {
    const file = toRelativePath(workingDir, path);
    try {
      guardrails.push(await readGuardrailFolder(dirname(path)));
    } catch (error) {
      const extracted = extractErrorIssues(file, error);
      issues.push(...(extracted.length > 0 ? extracted : [{ file, message: errorMessage(error) }]));
    }
  }

  if (issues.length > 0) {
    throw new WorkingCopyValidationError(issues);
  }
  return {
    ...(manifest.defaultAgentName === undefined
      ? {}
      : { defaultAgentName: manifest.defaultAgentName }),
    agents,
    skills,
    skillFiles,
    guardrails
  };
}

export async function matchManifestFiles(root: string, patterns: string[]): Promise<string[]> {
  const normalizedPatterns = patterns.map(validateGlob);
  if (normalizedPatterns.length === 0) {
    return [];
  }
  const matches = new Set<string>();
  for (const pattern of normalizedPatterns) {
    const files: string[] = [];
    await walkFiles(root, globSearchRoot(root, pattern), files);
    const regex = globPatternToRegExp(pattern);
    for (const path of files) {
      if (regex.test(toRelativePath(root, path))) {
        matches.add(path);
      }
    }
  }
  return [...matches].sort((left, right) => left.localeCompare(right));
}

export function matchesManifestPath(root: string, path: string, patterns: string[]): boolean {
  const relativePath = toRelativePath(root, path);
  return patterns
    .map(validateGlob)
    .some((pattern) => globPatternToRegExp(pattern).test(relativePath));
}

export function agentAssetPath(workingDir: string, name: string): string {
  assertSafeAssetName(name);
  return resolve(workingDir, "agents", `${name}.agent.yaml`);
}

export function skillAssetPath(workingDir: string, name: string): string {
  assertSafeAssetName(name);
  return resolve(workingDir, "skills", name, "SKILL.md");
}

export function guardrailAssetPath(workingDir: string, name: string): string {
  assertSafeAssetName(name);
  return resolve(workingDir, "guardrails", name, GUARDRAIL_FILE);
}

export async function readSkillResources(skillFilePath: string): Promise<SkillResourceConfig[]> {
  return (await readSkillFolder(dirname(skillFilePath))).resources;
}

export async function removeStaleManifestAssets(
  workingDir: string,
  manifest: CatalystManifest,
  desiredPaths: Set<string>
): Promise<void> {
  const existing = await matchManifestFiles(workingDir, [
    ...manifest.agents,
    ...manifest.skills,
    ...(manifest.guardrails ?? [])
  ]);
  for (const path of existing) {
    if (desiredPaths.has(path)) {
      continue;
    }
    if (path.endsWith("/SKILL.md") || path.endsWith(`/${GUARDRAIL_FILE}`)) {
      await rm(dirname(path), { recursive: true, force: true });
      continue;
    }
    await rm(path);
    const parent = dirname(path);
    if (parent !== workingDir) {
      try {
        await rmdir(parent);
      } catch (error) {
        if (!isNodeError(error) || (error.code !== "ENOTEMPTY" && error.code !== "EEXIST")) {
          throw error;
        }
      }
    }
  }
}

export async function updateManifestDefaultAgent(
  path: string,
  defaultAgentName: string | undefined
): Promise<void> {
  const contents = await readFile(path, "utf8");
  const linePattern = /^defaultAgentName:[^\r\n]*(?:\r?\n|$)/mu;
  let updated: string;
  if (defaultAgentName === undefined) {
    updated = contents.replace(linePattern, "");
  } else {
    const line = yaml.dump({ defaultAgentName }, { lineWidth: -1, noCompatMode: true }).trimEnd();
    if (linePattern.test(contents)) {
      updated = contents.replace(linePattern, `${line}\n`);
    } else {
      const defaultInstancePattern = /^defaultInstance:[^\r\n]*(?:\r?\n|$)/mu;
      updated = defaultInstancePattern.test(contents)
        ? contents.replace(defaultInstancePattern, (match) => `${match}${line}\n`)
        : `${contents.trimEnd()}\n${line}\n`;
    }
  }
  await writeFile(path, updated, "utf8");
}

/**
 * Binds the working copy's instance to a workspace: writes `workspace: <id>` below the
 * instance's `url` in catalyst.yaml and leaves every other line as it is. An instance that is
 * not written as a block with its own `url:` line is not changed, and the caller is told to
 * add the line itself.
 */
export async function bindManifestWorkspace(
  path: string,
  instanceKey: string,
  workspaceId: string
): Promise<void> {
  const contents = await readFile(path, "utf8");
  const lines = contents.split("\n");
  const keyLine = lines.findIndex((line) => {
    const match = /^(\s+)(["']?)([^"':]+)\2:\s*(?:#.*)?$/u.exec(line.trimEnd());
    return match?.[3] === instanceKey;
  });
  const keyIndent = keyLine < 0 ? -1 : indentOf(lines[keyLine] ?? "");
  let urlLine = -1;
  for (let index = keyLine + 1; keyLine >= 0 && index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (indentOf(line) <= keyIndent) break;
    if (/^\s+url:/u.test(line)) {
      urlLine = index;
      break;
    }
  }
  if (urlLine < 0) {
    throw new Error(
      `Cannot bind instance '${instanceKey}' in ${MANIFEST_FILENAME}: add 'workspace: ${workspaceId}' to that instance yourself, beside its url.`
    );
  }
  const entry = yaml.dump({ workspace: workspaceId }, { lineWidth: -1 }).trimEnd();
  lines.splice(urlLine + 1, 0, `${" ".repeat(indentOf(lines[urlLine] ?? ""))}${entry}`);
  await writeFile(path, lines.join("\n"), "utf8");
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Every file below `directory`, by absolute path. `.git` and `node_modules` directly in `root`
 * are skipped.
 */
export async function walkFiles(root: string, directory: string, output: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (directory !== root && isNodeError(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (directory === root && [".git", "node_modules"].includes(entry.name)) {
        continue;
      }
      await walkFiles(root, path, output);
    } else if (entry.isFile()) {
      output.push(path);
    }
  }
}

function globSearchRoot(root: string, pattern: string): string {
  const wildcardIndex = pattern.search(/[?*]/u);
  const fixedPart = wildcardIndex === -1 ? pattern : pattern.slice(0, wildcardIndex);
  const slashIndex = fixedPart.lastIndexOf("/");
  return resolve(root, slashIndex === -1 ? "." : fixedPart.slice(0, slashIndex));
}

function globPatternToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "*" && pattern[index + 1] === "*") {
      const followedBySlash = pattern[index + 2] === "/";
      source += followedBySlash ? "(?:.*/)?" : ".*";
      index += followedBySlash ? 2 : 1;
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
    }
  }
  return new RegExp(`${source}$`, "u");
}

function validateGlob(pattern: string): string {
  const normalized = pattern.replaceAll("\\", "/");
  if (isAbsolute(pattern) || normalized.split("/").includes("..")) {
    throw new Error(`Manifest glob must stay within the working-copy directory: ${pattern}`);
  }
  return normalized.replace(/^\.\//u, "");
}

function normalizeUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use http or https`);
  }
  return value.replace(/\/+$/u, "");
}

function readOptionalString(
  input: Record<string, unknown>,
  key: string,
  source: string
): string | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${source} ${key} must be a non-empty string`);
  }
  return value;
}

function readStringArray(input: Record<string, unknown>, key: string, source: string): string[] {
  const value = input[key];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string" && item.length > 0)
  ) {
    throw new Error(`${source} ${key} must be an array of file globs`);
  }
  return value;
}

function assertSafeAssetName(name: string): void {
  if (
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    throw new Error(`Config asset name cannot be represented safely as a local path: ${name}`);
  }
}

function schemaIssues(
  file: string,
  issues: Array<{ message: string; path: PropertyKey[] }>
): WorkingCopyIssue[] {
  return issues.map((issue) => ({
    file,
    message: issue.message,
    ...(issue.path.length === 0 ? {} : { path: issue.path.map(String).join(".") })
  }));
}

function extractErrorIssues(file: string, error: unknown): WorkingCopyIssue[] {
  if (!isRecord(error) || !isRecord(error.details) || !Array.isArray(error.details.issues)) {
    return [];
  }
  return error.details.issues.flatMap((issue) => {
    if (!isRecord(issue) || typeof issue.message !== "string") {
      return [];
    }
    const path = Array.isArray(issue.path) ? issue.path.map(String).join(".") : undefined;
    return [{ file, message: issue.message, ...(path ? { path } : {}) }];
  });
}

function toRelativePath(root: string, path: string): string {
  return toPosixPath(relative(root, path));
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
