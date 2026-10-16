import yaml from "js-yaml";
import type { SkillStarterConfig } from "./asset-types";
import {
  SKILL_FRONTMATTER_FIELDS,
  SKILL_FRONTMATTER_MAX_BYTES,
  SKILL_FRONTMATTER_MAX_DEPTH,
  skillFileFrontmatterSchema
} from "./schemas";
import { yamlValueIssue, yamlValueIssueSentence } from "./yaml-bounds";
import { readYamlData } from "./yaml-data";

/**
 * Why a frontmatter is refused before its fields are read: for an alias, for its depth, or
 * for the size of what it holds beside the name, the title and the description.
 */
export type SkillFrontmatterRefusal =
  "skill_frontmatter_alias" | "skill_frontmatter_too_deep" | "skill_frontmatter_too_large";

/**
 * One thing that is wrong in a skill file: an invalid field by its path, or the place of the
 * file, by line and column, where its frontmatter stops being YAML.
 */
interface SkillMarkdownIssue {
  message: string;
  path: PropertyKey[];
  line?: number;
  column?: number;
}

/**
 * A skill file that cannot be read as a skill. `details.issues` names each invalid field, and
 * `reason` what refused the frontmatter as a whole.
 */
export class SkillMarkdownError extends Error {
  readonly details?: { issues: SkillMarkdownIssue[] };
  readonly reason?: SkillFrontmatterRefusal;

  constructor(
    message: string,
    details?: { issues: SkillMarkdownIssue[] },
    reason?: SkillFrontmatterRefusal
  ) {
    super(message);
    this.name = "SkillMarkdownError";
    this.details = details;
    this.reason = reason;
  }
}

/**
 * Reads a `SKILL.md`: YAML frontmatter with title and description, then the content. A file
 * without a name takes it from its folder, or from its own file name. `skillPath` separates
 * its segments with `/`. This module runs in a browser too, so it reads the path as text.
 */
export function parseSkillMarkdown(
  contents: string,
  skillFile: string,
  skillPath: string
): unknown {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(contents);
  if (!match) {
    throw new SkillMarkdownError(`Skill file '${skillFile}' must start with YAML frontmatter`);
  }

  const frontmatterRaw = loadFrontmatter(match[1] ?? "", skillFile);
  // The aliases are refused by the reader; what it took is held to the depth of a frontmatter.
  if (yamlValueIssue(frontmatterRaw, SKILL_FRONTMATTER_MAX_DEPTH) === "depth") {
    throw new SkillMarkdownError(
      `Skill file '${skillFile}' frontmatter is not read: ${yamlValueIssueSentence("depth", SKILL_FRONTMATTER_MAX_DEPTH)}`,
      undefined,
      "skill_frontmatter_too_deep"
    );
  }
  const frontmatter = skillFileFrontmatterSchema.safeParse(frontmatterRaw);
  if (!frontmatter.success) {
    throw new SkillMarkdownError(`Skill file '${skillFile}' frontmatter is invalid`, {
      issues: frontmatter.error.issues
    });
  }

  const content = (match[2] ?? "").trim();
  const { name: named, title, description, summary, starters, ...others } = frontmatter.data;
  const name = named ?? deriveSkillName(skillPath);
  // What the platform does not read is kept as JSON: a date of the YAML becomes its text.
  const json = JSON.stringify(others);
  if (json.length > SKILL_FRONTMATTER_MAX_BYTES) {
    throw new SkillMarkdownError(
      `Skill file '${skillFile}' holds ${json.length} characters of frontmatter beside the fields of the skill (${SKILL_FRONTMATTER_FIELDS.join(", ")}). It holds at most ${SKILL_FRONTMATTER_MAX_BYTES} (SKILL_FRONTMATTER_MAX_BYTES)`,
      undefined,
      "skill_frontmatter_too_large"
    );
  }
  const kept: unknown = JSON.parse(json);
  return {
    name,
    title: title ?? deriveSkillTitle(name, content),
    description,
    ...(summary === undefined ? {} : { summary }),
    ...(starters === undefined ? {} : { starters }),
    content,
    ...(Object.keys(others).length > 0 ? { frontmatter: kept } : {})
  };
}

/**
 * The frontmatter as the one reader of YAML reads it. A text that is no YAML is a skill file
 * that is refused, with the line and the column of the file the reader stopped at: a
 * description with an unquoted colon, a key written twice, a tag the reader does not know.
 * So is one with an alias, one nested deeper than the reader follows, and one that holds
 * text that cannot be stored.
 */
function loadFrontmatter(text: string, skillFile: string): unknown {
  const read = readYamlData(text, skillFile, { refuseAliases: true });
  if (read.ok) return read.value;
  const { issue } = read;
  if (issue.code === "yaml_alias") {
    throw new SkillMarkdownError(
      `Skill file '${skillFile}' frontmatter is not read: ${yamlValueIssueSentence("alias")}`,
      undefined,
      "skill_frontmatter_alias"
    );
  }
  if (issue.code === "yaml_too_deep") {
    throw new SkillMarkdownError(
      `Skill file '${skillFile}' frontmatter is not read: ${yamlValueIssueSentence("depth", SKILL_FRONTMATTER_MAX_DEPTH)}`,
      undefined,
      "skill_frontmatter_too_deep"
    );
  }
  if (issue.code !== "yaml_invalid" || issue.line === undefined || issue.column === undefined) {
    throw new SkillMarkdownError(`Skill file '${skillFile}' frontmatter: ${issue.message}`);
  }
  // The frontmatter begins on the second line of its file, below the `---`.
  const line = issue.line + 1;
  const { column } = issue;
  throw new SkillMarkdownError(
    `Skill file '${skillFile}' frontmatter is not valid YAML at line ${line}, column ${column}: ${issue.message} A value that holds a colon and a space, as a description often does, is written in quotes: description: "Use this when: the user asks"`,
    { issues: [{ message: issue.message, path: [], line, column }] }
  );
}

/**
 * The title a skill is shown under where its `SKILL.md` names none, as the public skill
 * convention does not: the first Markdown heading of its content, or else its name with
 * spaces for hyphens and underscores and a capital first letter.
 */
export function deriveSkillTitle(name: string, content: string): string {
  let fence: string | undefined;
  for (const line of content.split(/\r?\n/u)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      fence = fence === undefined ? marker : marker.startsWith(fence) ? undefined : fence;
      continue;
    }
    const heading = fence === undefined ? /^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/u.exec(line) : null;
    if (heading?.[1]) return heading[1];
  }
  const words = name.replace(/[-_]+/gu, " ").trim();
  return words === "" ? name : words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A `SKILL.md` of a skill's config: what `parseSkillMarkdown` reads back as the same name,
 * title, description, summary, starters, content and further frontmatter. A title the content
 * or the name gives anyway is left out, as a file of the public skill convention has none. It
 * is what a skill that was written as its config has for a file.
 */
export function formatSkillMarkdown(skill: {
  name: string;
  title: string;
  description: string;
  summary?: string;
  starters?: SkillStarterConfig[];
  content: string;
  frontmatter?: Record<string, unknown>;
}): string {
  const content = skill.content.trim();
  const frontmatter = yaml.dump(
    {
      name: skill.name,
      ...(skill.title === deriveSkillTitle(skill.name, content) ? {} : { title: skill.title }),
      description: skill.description,
      ...(skill.summary === undefined ? {} : { summary: skill.summary }),
      ...(skill.starters === undefined ? {} : { starters: skill.starters }),
      ...skill.frontmatter
    },
    { lineWidth: -1, noCompatMode: true, noRefs: true, sortKeys: false }
  );
  return `---\n${frontmatter}---\n\n${content}\n`;
}

function deriveSkillName(skillPath: string): string {
  const filename = lastSegment(skillPath);
  const sourceName =
    filename.toLowerCase() === "skill.md"
      ? lastSegment(parentPath(skillPath))
      : withoutExtension(filename);
  return sourceName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

function withoutTrailingSeparators(path: string): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") {
    end -= 1;
  }
  return path.slice(0, end);
}

function lastSegment(path: string): string {
  const trimmed = withoutTrailingSeparators(path);
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

function parentPath(path: string): string {
  const trimmed = withoutTrailingSeparators(path);
  return trimmed.slice(0, Math.max(trimmed.lastIndexOf("/"), 0));
}

/** A leading dot starts a hidden file's name, not an extension. */
function withoutExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}
