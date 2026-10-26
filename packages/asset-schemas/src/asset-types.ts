/**
 * The shape of an agent and of a skill as a file holds it. These are the public half of the
 * asset model: a working copy, the command line tool and the instance read the same types.
 */

/** The configuration rights reported for an asset; publish applies to draft/published kinds. */
export const ASSET_ACCESS_VERBS = ["read", "write", "delete", "publish"] as const;

export const localeCodes = ["en", "de"] as const;

export type LocaleCode = (typeof localeCodes)[number];

export type LocalizedStringConfig =
  | string
  | {
      en?: string;
      de?: string;
    };

export const REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffortConfig = (typeof REASONING_EFFORTS)[number];

export interface AgentInitialPromptConfig {
  title: LocalizedStringConfig;
  prompt: LocalizedStringConfig;
}

export interface AgentConfig {
  name: string;
  displayName: LocalizedStringConfig;
  description?: LocalizedStringConfig;
  welcomeMessage?: LocalizedStringConfig;
  welcomeSubtitle?: LocalizedStringConfig;
  instructions: string;
  modelProviderId?: string;
  modelBindingId?: string;
  reasoningEffort?: ReasoningEffortConfig;
  fastMode?: boolean;
  /**
   * Whether a run of the agent goes on on its model binding's `fallback` when that binding is
   * rate-limited or down. Unset is on.
   */
  useModelFallback?: boolean;
  /** Bindings users may pick for this agent in the chat, besides its own `modelBindingId`. */
  userSelectableModelBindingIds?: string[];
  /**
   * Reasoning effort per user-selectable binding. `reasoningEffort` stays the effort of the
   * agent's own model and is not applied to a model a user picked instead.
   */
  modelReasoningEfforts?: Record<string, ReasoningEffortConfig>;
  maxSteps?: number;
  toolNames: string[];
  /**
   * The other agents this agent may start as subagents with `run_agent`, besides itself. Each
   * is started only where the person may use it in the conversation's workspace.
   */
  subagentNames?: string[];
  skillNames: string[];
  /**
   * The Knowledge Bases the agent answers from, by id. However many it lists, the agent has one
   * tool over those of tables, `knowledge.query`, and one over those of documents,
   * `knowledge.search`. Missing means none.
   */
  knowledgeBases?: string[];
  initialPrompts: AgentInitialPromptConfig[];
  /**
   * An agent that ships with the platform: its fields as the release shipped them last. Only
   * the release seed writes it; every other write keeps it as stored.
   */
  shipped?: Record<string, unknown>;
}

export interface SkillConfig {
  name: string;
  title: string;
  /** For the agent: when to use the skill. */
  description: string;
  /**
   * For people: one sentence on one line that says what an agent with the skill knows how to
   * do. Lists and choosers show it under the title.
   */
  summary?: string;
  /** Up to `SKILL_STARTERS_MAX` first requests the empty chat offers for an agent with the skill. */
  starters?: SkillStarterConfig[];
  content: string;
  resources?: SkillResourceConfig[];
  /**
   * The files of the skill's folder that the config does not hold itself: everything beside
   * `SKILL.md` and the text resources, such as a script, a PDF or an image. An index and no
   * content. The platform writes it with the files; what a caller sends here is not read.
   */
  files?: SkillFileEntry[];
  /**
   * The keys of the frontmatter of `SKILL.md` that are not fields of the skill
   * (`SKILL_FRONTMATTER_FIELDS`), such as `license`, `metadata` and `allowed-tools` of the
   * public skill convention, as JSON values. They are kept and returned and never read by the
   * platform.
   */
  frontmatter?: Record<string, unknown>;
  /**
   * `release` on a skill that ships with the platform. Only the release seed writes it: every
   * other write of a skill that carries it is refused, and a stored one is read-only.
   */
  origin?: "release";
  /** The key of the interface's icon registry. Only a skill that ships with the platform has one. */
  icon?: string;
}

/** One file of a skill's folder as its index names it. */
export interface SkillFileEntry {
  /** Relative to the folder of the skill, with `/` between segments. */
  path: string;
  /** Lower-case hex. */
  sha256: string;
  bytes: number;
  mediaType: string;
}

/** How many starters one skill carries at most. */
export const SKILL_STARTERS_MAX = 2;
/** How many starters the empty chat shows for one agent at most. */
export const AGENT_STARTERS_MAX = 4;
/** The most characters a starter's `title` and its `hint` hold, in each language. */
export const SKILL_STARTER_LINE_MAX_LENGTH = 60;

/** One first request a skill offers on the empty chat. Choosing it fills the composer. */
export interface SkillStarterConfig {
  title: LocalizedStringConfig;
  /** One short line under the title. */
  hint?: LocalizedStringConfig;
  /** The text that fills the composer. */
  prompt: LocalizedStringConfig;
  /**
   * The tools the request needs. The starter shows only for an agent that holds every one of
   * them, so it never offers what the agent cannot do.
   */
  tools?: string[];
}

/** The most characters a skill's `summary` holds. */
export const SKILL_SUMMARY_MAX_LENGTH = 120;

/**
 * Who ships a skill, as a list says it: `instance` for a skill of the instance's own, `release`
 * for one that ships with the platform, which the release seed alone writes.
 */
export const SKILL_ORIGINS = ["instance", "release"] as const;

export type SkillOrigin = (typeof SKILL_ORIGINS)[number];

export const SKILL_RESOURCE_MEDIA_TYPES = [
  "text/markdown",
  "text/plain",
  "application/json",
  "application/yaml"
] as const;

export type SkillResourceMediaType = (typeof SKILL_RESOURCE_MEDIA_TYPES)[number];

export interface SkillResourceConfig {
  path: string;
  mediaType: SkillResourceMediaType;
  content: string;
}

/** Ordered from the narrowest App audience to the widest. */
export const APP_AUDIENCES = ["self", "workspace", "instance"] as const;
