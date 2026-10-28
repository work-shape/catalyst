import yaml from "js-yaml";
import {
  agentConfigSchema,
  loadYamlData,
  parseSkillMarkdown,
  skillConfigSchema,
  type AgentConfig,
  SKILL_FRONTMATTER_FIELDS,
  type SkillConfig
} from "@work-shape/catalyst-asset-schemas";

export interface AssetProvenance {
  instance: string;
  /** The instance's config version; a working copy of one workspace does not read it. */
  version?: number;
}

/** Bump when a working copy's field projection or content hashing changes. */
export const CANONICAL_FORM_VERSION = 2;

const yamlDumpOptions: yaml.DumpOptions = {
  lineWidth: -1,
  noCompatMode: true,
  noRefs: true,
  sortKeys: false
};

export function parseAgentYaml(contents: string): AgentConfig {
  return agentConfigSchema.parse(loadYamlData(contents, "agent YAML"));
}

export function canonicalizeAgentConfig(input: unknown): AgentConfig {
  // What the release shipped of a shipped agent, and which fields it shipped anew, travel with
  // the server asset alone: only the release seed writes them and a push that leaves them out
  // keeps them, so they count as no local change.
  const {
    shipped: _shipped,
    shippedNewer: _shippedNewer,
    ...agent
  } = agentConfigSchema.parse(sortKeys(agentConfigSchema.parse(input)));
  return agent;
}

export function serializeAgentYaml(input: unknown, provenance?: AssetProvenance): string {
  const body = yaml.dump(canonicalizeAgentConfig(input), yamlDumpOptions);
  return provenance ? `${provenanceComments(provenance)}${body}` : body;
}

export function parseSkillFile(contents: string, skillFile = "SKILL.md"): SkillConfig {
  return skillConfigSchema.parse(parseSkillMarkdown(contents, skillFile, skillFile));
}

export function canonicalizeSkillConfig(input: unknown): SkillConfig {
  // These fields travel with the server asset, but SKILL.md and its text resources do not
  // represent them. They cannot count as local changes or be sent as working-copy edits.
  const {
    files: _files,
    icon: _icon,
    origin: _origin,
    resources,
    frontmatter,
    ...skill
  } = skillConfigSchema.parse(sortKeys(skillConfigSchema.parse(input)));
  return {
    ...skill,
    ...(frontmatter === undefined || Object.keys(frontmatter).length === 0 ? {} : { frontmatter }),
    ...(resources?.length
      ? { resources: [...resources].sort((left, right) => left.path.localeCompare(right.path)) }
      : {})
  };
}

/** Schema parsing orders declared fields; sorting first also stabilizes free-form maps. */
// Persisted YAML uses locale ordering (including accented keys), unlike core canonicalJson.
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortKeys(item)])
  );
}

export function serializeSkillMarkdown(input: unknown, provenance?: AssetProvenance): string {
  const skill = canonicalizeSkillConfig(input);
  const frontmatter = yaml.dump(
    {
      ...skill.frontmatter,
      ...Object.fromEntries(
        SKILL_FRONTMATTER_FIELDS.flatMap((key) =>
          skill[key] === undefined ? [] : [[key, skill[key]]]
        )
      )
    },
    yamlDumpOptions
  );
  const comments = provenance ? provenanceComments(provenance) : "";
  return `---\n${comments}${frontmatter}---\n\n${skill.content.trim()}\n`;
}

export function serializeSkillPackageForDisplay(input: unknown): string {
  const skill = canonicalizeSkillConfig(input);
  const root = serializeSkillMarkdown(skill).trimEnd();
  const resources = (skill.resources ?? []).map(
    (resource) =>
      `===== ${resource.path} (${resource.mediaType}) =====\n\n${resource.content.trimEnd()}`
  );
  return [root, ...resources].join("\n\n");
}

function provenanceComments(provenance: AssetProvenance): string {
  const instance = provenance.instance.replaceAll(/[\r\n]+/gu, " ");
  return (
    `# Pulled from ${instance}${provenance.version === undefined ? "" : ` (config version ${provenance.version})`}.\n` +
    "# Local edits are NOT live until 'catalyst config push'.\n"
  );
}
