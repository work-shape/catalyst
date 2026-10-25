/** The UTC counter windows, metrics and scopes a model usage refusal may name. */
export const MODEL_USAGE_LIMIT_PERIODS = ["day", "month"] as const;
export const MODEL_USAGE_LIMIT_METRICS = ["modelCallCount", "tokens", "costMicros"] as const;
export const MODEL_USAGE_LIMIT_SCOPES = ["instance", "user", "system", "workspace"] as const;

/**
 * Where an admin sets a spend limit (LU-2): the instance, one default for every shared
 * workspace and one for every user, and a value for one workspace or one user that replaces
 * that default.
 */
export const USAGE_SPEND_LIMIT_LEVELS = [
  "instance",
  "workspace_default",
  "workspace",
  "user_default",
  "user"
] as const;

/** The limit that refused a call: its period, what it counts, and whose counter it is. */
export interface ModelUsageRefusal {
  period: (typeof MODEL_USAGE_LIMIT_PERIODS)[number];
  metric: (typeof MODEL_USAGE_LIMIT_METRICS)[number];
  /**
   * `user`: the person's own calls. `system`: the calls the product makes for a person, or
   * those no person made. `workspace`: the calls inside one shared workspace. `instance`: the
   * spend budget everyone shares.
   */
  scope: (typeof MODEL_USAGE_LIMIT_SCOPES)[number];
}

/** The workspace key every Personal Workspace shares in the usage sums (LU-3): one row. */
export const PERSONAL_WORKSPACES_KEY = "personal";

/** What the Breakdown of the Usage page groups by (LU-3, limits spec 3.3, view 2). */
export const USAGE_BREAKDOWN_DIMENSIONS = [
  "workspace",
  "agent",
  "app",
  "workflow",
  "model",
  "origin"
] as const;

/**
 * Where usage came from (limits spec 3.2): a conversation, an App, a Workflow, Knowledge Base
 * ingestion, or a call the product made for itself, such as a title or a guardrail check.
 */
export const USAGE_ORIGINS = [
  "conversation",
  "app",
  "workflow",
  "knowledge_base",
  "system"
] as const;
