import yaml from "js-yaml";
import {
  agentConfigSchema,
  loadYamlData,
  parseSkillMarkdown,
  skillConfigSchema,
  type AgentConfig,
  type SkillConfig,
  type SkillStarterConfig
} from "@work-shape/catalyst-asset-schemas";

export interface AssetProvenance {
  instance: string;
  /** The instance's config version; a working copy of one Namespace does not read it. */
  version?: number;
}

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
  const agent = agentConfigSchema.parse(input);
  return {
    name: agent.name,
    displayName: agent.displayName,
    ...(agent.description === undefined ? {} : { description: agent.description }),
    ...(agent.welcomeMessage === undefined ? {} : { welcomeMessage: agent.welcomeMessage }),
    ...(agent.welcomeSubtitle === undefined ? {} : { welcomeSubtitle: agent.welcomeSubtitle }),
    instructions: agent.instructions,
    ...(agent.modelProviderId === undefined ? {} : { modelProviderId: agent.modelProviderId }),
    ...(agent.modelBindingId === undefined ? {} : { modelBindingId: agent.modelBindingId }),
    ...(agent.reasoningEffort === undefined ? {} : { reasoningEffort: agent.reasoningEffort }),
    ...(agent.fastMode ? { fastMode: true } : {}),
    ...(agent.userSelectableModelBindingIds?.length
      ? { userSelectableModelBindingIds: agent.userSelectableModelBindingIds }
      : {}),
    ...(Object.keys(agent.modelReasoningEfforts ?? {}).length
      ? { modelReasoningEfforts: agent.modelReasoningEfforts }
      : {}),
    ...(agent.maxSteps === undefined ? {} : { maxSteps: agent.maxSteps }),
    toolNames: agent.toolNames,
    skillNames: agent.skillNames,
    initialPrompts: agent.initialPrompts
  };
}

export function serializeAgentYaml(input: unknown, provenance?: AssetProvenance): string {
  const body = yaml.dump(canonicalizeAgentConfig(input), yamlDumpOptions);
  return provenance ? `${provenanceComments(provenance)}${body}` : body;
}

export function parseSkillFile(contents: string, skillFile = "SKILL.md"): SkillConfig {
  return skillConfigSchema.parse(parseSkillMarkdown(contents, skillFile, skillFile));
}

export function canonicalizeSkillConfig(input: unknown): SkillConfig {
  const skill = skillConfigSchema.parse(input);
  const resources = skill.resources
    ? [...skill.resources].sort((left, right) => left.path.localeCompare(right.path))
    : undefined;
  return {
    name: skill.name,
    title: skill.title,
    description: skill.description,
    ...(skill.summary === undefined ? {} : { summary: skill.summary }),
    ...(skill.starters?.length ? { starters: skill.starters.map(canonicalStarter) } : {}),
    content: skill.content,
    ...(resources?.length ? { resources } : {})
  };
}

/** A starter with its fields in the order a file writes them. */
function canonicalStarter(starter: SkillStarterConfig): SkillStarterConfig {
  return {
    title: starter.title,
    ...(starter.hint === undefined ? {} : { hint: starter.hint }),
    prompt: starter.prompt,
    ...(starter.tools?.length ? { tools: starter.tools } : {})
  };
}

export function serializeSkillMarkdown(input: unknown, provenance?: AssetProvenance): string {
  const skill = canonicalizeSkillConfig(input);
  const frontmatter = yaml.dump(
    {
      name: skill.name,
      title: skill.title,
      description: skill.description,
      ...(skill.summary === undefined ? {} : { summary: skill.summary }),
      ...(skill.starters === undefined ? {} : { starters: skill.starters })
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
