/**
 * The values the HTTP contract of an instance is written with: scopes, actions, error codes
 * and the limits a request is checked against. They hold no behaviour. The private packages
 * of the platform read them from here, so that the contract and what enforces it cannot
 * drift apart.
 */

import { AGENT_ACTIONS } from "./contract-values/agent";
import { SKILL_ACTIONS } from "./contract-values/skill";
import { CONNECTION_ACTIONS } from "./contract-values/connection";
import { APP_ACTIONS } from "./contract-values/app";
import { WORKFLOW_ACTIONS } from "./contract-values/workflow";
import { DATA_STORE_ACTIONS } from "./contract-values/data-store";
import { KNOWLEDGE_BASE_ACTIONS } from "./contract-values/knowledge-base";
import { MAIL_SENDER_ACTIONS } from "./contract-values/mail-sender";
import { GUARDRAIL_ACTIONS } from "./contract-values/guardrail";
import { OPERATIONS_ACTIONS } from "./contract-values/operations";
import { FEEDBACK_ACTIONS } from "./contract-values/feedback";
import { ADMINISTRATION_ACTIONS } from "./contract-values/administration";
import { WORKSPACE_ACTIONS } from "./contract-values/workspace";

export const AUTH_SCOPE_WILDCARD = "*" as const;

export const CHAT_SESSION_AUTH_SCOPES = [
  "me:read",
  "me:delete",
  "config:read",
  "conversation:read",
  "conversation:write",
  "run:start",
  "run:observe",
  "run:cancel",
  "run:command"
] as const;

export const FIRST_PARTY_AUTH_SCOPES = [
  AUTH_SCOPE_WILDCARD,
  ...CHAT_SESSION_AUTH_SCOPES,
  "collaboration_workspace:read",
  "collaboration_workspace:manage",
  "me:write",
  "governance:read",
  "governance:write",
  "user_admin:read",
  "user_admin:write",
  // A personal key can check providers without reaching other user administration routes.
  "infrastructure:check",
  "api_access:read",
  "api_access:write",
  "config_assets:read",
  "config_assets:write",
  // Moving the published pointer of an asset. A credential that writes drafts with
  // `config_assets:write` publishes none of them without this one.
  "config_assets:publish",
  "config_assets:release",
  // The rows of a Data Store: reading them, and adding or loading them. The definition of a
  // store and its migrations stay under `config_assets:*`. A scope caps what a key may be
  // used for; whether its holder may do it is decided by the grants.
  "data_store_rows:read",
  "data_store_rows:write"
] as const;

export type ChatSessionAuthScope = (typeof CHAT_SESSION_AUTH_SCOPES)[number];
export type FirstPartyAuthScope = (typeof FIRST_PARTY_AUTH_SCOPES)[number];
export type OperationScope = Exclude<FirstPartyAuthScope, "*">;

/**
 * Every right of the platform, one file per domain under `contract-values/`. The order is kept:
 * `GRANTABLE_ACTIONS` filters it, and the rights dialog lists rights in it.
 */
export const ACTIONS = [
  ...AGENT_ACTIONS,
  ...SKILL_ACTIONS,
  ...CONNECTION_ACTIONS,
  ...APP_ACTIONS,
  ...WORKFLOW_ACTIONS,
  ...DATA_STORE_ACTIONS,
  ...KNOWLEDGE_BASE_ACTIONS,
  ...MAIL_SENDER_ACTIONS,
  ...GUARDRAIL_ACTIONS,
  ...OPERATIONS_ACTIONS,
  ...FEEDBACK_ACTIONS,
  ...ADMINISTRATION_ACTIONS,
  ...WORKSPACE_ACTIONS
] as const;

export type PlatformAction = (typeof ACTIONS)[number];

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

/** The HTTP status every error code answers with. */
export const APP_ERROR_STATUS_CODES: Record<AppErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  REVISION_CONFLICT: 412,
  PRECONDITION_REQUIRED: 428,
  TIMEOUT: 504,
  VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  POLICY_DENIED: 403,
  GUARDRAIL_BLOCKED: 403,
  DECLINED: 403,
  IDEMPOTENCY_KEY_REUSED: 409,
  OPERATION_IN_PROGRESS: 409,
  OPERATION_EXPIRED: 409,
  OUTPUT_NOT_RETAINED: 409,
  INTERNAL: 500
};

export type OperationEffect = (typeof OPERATION_EFFECTS)[number];

/**
 * The longest `Idempotency-Key` a caller may send, in characters. It protects the index the
 * key is looked up in. A longer key is refused with VALIDATION_FAILED naming this limit.
 */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

/** What an instance takes from outside its own processes. A closed list. */
export const PROVIDER_PORTS = ["models", "mail", "objectStorage", "sandbox", "secrets"] as const;
export type ProviderPort = (typeof PROVIDER_PORTS)[number];

/**
 * Where a provider processes the data an instance sends it. Only `eu` admits personal
 * Connections; other short strings describe routes outside that boundary.
 */
export const PROVIDER_REGIONS = ["eu", "global"] as const;
export type ProviderRegion = string;

/**
 * Why a check failed. Product-owned and closed: it is all of a failure that reaches a log, the
 * API or a page, so a provider's own error text, which can repeat a key or an address, cannot.
 */
export const PROVIDER_CHECK_ERROR_CLASSES = [
  "unreachable",
  "timeout",
  "access_denied",
  "not_found",
  // The bucket an object store is configured with does not exist. The check creates none.
  "bucket_missing",
  "rejected",
  "failed"
] as const;
export type ProviderCheckErrorClass = (typeof PROVIDER_CHECK_ERROR_CLASSES)[number];

/**
 * The immutable machine name. It is part of every operation name of the Connection
 * (`connection.<name>.<operation>`), so it holds no dot.
 */
export const CONNECTION_NAME_PATTERN = /^[a-z][a-z0-9]*([_-][a-z0-9]+)*$/u;
export const CONNECTION_NAME_MAX_LENGTH = 64;

/**
 * The immutable machine name of a Guardrail. An approval request keeps it as the id of the
 * check that answered, and its hits are kept under it.
 */
export const GUARDRAIL_NAME_PATTERN = /^[a-z][a-z0-9]*([_-][a-z0-9]+)*$/u;
export const GUARDRAIL_NAME_MAX_LENGTH = 64;

/**
 * Who may call an accepted operation. An operation exposed to nobody is callable by nobody.
 * `outside` admits the CLI and the platform MCP server, a caller with an API credential whose
 * results leave the instance; no operation has it unless an admin turns it on.
 */
export const CONNECTION_EXPOSURES = ["agent", "bridge", "workflow", "outside"] as const;
export type ConnectionExposure = (typeof CONNECTION_EXPOSURES)[number];

/** The health of a Connection as its page and its list show it. */
export const CONNECTION_HEALTH_STATES = [
  "unknown",
  "ok",
  "failed",
  "needs_configuration",
  "secret_unreadable"
] as const;
export type ConnectionHealth = (typeof CONNECTION_HEALTH_STATES)[number];

export const GRANT_HOLDER_KINDS = ["user", "service_principal", "role", "group"] as const;
export type GrantHolderKind = (typeof GRANT_HOLDER_KINDS)[number];

export const GRANT_SCOPE_KINDS = ["instance", "workspace", "asset"] as const;
export type GrantScopeKind = (typeof GRANT_SCOPE_KINDS)[number];

/** Where a role's grant lies: the whole instance, one workspace or one asset. */
export const ROLE_GRANT_SCOPE_KINDS = [
  "instance",
  "workspace",
  "asset"
] as const satisfies readonly GrantScopeKind[];
export type RoleGrantScopeKind = (typeof ROLE_GRANT_SCOPE_KINDS)[number];

/** What a release did to an action of a built-in role's default that waits for a decision. */
export const ROLE_PENDING_CHANGES = ["added", "removed"] as const;

/** The decision on a pending action: apply what the release did, or dismiss it. */
export const ROLE_PENDING_DECISIONS = ["apply", "dismiss"] as const;
export type RolePendingDecision = (typeof ROLE_PENDING_DECISIONS)[number];

export const GRANT_EFFECTS = ["allow", "deny"] as const;
export type GrantEffect = (typeof GRANT_EFFECTS)[number];

export const ACCESS_SOURCES = ["role", "legacy_ref", "grant", "membership"] as const;
export type AccessSource = (typeof ACCESS_SOURCES)[number];

export const POLICY_VALUES = ["allow", "confirm", "approval", "deny"] as const;
export type PolicyValue = (typeof POLICY_VALUES)[number];

export const AUTH_PRINCIPAL_KINDS = ["user", "service"] as const;
export type AuthPrincipalKind = (typeof AUTH_PRINCIPAL_KINDS)[number];

export const ADMINISTERED_USER_STATUSES = ["active", "disabled", "deleting"] as const;
export type AdministeredUserStatus = (typeof ADMINISTERED_USER_STATUSES)[number];

export const SERVICE_PRINCIPAL_STATUSES = ["active", "disabled"] as const;
export type ServicePrincipalStatus = (typeof SERVICE_PRINCIPAL_STATUSES)[number];

/**
 * When the account a Workflow runs as needs a right its definition names. `publish`: the
 * publish is refused without it. `run`: the step that needs it fails when it runs.
 */
export const WORKFLOW_RIGHT_NEEDED_FOR = ["publish", "run"] as const;
/** The revision of a publish's Workflow the rights are read from: the one published, or a live child. */
export const WORKFLOW_RIGHTS_REVISIONS = ["draft", "published"] as const;
/** How the account a Workflow names stands: a principal's status, or no principal of the name. */
export const WORKFLOW_RUN_ACCOUNT_STATUSES = [...SERVICE_PRINCIPAL_STATUSES, "unknown"] as const;
/**
 * Why a reader cannot give an account a right it lacks. `not_grantable`: nobody can give it to
 * an account here. `not_administrator`: giving needs someone who administers technical
 * accounts. `not_held`: the reader does not hold it there. `account_unavailable`: the account
 * is missing or disabled. `asset_unavailable`: no active asset of the name exists.
 */
export const WORKFLOW_RIGHT_REFUSALS = [
  "not_grantable",
  "not_administrator",
  "not_held",
  "account_unavailable",
  "asset_unavailable",
  "not_visible"
] as const;

export const SERVICE_PRINCIPAL_PERMISSIONS = [
  "config_assets.read",
  "config_assets.release"
] as const;
export type ServicePrincipalPermission = (typeof SERVICE_PRINCIPAL_PERMISSIONS)[number];

export const API_CREDENTIAL_SCOPES = [
  "config_assets:read",
  "config_assets:release"
] as const satisfies readonly FirstPartyAuthScope[];
export type ApiCredentialScope = (typeof API_CREDENTIAL_SCOPES)[number];

export const APP_ERROR_CODES = [
  "BAD_REQUEST",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "REVISION_CONFLICT",
  "PRECONDITION_REQUIRED",
  "TIMEOUT",
  "VALIDATION_FAILED",
  "RATE_LIMITED",
  "POLICY_DENIED",
  "GUARDRAIL_BLOCKED",
  "DECLINED",
  "IDEMPOTENCY_KEY_REUSED",
  "OPERATION_IN_PROGRESS",
  "OPERATION_EXPIRED",
  "OUTPUT_NOT_RETAINED",
  "INTERNAL"
] as const;

export const OPERATION_EFFECTS = ["reading", "changing"] as const;

/** The parts a catalogue entry can bring: tools agents call, or a Knowledge Base source. */
export const CATALOGUE_PARTS = ["tools", "source"] as const;
export type CataloguePart = (typeof CATALOGUE_PARTS)[number];

/** The categories a catalogue entry's card is filed under. */
export const CATALOGUE_CATEGORIES = ["mail", "files", "accounting", "databases", "other"] as const;
export type CatalogueCategory = (typeof CATALOGUE_CATEGORIES)[number];

export const OPERATION_TARGETS = ["live", "test", "dry_run"] as const;
export type OperationTarget = (typeof OPERATION_TARGETS)[number];

export const OPERATION_RUN_STATUSES = [
  "running",
  "pending_confirmation",
  "pending_approval",
  "done",
  "failed",
  "denied",
  "expired"
] as const;
export type OperationRunStatus = (typeof OPERATION_RUN_STATUSES)[number];

export const OPERATION_ORIGIN_KINDS = [
  "agent",
  "user",
  "cli",
  "mcp",
  "app",
  "workflow",
  "schedule"
] as const;
export type OperationOriginKind = (typeof OPERATION_ORIGIN_KINDS)[number];

export const OPERATION_RUN_DECISION_MODES = [
  "direct",
  "confirmed",
  "approved",
  "declined"
] as const;
export type OperationRunDecisionMode = (typeof OPERATION_RUN_DECISION_MODES)[number];

export const OPERATION_RUN_DECISION_REASONS = [
  "inherited_approval_not_applied",
  "workflow_publish",
  "approved_by_caller"
] as const;
export type OperationRunDecisionReason = (typeof OPERATION_RUN_DECISION_REASONS)[number];

export const OPERATION_DENIAL_REASONS = [
  "no_grant",
  "denied",
  "unknown_action",
  "holder_inactive",
  "holder_not_administrable",
  "user_only",
  "outside_key_scope"
] as const;
export type OperationDenialReason = (typeof OPERATION_DENIAL_REASONS)[number];

export const APPROVAL_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "changes_requested",
  "superseded",
  "withdrawn",
  "reverted"
] as const;
export type ApprovalRequestStatus = (typeof APPROVAL_REQUEST_STATUSES)[number];

export const APPROVAL_CHECK_STATUSES = ["passed", "warned", "blocked"] as const;
export type ApprovalCheckStatus = (typeof APPROVAL_CHECK_STATUSES)[number];

export const APPROVAL_EXECUTIONS = [
  "queued",
  "done",
  "failed",
  "interrupted",
  "refused",
  "expired",
  // A confirmation in the Inbox whose Allow left the call waiting for an approver: it ended
  // here, and the call waits as the approval request `approvalRequestId` of `applyResult`.
  "held"
] as const;
export type ApprovalExecution = (typeof APPROVAL_EXECUTIONS)[number];

export const SKILL_CHANGE_TYPES = ["replace", "add", "new_resource"] as const;
export type SkillChangeType = (typeof SKILL_CHANGE_TYPES)[number];

export const GUARDRAIL_OUTCOMES = ["allow", "warn", "require_approval", "block"] as const;
export type GuardrailOutcome = (typeof GUARDRAIL_OUTCOMES)[number];

export const APP_MODES = ["published", "draft"] as const;
export type AppMode = (typeof APP_MODES)[number];

export const ASSET_NAME_REFUSAL_REASONS = ["name_invalid", "name_taken"] as const;
export type AssetNameRefusalReason = (typeof ASSET_NAME_REFUSAL_REASONS)[number];

export const ASSET_SYNC_CHANGE_TYPES = ["put", "delete"] as const;
export type AssetSyncChangeType = (typeof ASSET_SYNC_CHANGE_TYPES)[number];

export const ASSET_LIFECYCLES = ["active", "draft_published"] as const;
export type AssetLifecycle = (typeof ASSET_LIFECYCLES)[number];

export const ASSET_REPRESENTATIONS = ["config", "files"] as const;
export type AssetRepresentation = (typeof ASSET_REPRESENTATIONS)[number];

export const CONFIG_ASSET_KINDS = ["agent", "skill"] as const;
export type ConfigAssetKind = (typeof CONFIG_ASSET_KINDS)[number];

export const CONFIG_ASSET_CHANGE_OPERATIONS = ["create", "update", "delete", "revert"] as const;
export type ConfigAssetChangeOperation = (typeof CONFIG_ASSET_CHANGE_OPERATIONS)[number];

export const AGENT_AVAILABILITY_MODES = ["all", "selected"] as const;
export type AgentAvailabilityMode = (typeof AGENT_AVAILABILITY_MODES)[number];

/**
 * Who uses an agent where it is available (AGENT-USE-1): everyone who may work there, or only
 * those `agent.use` allows on it. Every agent starts at `everyone`.
 */
export const AGENT_USE_SETTINGS = ["everyone", "granted"] as const;
export type AgentUse = (typeof AGENT_USE_SETTINGS)[number];

export const AGENT_EDITABLE_FIELDS = [
  "displayName",
  "description",
  "welcomeMessage",
  "welcomeSubtitle",
  "instructions",
  "modelBindingId",
  "reasoningEffort",
  "maxSteps",
  "toolNames",
  "skillNames",
  "knowledgeBases",
  "initialPrompts"
] as const;
export type AgentEditableField = (typeof AGENT_EDITABLE_FIELDS)[number];

export const ASSET_REPO_BUNDLE_KINDS = ["full", "incremental"] as const;
export type AssetRepoBundleKind = (typeof ASSET_REPO_BUNDLE_KINDS)[number];

export const WORKSPACE_FILE_KINDS = ["page", "upload", "generated_file"] as const;
export type WorkspaceFileKind = (typeof WORKSPACE_FILE_KINDS)[number];

export const WORKSPACE_VISIBILITIES = ["discoverable", "private"] as const;
export type WorkspaceVisibility = (typeof WORKSPACE_VISIBILITIES)[number];

export const WORKSPACE_MEMBERSHIP_ROLES = ["owner", "admin", "member"] as const;
export type WorkspaceMembershipRole = (typeof WORKSPACE_MEMBERSHIP_ROLES)[number];

export const WORKSPACE_ACCENT_COLORS = [
  "garnet",
  "ruby",
  "mahogany",
  "copper",
  "amber",
  "olive",
  "jade",
  "emerald",
  "teal",
  "turquoise",
  "azure",
  "sapphire",
  "indigo",
  "violet",
  "magenta",
  "rose",
  "stone",
  "slate"
] as const;
export type WorkspaceAccentColor = (typeof WORKSPACE_ACCENT_COLORS)[number];

export const COLLABORATION_WORKSPACE_KINDS = ["personal", "shared"] as const;
export type CollaborationWorkspaceKind = (typeof COLLABORATION_WORKSPACE_KINDS)[number];

export const WORKSPACE_ACCESS_STATES = ["member", "request_pending", "can_request"] as const;
export type WorkspaceAccessState = (typeof WORKSPACE_ACCESS_STATES)[number];

export const DELETION_STATES = ["deleting", "deleted"] as const;
export type DeletionState = (typeof DELETION_STATES)[number];

export const WORKSPACE_SECTIONS = ["agents", "apps"] as const;
export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];

export const MODEL_USAGE_TIERS = [
  "very_low",
  "low",
  "moderate",
  "elevated",
  "high",
  "very_high"
] as const;
export type ModelUsageTier = (typeof MODEL_USAGE_TIERS)[number];

export const THEME_MODE_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemeModePreference = (typeof THEME_MODE_PREFERENCES)[number];

export const TOOL_GROUPS = [
  "documents",
  "web",
  "files",
  "results",
  "skills",
  "platform",
  "instance"
] as const;
export type ToolGroup = (typeof TOOL_GROUPS)[number];

export const INFRASTRUCTURE_SECRET_STATES = ["set", "missing"] as const;
export type InfrastructureSecretState = (typeof INFRASTRUCTURE_SECRET_STATES)[number];

export const INFRASTRUCTURE_WITHHELD_FIELDS = ["endpointHost", "bucket"] as const;
export type InfrastructureWithheldField = (typeof INFRASTRUCTURE_WITHHELD_FIELDS)[number];

export const OPENAI_COMPATIBLE_APIS = ["chat_completions", "responses"] as const;
export type OpenaiCompatibleApi = (typeof OPENAI_COMPATIBLE_APIS)[number];

export const MODEL_PROVIDER_AUTH_MODES = ["bearer", "api-key"] as const;
export type ModelProviderAuthMode = (typeof MODEL_PROVIDER_AUTH_MODES)[number];

export const CONVERSATION_VISIBILITIES = ["workspace", "private"] as const;
/** A conversation a person has, or the run thread of a Child Agent Run. */
export const CONVERSATION_KINDS = ["chat", "run_thread"] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];
export type ConversationVisibility = (typeof CONVERSATION_VISIBILITIES)[number];

export const WEB_SOURCE_PROVIDERS = [
  "openai-native",
  "serper",
  "tavily",
  "firecrawl",
  "browserbase",
  "direct"
] as const;
export type WebSourceProvider = (typeof WEB_SOURCE_PROVIDERS)[number];

export const CHAT_MESSAGE_ROLES = ["user", "assistant", "system", "tool"] as const;
export type ChatMessageRole = (typeof CHAT_MESSAGE_ROLES)[number];

export const CONVERSATION_ATTACHMENT_STATUSES = [
  "queued",
  "preprocessing",
  "ready",
  "failed",
  "unsupported",
  "deleted"
] as const;
export type ConversationAttachmentStatus = (typeof CONVERSATION_ATTACHMENT_STATUSES)[number];

export const ATTACHMENT_CREATE_OUTCOMES = ["created", "already_available"] as const;
export type AttachmentCreateOutcome = (typeof ATTACHMENT_CREATE_OUTCOMES)[number];

export const STRUCTURED_DATA_REVIEW_REASONS = ["uncertain", "conflicting"] as const;
export type StructuredDataReviewReason = (typeof STRUCTURED_DATA_REVIEW_REASONS)[number];

/** Queued: sent as the next turn. Steer: taken in by the author's own running turn (FU-2). */
export const FOLLOW_UP_MODES = ["queue", "steer"] as const;
/** `consumed`: a steer the running turn took in; `dispatched`: started as a turn of its own. */
export const FOLLOW_UP_STATUSES = ["pending", "dispatched", "consumed", "cancelled"] as const;

export const AGENT_RUN_STATUSES = [
  "queued",
  "running",
  "waiting_for_decision",
  "waiting_for_subagents",
  "cancelling",
  "completed",
  "cancelled",
  "failed"
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const AGENT_RUN_FAILURE_CATEGORIES = [
  "app_error",
  "internal_error",
  "runtime_interrupted",
  "abort_error",
  "unknown_error"
] as const;
export type AgentRunFailureCategory = (typeof AGENT_RUN_FAILURE_CATEGORIES)[number];

export const TOOL_INPUT_PARSE_ERROR_CODES = ["invalid_json", "invalid_text"] as const;
export type ToolInputParseErrorCode = (typeof TOOL_INPUT_PARSE_ERROR_CODES)[number];

export const WAITING_OPERATION_RUN_STATUSES = [
  "pending_confirmation",
  "pending_approval"
] as const satisfies readonly OperationRunStatus[];

export const OPERATION_CONFIRMATION_DECISIONS = ["confirm", "decline"] as const;
/** A person's own value for an operation (OP-6): Always allow, Ask me, Never. */
export const PERSON_POLICY_SETTINGS = ["always_allow", "ask", "never"] as const;
/** How far a changing operation reaches. One that declares none counts as `irreversible`. */
export const OPERATION_CHANGE_CLASSES = ["reversible", "irreversible", "outward"] as const;
export const TOOL_DECISION_MODES = ["confirm", "approval"] as const;
export const TOOL_DECISION_OUTCOMES = ["confirmed", "declined", "expired", "cancelled"] as const;

export const TOOL_CALL_STATES = [
  "input_available",
  "waiting_for_decision",
  "output_available",
  "output_error"
] as const;
export type ToolCallState = (typeof TOOL_CALL_STATES)[number];

export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
] as const;
export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

export const ARTIFACT_PREVIEW_IMAGE_FORMATS = ["png", "webp", "jpeg"] as const;
export type ArtifactPreviewImageFormat = (typeof ARTIFACT_PREVIEW_IMAGE_FORMATS)[number];

export const ARTIFACT_PREVIEW_STATUSES = ["ready", "pending", "failed", "unsupported"] as const;
export type ArtifactPreviewStatus = (typeof ARTIFACT_PREVIEW_STATUSES)[number];

export const WORKSPACE_COMMAND_STATUSES = [
  "queued",
  "running",
  "cancelling",
  "completed",
  "failed",
  "cancelled"
] as const;
export type WorkspaceCommandStatus = (typeof WORKSPACE_COMMAND_STATUSES)[number];

export const TOOL_DISPLAY_MODES = ["inline", "side_panel", "fullscreen"] as const;
export type ToolDisplayMode = (typeof TOOL_DISPLAY_MODES)[number];

export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "dead",
  "cancelled"
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const AUDIT_ACTOR_KINDS = ["user", "assistant", "service", "system"] as const;
export type AuditActorKind = (typeof AUDIT_ACTOR_KINDS)[number];

export const AUDIT_TIERS = ["governance", "workflow", "runtime", "telemetry"] as const;
export type AuditTier = (typeof AUDIT_TIERS)[number];

export const AUDIT_OUTCOMES = ["success", "failed", "denied", "warning"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export const MODEL_USAGE_EVENT_STATUSES = ["pending", "settled", "failed", "abandoned"] as const;
export type ModelUsageEventStatus = (typeof MODEL_USAGE_EVENT_STATUSES)[number];

export const MODEL_USAGE_SOURCES = ["provider_reported", "not_reported", "estimated"] as const;
export type ModelUsageSource = (typeof MODEL_USAGE_SOURCES)[number];

export const USAGE_COST_STATUSES = ["settled", "incomplete", "unpriced"] as const;
export type UsageCostStatus = (typeof USAGE_COST_STATUSES)[number];

export const CONNECTION_OPERATION_STATUSES = [
  "ready",
  /** Accepted, a discovering type, and no discovery has pinned it yet. */
  "awaiting_discovery",
  /** The catalog's fingerprint differs from the accepted one. */
  "needs_review",
  /** Accepted, and the last discovery did not list it or listed a schema nothing can check. */
  "unknown",
  "disabled"
] as const;
export type ConnectionOperationStatus = (typeof CONNECTION_OPERATION_STATUSES)[number];

export const CONNECTION_SECRET_STATES = ["set", "not_set", "unreadable"] as const;
export type ConnectionSecretState = (typeof CONNECTION_SECRET_STATES)[number];

export const CONNECTOR_TEST_STATUSES = [
  "ready",
  "unauthorized",
  "network_denied",
  "unavailable",
  /** The server asks for an OAuth sign-in, or the Connection signs in and nobody has. */
  "oauth_required"
] as const;
export type ConnectorTestStatus = (typeof CONNECTOR_TEST_STATUSES)[number];

/** Shared account, or the acting person's own account. */
export const CONNECTION_CREDENTIAL_MODES = ["shared", "user"] as const;
export type ConnectionCredentialMode = (typeof CONNECTION_CREDENTIAL_MODES)[number];

/**
 * The state of a Connection's sign-in. `connected`: calls use it. `needs_reconnect`: the
 * outside system refused it and a new sign-in is needed. `revoked`: someone disconnected it,
 * or its Connection went away.
 */
export const CONNECTION_BINDING_STATES = ["connected", "needs_reconnect", "revoked"] as const;
export type ConnectionBindingState = (typeof CONNECTION_BINDING_STATES)[number];

/** What a chat Connection proposal's card needs to start setup or sign-in. */
export const CONNECTION_PROPOSAL_STATES = ["ready", "needs_setup"] as const;
export type ConnectionProposalState = (typeof CONNECTION_PROPOSAL_STATES)[number];
export const CONNECTION_PROPOSAL_BINDING_STATES = [
  "connected",
  "needs_reconnect",
  "not_connected"
] as const;
export type ConnectionProposalBindingState = (typeof CONNECTION_PROPOSAL_BINDING_STATES)[number];

/** What a refused call of a personal Connection needs of its person: a first or a new sign-in. */
export const CONNECTION_SIGN_IN_NEEDS = ["not_connected", "needs_reconnect"] as const;
export type ConnectionSignInNeed = (typeof CONNECTION_SIGN_IN_NEEDS)[number];

/**
 * How a Connection that signs in with OAuth has its client: registered by the platform
 * (Dynamic Client Registration), issued by the provider and named in the settings, or the
 * operator's managed client of release config (`infrastructure.oauthClients`, MS-APP-1).
 */
export const CONNECTION_OAUTH_REGISTRATIONS = ["dcr", "preregistered", "managed"] as const;
export type ConnectionOAuthRegistration = (typeof CONNECTION_OAUTH_REGISTRATIONS)[number];

/**
 * What the provider answered to the revocation of a sign-in (RFC 7009): it confirmed, it
 * failed or was not reached, or it lists no revocation endpoint and was sent nothing.
 */
export const CONNECTION_PROVIDER_REVOCATIONS = ["confirmed", "failed", "not_offered"] as const;
export type ConnectionProviderRevocation = (typeof CONNECTION_PROVIDER_REVOCATIONS)[number];

export const CONNECTION_ORIGINS = ["release", "runtime"] as const;
export type ConnectionOrigin = (typeof CONNECTION_ORIGINS)[number];

export const CONNECTION_NETWORKS = ["public", "private"] as const;
export type ConnectionNetwork = (typeof CONNECTION_NETWORKS)[number];

export const DATA_STORE_SCALAR_TYPES = [
  "text",
  "integer",
  "number",
  "boolean",
  "date",
  "timestamp"
] as const;
export type DataStoreScalarType = (typeof DATA_STORE_SCALAR_TYPES)[number];

export const DATA_STORE_LOAD_CONFLICT_MODES = ["fail", "skip", "update"] as const;
export type DataStoreLoadConflictMode = (typeof DATA_STORE_LOAD_CONFLICT_MODES)[number];

export const DATA_STORE_INSERT_CONFLICT_MODES = [
  "fail",
  "skip"
] as const satisfies readonly DataStoreLoadConflictMode[];
export type DataStoreInsertConflictMode = (typeof DATA_STORE_INSERT_CONFLICT_MODES)[number];

export const DATA_STORE_CONDITIONS = [
  "server_databases_open",
  "sessions_open",
  "temp_files_unbounded"
] as const;
export type DataStoreCondition = (typeof DATA_STORE_CONDITIONS)[number];

export const DATA_STORE_STATUSES = ["provisioning", "ready", "retired"] as const;
export type DataStoreStatus = (typeof DATA_STORE_STATUSES)[number];

export const DATA_STORE_MIGRATION_OUTCOMES = ["none", "pending", "applied", "failed"] as const;
export type DataStoreMigrationOutcome = (typeof DATA_STORE_MIGRATION_OUTCOMES)[number];

/**
 * `unchecked` until the first check; `preparing` while the store a Knowledge Base of documents
 * owns is still being made; then `ok` or `needs_attention`.
 */
export const KNOWLEDGE_BASE_STATUSES = ["unchecked", "preparing", "ok", "needs_attention"] as const;
export type KnowledgeBaseStatus = (typeof KNOWLEDGE_BASE_STATUSES)[number];

/**
 * The embedding of a Knowledge Base that searches by meaning. `current`: its index embeds with
 * the model it is set to. `reindex_needed`: the index's model is gone from the instance, so
 * search answers by words and titles alone. `reindex_available`: it is set to another model
 * than its index uses. `reindexing`: a new index is being built beside the one search reads.
 * `none`: nothing is embedded yet.
 */
export const KNOWLEDGE_EMBEDDING_STATES = [
  "current",
  "reindex_needed",
  "reindex_available",
  "reindexing",
  "none"
] as const;

/**
 * What the page of a Knowledge Base shows of one document. `pending` is added and not yet
 * searchable: waiting for its index job, being indexed or waiting for extraction. `indexed` is
 * found by search. `failed` carries one of `KNOWLEDGE_DOCUMENT_FAILURE_CODES`; Retry puts it
 * back to `pending`.
 */
export const KNOWLEDGE_DOCUMENT_STATES = ["pending", "indexed", "failed"] as const;
export type KnowledgeDocumentState = (typeof KNOWLEDGE_DOCUMENT_STATES)[number];

/**
 * The largest file a Knowledge Base takes, as document processing takes it. A larger file is
 * refused when it is added, with this limit named.
 */
export const KNOWLEDGE_FILE_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Why a document was not indexed. The first five and `knowledge_file_too_many_pages` can also
 * come from the extraction of a PDF or DOCX (`KNOWLEDGE_EXTRACTION_FAILURE_CODES` in core); the
 * rest are the index job's own. The list only gains members.
 */
export const KNOWLEDGE_DOCUMENT_FAILURE_CODES = [
  // The extractor does not read the file's format.
  "knowledge_file_format_unsupported",
  // The file is over a limit of the extraction: its size or the size of its text.
  "knowledge_file_over_limit",
  // The file is corrupt, encrypted, or not the format it claims.
  "knowledge_file_unreadable",
  // The copy the Knowledge Base owns, or its bytes, are gone.
  "knowledge_file_missing",
  // Extraction failed on every attempt.
  "knowledge_extraction_failed",
  // A PDF or DOCX on an instance without document processing.
  "knowledge_file_format_unavailable",
  // A text file whose bytes are not text.
  "knowledge_text_unreadable",
  // No text to search, such as a scanned PDF without a text layer.
  "knowledge_text_empty",
  // Indexing failed on every attempt.
  "knowledge_index_failed",
  // A PDF or DOCX with more pages than `knowledge.maxPagesPerDocument`, counted before its text
  // is read.
  "knowledge_file_too_many_pages",
  // A built-in or Workflow processor returned output outside its contract.
  "knowledge_processor_output_invalid",
  // Conversion exceeded its page-aware deadline.
  "knowledge_conversion_timeout"
] as const;
export type KnowledgeDocumentFailureCode = (typeof KNOWLEDGE_DOCUMENT_FAILURE_CODES)[number];

/**
 * Why a `pending` document waits, where it waits for something other than its turn. It goes on
 * by itself once the cause is gone.
 */
export const KNOWLEDGE_DOCUMENT_WAIT_CODES = [
  // A usage limit of the instance or the workspace refuses the embedding calls. Indexing goes
  // on when the limit resets or is raised.
  "knowledge_usage_limit_reached"
] as const;
export type KnowledgeDocumentWaitCode = (typeof KNOWLEDGE_DOCUMENT_WAIT_CODES)[number];

/**
 * Why a synced source of a Knowledge Base, or one item of it, did not come in. Beside the
 * document codes: an item over the size limit or of a format the instance does not read is
 * recorded with `knowledge_file_over_limit` or `knowledge_file_format_unsupported` and never
 * fetched. Spec: Synced sources, Contract freezes (SRC-0).
 */
export const KNOWLEDGE_SOURCE_FAILURE_CODES = [
  // The source did not answer.
  "knowledge_source_unreachable",
  // The credential or the account's access was refused for the whole source.
  "knowledge_source_refused",
  // A fetch failed on every attempt.
  "knowledge_fetch_failed",
  // The Knowledge Base holds its document limit; the listing stopped discovering there.
  "knowledge_source_limit_reached",
  "knowledge_item_invalid",
  "knowledge_fetch_not_allowed",
  // The Workflow run that called `ingest` ended before the pass did; what it wrote stays.
  "knowledge_ingest_cancelled",
  // A person removed the item by hand: no pass puts it back until a publisher lifts the hold.
  "knowledge_item_removed"
] as const;
export type KnowledgeSourceFailureCode = (typeof KNOWLEDGE_SOURCE_FAILURE_CODES)[number];

/** The code a failed item of a synced source carries: a source code, or one it shares with a file added by hand. */
export const KNOWLEDGE_SOURCE_ITEM_FAILURE_CODES = [
  ...KNOWLEDGE_SOURCE_FAILURE_CODES,
  "knowledge_file_over_limit",
  "knowledge_file_format_unsupported"
] as const satisfies readonly (KnowledgeSourceFailureCode | KnowledgeDocumentFailureCode)[];
export type KnowledgeSourceItemFailureCode = (typeof KNOWLEDGE_SOURCE_ITEM_FAILURE_CODES)[number];

/**
 * The state of an item of a synced source as the sync keeps it. It ends at `fetched`: from
 * then on the item shows its document's state. `withdrawn` is out of search.
 */
export const KNOWLEDGE_SOURCE_ITEM_STATES = [
  "discovered",
  "fetched",
  "failed",
  "withdrawn"
] as const;
export type KnowledgeSourceItemState = (typeof KNOWLEDGE_SOURCE_ITEM_STATES)[number];

/**
 * How a sync of a source walks it: `initial` and `full` list every item below its folders,
 * `changes` reads the source's change feed from the stored cursor, and `ingest` is one call
 * of `knowledge.<id>.ingest` from a Workflow into its Workflow-fed source.
 */
export const KNOWLEDGE_SYNC_MODES = ["initial", "changes", "full", "ingest"] as const;
export type KnowledgeSyncMode = (typeof KNOWLEDGE_SYNC_MODES)[number];

export const KNOWLEDGE_SYNC_RUN_STATES = ["running", "done", "failed", "superseded"] as const;
export type KnowledgeSyncRunState = (typeof KNOWLEDGE_SYNC_RUN_STATES)[number];

/** What a sync run counts, in this order wherever it shows them. */
export const KNOWLEDGE_SYNC_COUNTS = [
  "discovered",
  "added",
  "changed",
  "moved",
  "withdrawn",
  "failed",
  "skipped"
] as const;
export type KnowledgeSyncCount = (typeof KNOWLEDGE_SYNC_COUNTS)[number];

/**
 * The ranked lists a search on the built-in backend fuses: cosine distance to the query's
 * embedding, German and English full text, and the words of a document's title and file name.
 */
export const KNOWLEDGE_SEARCH_SIGNALS = ["semantic", "keyword", "title"] as const;
export type KnowledgeSearchSignal = (typeof KNOWLEDGE_SEARCH_SIGNALS)[number];

export const DATABASE_RELATION_TYPES = [
  "table",
  "view",
  "materialized_view",
  "foreign_table"
] as const;
export type DatabaseRelationType = (typeof DATABASE_RELATION_TYPES)[number];

export const WORKFLOW_RUN_STATUSES = [
  "continued",
  "queued",
  "running",
  "waiting",
  "done",
  "failed",
  "cancelled",
  "limit_reached"
] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const WORKFLOW_STEP_TYPES = [
  "trigger",
  "operation",
  "loop",
  "code",
  "output",
  "agent",
  "notify",
  /** Starts another Workflow as a child run and waits for it. */
  "workflow"
] as const;
export type WorkflowStepType = (typeof WORKFLOW_STEP_TYPES)[number];

/**
 * The step types this release executes. The engine accepts no definition that names another,
 * and the interface offers no other in its palette (workflow-canvas 9.6). A list of its own, so
 * it can be narrower than `WORKFLOW_STEP_TYPES` while a known type is not run yet.
 */
export const WORKFLOW_EXECUTED_STEP_TYPES = [...WORKFLOW_STEP_TYPES] as const;

export const WORKFLOW_RESERVED_STEP_TYPES = [
  /** Reserved in the contract: drawn, and run by no engine yet. */
  "condition",
  "parallel"
] as const;
export type WorkflowReservedStepType = (typeof WORKFLOW_RESERVED_STEP_TYPES)[number];

export const WORKFLOW_TRIGGER_KINDS = ["manual", "schedule", "parent", "outside"] as const;
export type WorkflowTriggerKind = (typeof WORKFLOW_TRIGGER_KINDS)[number];

export const NOTIFY_CHANNELS = ["inbox", "mail"] as const;

/**
 * What an operation step's facts name as its source (`stepFacts`, workflow-canvas.md 9.8). A
 * step on `mail.send` names its sender as `mail_sender`, with the sender's icon key as
 * `service` (`MAIL_SENDER_SYSTEM_ICON`, or a Connection's service).
 */
export const WORKFLOW_STEP_SOURCE_KINDS = [
  "connection",
  "data_store",
  "knowledge_base",
  "workflow",
  "mail_sender",
  "other"
] as const;
export type WorkflowStepSourceKind = (typeof WORKFLOW_STEP_SOURCE_KINDS)[number];

/**
 * What an operation a step may call belongs to (`operations.list_callable`, WF-EDIT-3). `other`
 * is an operation of the release.
 */
export const OPERATION_SOURCE_KINDS = [
  "connection",
  "data_store",
  "knowledge_base",
  "workflow",
  "other"
] as const satisfies readonly WorkflowStepSourceKind[];
export type OperationSourceKind = (typeof OPERATION_SOURCE_KINDS)[number];
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

export const PRINCIPAL_HOLDER_KINDS = [
  "user",
  "service_principal"
] as const satisfies readonly GrantHolderKind[];
export type PrincipalHolderKind = (typeof PRINCIPAL_HOLDER_KINDS)[number];

export const ASSET_OWNER_KINDS = [
  "instance",
  "workspace"
] as const satisfies readonly GrantScopeKind[];
export type AssetOwnerKind = (typeof ASSET_OWNER_KINDS)[number];

export const READING_POLICY_VALUES = ["allow", "deny"] as const satisfies readonly PolicyValue[];
export type ReadingPolicyValue = (typeof READING_POLICY_VALUES)[number];

export const CONNECTION_OPERATION_POLICIES = [
  "deny",
  "approval"
] as const satisfies readonly PolicyValue[];
export type ConnectionOperationPolicy = (typeof CONNECTION_OPERATION_POLICIES)[number];

export const WORKFLOW_RUN_MODES = ["live", "test"] as const satisfies readonly OperationTarget[];
export type WorkflowRunMode = (typeof WORKFLOW_RUN_MODES)[number];

/**
 * Which revision of a Workflow a test run an App's draft started ran (DP-1): its draft, for a
 * tester who may write it, or its published revision.
 */
export const WORKFLOW_TEST_REVISIONS = ["draft", "published"] as const;
export type WorkflowTestRevision = (typeof WORKFLOW_TEST_REVISIONS)[number];

export const APP_ACTION_CALL_STATUSES = [
  "done",
  "pending_approval"
] as const satisfies readonly OperationRunStatus[];
export type AppActionCallStatus = (typeof APP_ACTION_CALL_STATUSES)[number];

export const OPERATIONS_AUDIENCES = [
  "workflow",
  "app"
] as const satisfies readonly OperationOriginKind[];
export type OperationsAudience = (typeof OPERATIONS_AUDIENCES)[number];

export const DECIDED_APPROVAL_REQUEST_STATUSES = [
  "approved",
  "rejected",
  "changes_requested",
  "superseded",
  "withdrawn",
  "reverted"
] as const satisfies readonly ApprovalRequestStatus[];
export type DecidedApprovalRequestStatus = (typeof DECIDED_APPROVAL_REQUEST_STATUSES)[number];

export const ENDED_APPROVAL_EXECUTIONS = [
  "done",
  "failed",
  "interrupted",
  "refused",
  "expired",
  "held"
] as const satisfies readonly ApprovalExecution[];
export type EndedApprovalExecution = (typeof ENDED_APPROVAL_EXECUTIONS)[number];

export const GUARDRAIL_HIT_OUTCOMES = [
  "warn",
  "require_approval",
  "block"
] as const satisfies readonly GuardrailOutcome[];
export type GuardrailHitOutcome = (typeof GUARDRAIL_HIT_OUTCOMES)[number];

export const APPROVAL_CHECK_FAILURE_OUTCOMES = [
  "warn",
  "block"
] as const satisfies readonly GuardrailOutcome[];
export type ApprovalCheckFailureOutcome = (typeof APPROVAL_CHECK_FAILURE_OUTCOMES)[number];

export const THEME_MODES = ["light", "dark"] as const satisfies readonly ThemeModePreference[];
export type ThemeMode = (typeof THEME_MODES)[number];

export const USER_STATUSES = [
  "active",
  "disabled"
] as const satisfies readonly AdministeredUserStatus[];
export type UserStatus = (typeof USER_STATUSES)[number];

export const MESSAGE_FINISH_STATUSES = [
  "completed",
  "cancelled"
] as const satisfies readonly AgentRunStatus[];
export type MessageFinishStatus = (typeof MESSAGE_FINISH_STATUSES)[number];

/**
 * Why a run went on with its binding's fallback, as the person reads it: the model was
 * overloaded (`rate_limit`) or could not be reached (`unavailable`: a server error, a timeout or
 * a lost connection).
 */
export const MODEL_FALLBACK_REASONS = ["rate_limit", "unavailable"] as const;
export type ModelFallbackReason = (typeof MODEL_FALLBACK_REASONS)[number];

export const ENDED_AGENT_RUN_STATUSES = [
  "completed",
  "cancelled",
  "failed"
] as const satisfies readonly AgentRunStatus[];
export type EndedAgentRunStatus = (typeof ENDED_AGENT_RUN_STATUSES)[number];

export const ACTIVE_AGENT_RUN_STATUSES = [
  "queued",
  "running",
  "waiting_for_decision",
  "waiting_for_subagents",
  "cancelling"
] as const satisfies readonly AgentRunStatus[];
export type ActiveAgentRunStatus = (typeof ACTIVE_AGENT_RUN_STATUSES)[number];

export const ARTIFACT_PREVIEW_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp"
] as const satisfies readonly SupportedImageMimeType[];
export type ArtifactPreviewImageMimeType = (typeof ARTIFACT_PREVIEW_IMAGE_MIME_TYPES)[number];

export const LIVE_JOB_STATUSES = ["queued", "running"] as const satisfies readonly JobStatus[];
export type LiveJobStatus = (typeof LIVE_JOB_STATUSES)[number];

export const FAILED_JOB_STATUSES = ["failed", "dead"] as const satisfies readonly JobStatus[];
export type FailedJobStatus = (typeof FAILED_JOB_STATUSES)[number];

export const AUDIT_EVENT_STATUSES = [
  "success",
  "failed",
  "denied"
] as const satisfies readonly AuditOutcome[];
export type AuditEventStatus = (typeof AUDIT_EVENT_STATUSES)[number];

export const LISTED_DATA_STORE_STATUSES = [
  "provisioning",
  "ready"
] as const satisfies readonly DataStoreStatus[];
export type ListedDataStoreStatus = (typeof LISTED_DATA_STORE_STATUSES)[number];

export const KNOWLEDGE_CHECK_STATUSES = [
  "preparing",
  "ok",
  "needs_attention"
] as const satisfies readonly KnowledgeBaseStatus[];
export type KnowledgeCheckStatus = (typeof KNOWLEDGE_CHECK_STATUSES)[number];

export const WORKFLOW_STEP_RUN_STATUSES = [
  "queued",
  "running",
  "waiting",
  "done",
  "failed",
  "cancelled"
] as const satisfies readonly WorkflowRunStatus[];
export type WorkflowStepRunStatus = (typeof WORKFLOW_STEP_RUN_STATUSES)[number];

export const WORKFLOW_ENDED_STATUSES = [
  "continued",
  "done",
  "failed",
  "cancelled",
  "limit_reached"
] as const satisfies readonly WorkflowRunStatus[];
export type WorkflowEndedStatus = (typeof WORKFLOW_ENDED_STATUSES)[number];

/** A released Managed File keeps its identity; original bytes live at the synced source. */
export const MANAGED_FILE_STATUSES = ["available", "released", "deleted"] as const;

/** A Workflow automates a process unless it fills or processes data. */
export const WORKFLOW_KINDS = ["process", "data"] as const;
export type WorkflowKind = (typeof WORKFLOW_KINDS)[number];

/** Wire formats for a streamed Workflow result dataset. */
export const WORKFLOW_DATASET_DOWNLOAD_FORMATS = ["jsonl", "csv"] as const;
export type WorkflowDatasetDownloadFormat = (typeof WORKFLOW_DATASET_DOWNLOAD_FORMATS)[number];

/** Instance resources whose use may be inherited through workspace availability. */
export const WORKSPACE_USE_ASSET_KINDS = ["knowledge_base", "connection"] as const;

/** Published assets that consume Connections or stored data. Agents hold tools separately. */
export const PUBLISHED_DATA_CONSUMER_KINDS = ["app", "workflow", "knowledge_base"] as const;
export type PublishedDataConsumerKind = (typeof PUBLISHED_DATA_CONSUMER_KINDS)[number];
/** State of a scheduled prompt. */
export const SCHEDULED_START_STATES = ["active", "paused"] as const;

/** Which revision answered an agent preview turn. */
export const AGENT_PREVIEW_SOURCES = ["draft", "live"] as const;
