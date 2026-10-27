import {
  AGENT_USE_SETTINGS,
  APP_AUDIENCES,
  OPERATION_EFFECTS,
  WORKSPACE_USE_ASSET_KINDS,
  ASSET_ACCESS_VERBS,
  ASSET_NAME_REFUSAL_REASONS,
  ASSET_SYNC_CHANGE_TYPES,
  WORKFLOW_STEP_SOURCE_KINDS,
  workflowMailSenderFactSchema,
  operationSourceSchema
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import {
  agentAvailabilitySchema,
  configAssetConfigSchema,
  unavailableModelSchema,
  unavailableSkillSchema,
  unavailableToolSchema
} from "./configuration";
import { timestampSchema } from "./shared";

/** How many puts and deletes one `assets.sync` call may carry. */
export const ASSET_SYNC_MAX_ITEMS = 200;

/** How many bytes the body of one `assets.sync` or `assets.sync_check` call may hold. */
export const ASSET_SYNC_BODY_MAX_BYTES = 20 * 1024 * 1024;

/**
 * How many bytes the definition of one item of a batch may hold, as JSON. Generous for a skill
 * with its resources, and small enough that one item cannot take the body of a whole batch.
 */
export const ASSET_SYNC_ITEM_MAX_BYTES = 2 * 1024 * 1024;

/**
 * How many items a release may hold: a batch of a holder of the release right, which is applied
 * in one transaction so that a release lands whole or not at all. The transaction reads and
 * writes its items in a fixed number of statements per `500` items, and the request body limit
 * of the server bounds the bytes.
 */
export const ASSET_RELEASE_SYNC_MAX_ITEMS = 2000;

// Mirror the constants of the same names in core.
/** How many files one file set holds, source and built files counted together. */
export const FILE_SET_MAX_FILES = 500;
const FILE_SET_MAX_PATH_CHARS = 512;
/** How many decoded bytes of files one `assets.put` carries. */
export const ASSET_PUT_FILES_MAX_BYTES = 8 * 1024 * 1024;
/** How many bytes of file contents one `assets.get` answers. Above it the index comes alone. */
export const ASSET_GET_FILES_MAX_BYTES = 8 * 1024 * 1024;

/** Who owns an asset: the instance, or one workspace. */
export const assetScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("instance") }),
  z.object({ kind: z.literal("workspace"), workspaceId: z.string() })
]);

const revisionNumberSchema = z.number().int().positive();

/** How many Workflow drafts one publish of an App makes live with it at most. */
export const APP_PUBLISH_WORKFLOWS_MAX = 20;

/**
 * How many Data Stores one publish of an App publishes with it at most: as many as a manifest
 * may bind (`dataStores`, 100 entries), since each named store must be one the App binds.
 */
export const APP_PUBLISH_DATA_STORES_MAX = 100;

/**
 * The revision a write was made against. Every write of an asset names one: the server
 * refuses a write without it with `PRECONDITION_REQUIRED` and never takes it as leave to
 * overwrite. The field is optional here only so that this refusal names the asset.
 */
const expectedRevisionSchema = revisionNumberSchema.optional();

/**
 * The revision a put was made against, or `null` for a name that was never stored. An asset
 * that was deleted keeps its last revision: creating it again names that revision, which a
 * `REVISION_CONFLICT` tells whoever may read the asset.
 */
const expectedRevisionOrNewSchema = revisionNumberSchema.nullable().optional();

const NUL = "\u0000";
const NUL_REFUSAL = "A name must not contain a NUL byte";

/** Text that names assets, whole or in part. No store holds a NUL byte, so none is accepted. */
function nameText<Schema extends z.ZodType<string>>(schema: Schema) {
  return schema.refine((value) => !value.includes(NUL), NUL_REFUSAL);
}

/** A definition as a call carries it. Its kind reads it; only the name is looked at here. */
const assetDefinitionSchema = configAssetConfigSchema.refine(
  (config) => typeof config.name !== "string" || !config.name.includes(NUL),
  { path: ["name"], message: NUL_REFUSAL }
);

/**
 * The scope a call addresses. Without it the call means the instance's own assets. An asset a
 * workspace owns is reached only by naming that workspace.
 */
const workspaceIdSchema = nameText(z.string().min(1)).optional();

/**
 * Set on the one asset that is the instance's default of its kind, and left out on every
 * other. Only a kind that holds an instance default, such as the agent, ever carries it.
 */
const isDefaultSchema = z.literal(true).optional();

/**
 * The two pointers of an asset whose kind has the lifecycle `draft_published`, as revision
 * numbers. Both are left out on every other kind. `revision` beside them equals
 * `draftRevision`. `publishedRevision` is left out before the first publish.
 *
 * Whoever may not read the draft is answered the published view: `revision` and
 * `publishedRevision` both name the published revision, and `draftRevision` is left out.
 */
/** Dependencies whose use is missing in one or more of the agent's workspaces. */
/**
 * Who uses an agent where it is available (AGENT-USE-1): `everyone` who may work there, or only
 * those `agent.use` allows on it (`granted`).
 */
export const agentUseSchema = z.enum(AGENT_USE_SETTINGS);
export type AgentUse = z.infer<typeof agentUseSchema>;

export const dependencyAvailabilitySchema = z.object({
  /** The workspaces reviewed by the publisher; a later change must be read again. */
  availability: agentAvailabilitySchema.nullable().optional(),
  /** Human names of the shared workspaces reviewed, including ones outside the editor's own list. */
  workspaces: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  missing: z.array(
    z.object({
      kind: z.enum(WORKSPACE_USE_ASSET_KINDS),
      name: z.string(),
      displayName: z.string(),
      canMakeAvailable: z.boolean()
    })
  ),
  administrators: z.array(z.string())
});

export const agentDraftSummarySchema = z.object({
  revision: revisionNumberSchema,
  baseRevision: revisionNumberSchema,
  author: z.object({
    userId: z.string().optional(),
    /** The name of the person who wrote the draft last, while their account exists. */
    displayLabel: z.string().optional(),
    conversationId: z.string().optional(),
    release: z.boolean()
  }),
  updatedAt: timestampSchema
});
const pointerShape = {
  agentDraft: agentDraftSummarySchema.optional(),
  draftRevision: revisionNumberSchema.optional(),
  publishedRevision: revisionNumberSchema.optional()
};

/** What the instance allows the caller to do to one asset. */
export const assetVerbSchema = z.enum(ASSET_ACCESS_VERBS);

/** The Apps whose `workflow` actions start a Workflow, as far as the reader may open them. */
const appCallersSchema = z.array(
  z.object({ name: z.string(), title: z.string(), scope: assetScopeSchema })
);

/** One asset as a list shows it: what every kind can say about itself, without its content. */
export const assetSummarySchema = z.object({
  /** What an asset-scoped grant names as its `scopeId`. */
  id: z.string(),
  kind: z.string(),
  name: z.string(),
  title: z.string(),
  description: z.string().optional(),
  scope: assetScopeSchema,
  revision: revisionNumberSchema,
  ...pointerShape,
  isDefault: isDefaultSchema,
  /**
   * What the kind says of the asset beside its name, by the kind's own keys: a Connection
   * names its `connectorType`, its `origin`, whether it is `enabled` and, where it has one, its
   * `service`, which picks its icon. Connection lists also carry runtime `health`. A skill names its
   * `origin`, who ships it: `instance` for a skill of the instance's own, `release` for one a
   * release ships. It names its `summary`, the sentence for people, where it has one. A skill
   * a release ships also names its `icon`, a key of the interface's icon registry; no other
   * skill names an icon.
   */
  attributes: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
  /** Per-asset rights from the same resolver as the asset read; absent on older instances. */
  allowed: z.array(assetVerbSchema).optional(),
  /**
   * Of a Workflow on a list: the Apps that start it, as its read names them. Absent where none
   * the reader may open does, and on other asset kinds.
   */
  appCallers: appCallersSchema.optional(),
  updatedAt: timestampSchema
});

/**
 * One source file of a revision as a read answers it: what the file set holds of it, and its
 * content as `text` for a text type and as `base64` otherwise. Neither is present in an index
 * without contents.
 */
export const assetFileSchema = z.object({
  path: z.string(),
  contentType: z.string(),
  /** Lower-case hex, of the bytes as they were written. */
  sha256: z.string(),
  bytes: z.number().int().nonnegative(),
  text: z.string().optional(),
  base64: z.string().optional()
});

/**
 * The plain sentence a publish question leads with (PUBQ-1), in the reader's language: what
 * runs, when, as which account, what it reads, writes and sends, and who sees it, then one
 * warning for each step a guardrail in force will or may stop when the revision runs live.
 * Names and counts only, never a row value. A held publish's review carries the same object.
 */
export const appAudienceSchema = z.enum(APP_AUDIENCES);

export const publishNarrativeSchema = z.object({
  summary: z.string(),
  /** Empty where no guardrail in force stops a step, and for an App. */
  warnings: z.array(z.string())
});

/** A save by the caller that waits for an approval, and up to three people who may decide it. */
export const saveApprovalSchema = z.object({ approverNames: z.array(z.string()) });

/** Facts resolved for the revision read, with unreadable sources reduced to their kind. */
const workflowFactSourceSchema = operationSourceSchema.extend({
  kind: z.enum(WORKFLOW_STEP_SOURCE_KINDS)
});
const workflowOperationFactSchema = z.object({
  source: workflowFactSourceSchema,
  /** The system sender and recipient policy of a mail.send step, while outbound mail is on. */
  mailSender: workflowMailSenderFactSchema.optional(),
  title: z.string().optional(),
  effect: z.enum(OPERATION_EFFECTS).optional(),
  description: z.string().optional(),
  inputSchema: configAssetConfigSchema.optional(),
  outputSchema: configAssetConfigSchema.optional(),
  available: z.boolean().optional()
});
export const workflowStepFactSchema = workflowOperationFactSchema.partial().extend({
  published: z.boolean().optional(),
  model: z.string().optional(),
  timeZone: z.string().optional(),
  nextDueAt: timestampSchema.optional(),
  /** Every AI step may use these Workflow tools. */
  tools: z.array(workflowOperationFactSchema.extend({ name: z.string() })).optional()
});

export const assetSchema = z.object({
  /**
   * Of a live App, for a reader of its draft: its version, the number of the publish that made
   * it live, when and by whom. Members read this number, never a revision's.
   */
  liveVersion: z
    .object({
      number: z.number().int().positive(),
      publishedAt: timestampSchema,
      /** The name of who published, as the account is now; empty for one that is gone. */
      by: z.string().optional()
    })
    .optional(),
  /** Of a live App, for a reader of its draft: whether the draft is another revision than the live one. */
  draftChangedSinceLive: z.boolean().optional(),
  id: z.string(),
  kind: z.string(),
  name: z.string(),
  scope: assetScopeSchema,
  revision: revisionNumberSchema,
  ...pointerShape,
  config: configAssetConfigSchema,
  /** The active account's display label for the Workflow revision returned by this read. */
  runsAs: z.string().optional(),
  stepFacts: z.record(z.string(), workflowStepFactSchema).optional(),
  /**
   * Workflows with a step that calls this Workflow, once each, from their published revision
   * or a draft the reader may see. Absent on other asset kinds. No unreadable caller is named.
   */
  workflowCallers: z
    .array(z.object({ name: z.string(), title: z.string(), scope: assetScopeSchema }))
    .optional(),
  /**
   * Of a Workflow: the Apps whose `workflow` actions start it, from their published revision or
   * a draft the reader may see, sorted by title. Absent on other asset kinds. An App the reader
   * may not open is left out.
   */
  appCallers: appCallersSchema.optional(),
  /** Unrecorded draft review lines naming its audience and shared source accounts. */
  publishQuestion: z.array(z.string()).optional(),
  /**
   * Of a Knowledge Base whose publish processes or embeds documents again: the confirmation of
   * the count and cost the publish question states, which the publish passes as
   * `confirmProcessing`. A stale one is refused with the new statement.
   */
  publishConfirmation: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  /**
   * Of a Knowledge Base whose publish processes contents again: the count and cost of the
   * sentence at index `line` of `publishQuestion` as fields, so that a client words them in the
   * reader's language in place of that sentence.
   */
  publishProcessing: z
    .strictObject({
      count: z.number().int().nonnegative(),
      line: z.number().int().nonnegative(),
      cost: z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("none") }),
        z.strictObject({
          kind: z.literal("estimate"),
          min: z.number().nonnegative(),
          max: z.number().nonnegative(),
          currency: z.string()
        }),
        z.strictObject({ kind: z.literal("unavailable") })
      ])
    })
    .optional(),
  /**
   * Of an App or a Workflow, for a reader of its draft: the publish question's sentence and
   * warnings for the revision this read returns.
   */
  publishNarrative: publishNarrativeSchema.optional(),
  appAudience: z
    .object({
      selected: appAudienceSchema,
      live: appAudienceSchema.optional(),
      liveLabel: z.string().optional(),
      people: z.number().int().nonnegative().optional(),
      choices: z.array(appAudienceSchema),
      label: z.string(),
      workspaceName: z.string().optional()
    })
    .optional(),
  /**
   * The revision `config` and `files` are of, for a kind with a draft and a published revision:
   * the draft where the call names none.
   */
  contentRevision: revisionNumberSchema.optional(),
  /**
   * The source files of that revision, in the order of their paths, where the call asked for
   * `files`. Each carries its content unless `filesOmitted` says the contents were left out.
   */
  files: z.array(assetFileSchema).optional(),
  /**
   * The source files together exceed `ASSET_GET_FILES_MAX_BYTES`: `files` is the index, and
   * no entry carries `text` or `base64`.
   */
  filesOmitted: z.literal(true).optional(),
  isDefault: isDefaultSchema,
  /**
   * The workspaces the asset is offered in, for a kind that is offered per workspace. Left
   * out where none is stored: such an asset is hidden in every workspace.
   */
  availability: agentAvailabilitySchema.optional(),
  dependencyAvailability: dependencyAvailabilitySchema.optional(),
  canSetAvailability: z.boolean().optional(),
  /** Only on agent reads: who uses the agent where it is available (AGENT-USE-1). */
  agentUse: agentUseSchema.optional(),
  /** Only on agent reads. The stored config stays intact; these references cannot run. */
  unavailableTools: z.array(unavailableToolSchema).optional(),
  unavailableSkills: z.array(unavailableSkillSchema).optional(),
  unavailableModels: z.array(unavailableModelSchema).optional(),
  /** False when the primary model is unavailable; no model is substituted. */
  chatAvailable: z.boolean().optional(),
  /**
   * What the caller may do to this asset, as the instance decides it on this asset: grants and
   * denies on the instance, a workspace and the asset itself. A kind without a
   * published revision names no `publish`. Left out by an instance from before AD-4.
   */
  allowed: z.array(assetVerbSchema).optional(),
  /**
   * A save of this asset by the caller files a request and takes effect once it is approved,
   * as the instance's policy asks. Names up to three people the caller shares a workspace with
   * who may decide it; none where none is known. Left out where a save takes effect at once.
   */
  saveApproval: saveApprovalSchema.optional(),
  updatedAt: timestampSchema
});

/** Something a write did that its caller should know and that did not refuse it. */
export const assetWarningSchema = z.object({ code: z.string(), message: z.string() });

export const listAssetsQuerySchema = z.object({
  /** Only names that start with this text. */
  prefix: nameText(z.string().min(1).max(200)).optional(),
  /** Only assets whose name or title contains this text, whatever the case. */
  text: nameText(z.string().min(1).max(200)).optional(),
  workspaceId: workspaceIdSchema,
  /**
   * The language of the titles and descriptions, where a kind holds them in several. A
   * language the instance does not offer, or none, answers its default.
   */
  locale: z.string().max(35).optional()
});

export const assetScopeQuerySchema = z.object({ workspaceId: workspaceIdSchema });

/**
 * Which revision a read answers, for a kind with a draft and a published revision: `draft`
 * (the default), `published`, or the number of one revision of the asset. Reading the draft
 * or a numbered revision needs the write or the publish right of the kind; `published` needs
 * the read right. A kind without a published revision takes `draft` alone.
 */
export const assetRevisionSelectorSchema = z
  .string()
  .regex(/^(?:draft|published|[1-9]\d{0,8})$/u, "draft, published, or a revision number");

const queryBooleanSchema = z.enum(["true", "false"]);

export const getAssetQuerySchema = assetScopeQuerySchema.extend({
  availabilityMode: agentAvailabilitySchema.shape.mode.optional(),
  availabilityPersonalWorkspaces: queryBooleanSchema.optional(),
  availabilityWorkspaceIds: z.string().optional(),
  audience: appAudienceSchema.optional(),
  revision: assetRevisionSelectorSchema.optional(),
  /** `true` adds the source files of the revision, for a kind whose revisions hold files. */
  files: queryBooleanSchema.optional()
});

const filePathSchema = nameText(z.string().min(1).max(FILE_SET_MAX_PATH_CHARS));

/**
 * One source file as a write carries it: its path inside the asset's folder and its content,
 * as `text` or, for a file that is not text, as `base64`.
 */
export const assetFileInputSchema = z.union([
  z.strictObject({ path: filePathSchema, text: z.string() }),
  z.strictObject({ path: filePathSchema, base64: z.base64() })
]);

/** One stored source file of a revision: where it is and what it holds, without the content. */
export const assetFileEntrySchema = z.object({
  path: z.string(),
  /** Lower-case hex. */
  sha256: z.string(),
  bytes: z.number().int().nonnegative()
});

export const putAssetRequestSchema = z
  .object({
    /** The definition, for a kind whose revision is its config. */
    config: assetDefinitionSchema.optional(),
    /**
     * The whole source set, for a kind whose revisions hold files: every file of the revision,
     * the manifest among them. At most `ASSET_PUT_FILES_MAX_BYTES` decoded bytes in one call.
     * The call builds the files and answers when the revision exists, or with what the build
     * refused.
     */
    files: z.array(assetFileInputSchema).min(1).max(FILE_SET_MAX_FILES).optional(),
    /** The revision the caller last read, or `null` to create the asset. Required. */
    expectedRevision: expectedRevisionOrNewSchema,
    expectedDraftRevision: expectedRevisionOrNewSchema.optional(),
    workspaceId: workspaceIdSchema,
    /** Include missing dependencies in a new agent's chosen workspaces, by explicit consent. */
    makeDependenciesAvailable: z.boolean().optional(),
    /** Availability shown with the dependency consent; a different audience is refused. */
    expectedAvailability: agentAvailabilitySchema.optional(),
    /**
     * Where a new agent starts available: the shared workspace it is made in, or `all`, which
     * needs the agent write right on the whole instance. An agent's call in a conversation is
     * made in the conversation's workspace without naming it. A new agent made in no shared
     * workspace is hidden until an instance admin makes it available, and the answer warns of
     * it. Only a write that creates an agent takes it.
     */
    availableIn: z
      .union([z.literal("all"), z.object({ workspaceId: z.string().min(1) })])
      .optional()
  })
  .refine((value) => (value.config === undefined) !== (value.files === undefined), {
    message: "A write carries the config of the asset or its files, one of the two"
  });

export const assetWriteResponseSchema = z.object({
  /**
   * The version of the instance's whole asset set after the write. A write of a kind with a
   * draft leaves it as it was: the set its users are served did not change.
   */
  version: z.number().int().nonnegative(),
  /** The revision the write left the asset at. A delete is a revision too. */
  revision: revisionNumberSchema,
  draftRevision: revisionNumberSchema.optional(),
  publishedRevision: revisionNumberSchema.optional(),
  /** The file set of the revision and its source files, after a write that carried files. */
  fileSetId: z.string().optional(),
  files: z.array(assetFileEntrySchema).optional(),
  warnings: z.array(assetWarningSchema)
});

export const publishAssetRequestSchema = z.object({
  makeDependenciesAvailable: z.boolean().optional(),
  expectedAvailability: agentAvailabilitySchema.nullable().optional(),
  audience: appAudienceSchema.optional(),
  /** Confirmation of the Knowledge Base processing count and cost; stale reviews are refused. */
  confirmProcessing: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  /**
   * The number of the revision that becomes the published one. It is required: a publish
   * never means "whatever the draft is now". Naming an earlier number is the way back.
   */
  revision: revisionNumberSchema,
  workspaceId: workspaceIdSchema,
  /**
   * Of an App only: the Workflow drafts this publish makes live with it (DP-3), each with the
   * revision the person reviewed, as `apps.publish_review` lists the pending ones. Each must be
   * a Workflow the App's revision reaches, directly or as a child. They are published children
   * first and then the App, in one transaction: a refusal of any publishes none of them.
   */
  workflows: z
    .array(z.object({ name: z.string().min(1), revision: revisionNumberSchema }).strict())
    .max(APP_PUBLISH_WORKFLOWS_MAX)
    .optional(),
  /**
   * Of an App only: the Data Store drafts this publish makes live with it (GOLIVE-1), each
   * with the revision the person reviewed, as `apps.publish_review` lists them. Each must be
   * a store the App's revision binds under `dataStores`. Each store is published first, in
   * its own transaction, and its migrations applied; the App and its Workflows go live only
   * once every store reached its level, and none of them where a migration fails.
   */
  dataStores: z
    .array(z.object({ name: z.string().min(1), revision: revisionNumberSchema }).strict())
    .max(APP_PUBLISH_DATA_STORES_MAX)
    .optional()
});

export const discardAssetDraftRequestSchema = z.object({
  /** The draft revision the caller last read. Required. */
  expectedRevision: expectedRevisionSchema,
  workspaceId: workspaceIdSchema
});

/** Where the two pointers of an asset are after a publish or a discard. */
export const assetPointersResponseSchema = z.object({
  draftRevision: revisionNumberSchema,
  publishedRevision: revisionNumberSchema,
  /** The revision that was published before a publish, left out on the first one. */
  replacedRevision: revisionNumberSchema.optional(),
  /**
   * The Data Stores and Workflows a publish of an App made live with it, in the order they
   * were published: the stores first.
   */
  publishedWith: z
    .array(
      z.object({
        kind: z.enum(["data_store", "workflow"]),
        name: z.string(),
        publishedRevision: revisionNumberSchema,
        replacedRevision: revisionNumberSchema.optional()
      })
    )
    .optional()
});

/** The bound of the name of an App action or a Workflow step that "Run live once" names. */
export const LIVE_ONCE_PART_MAX_LENGTH = 200;

export const runLiveOnceRequestSchema = z.object({
  /** The App action or the Workflow step whose next call is made live. */
  part: z.string().min(1).max(LIVE_ONCE_PART_MAX_LENGTH),
  /**
   * The draft revision the caller looks at. Required: the switch covers that revision only,
   * and a draft saved since is refused, so nobody switches live what they have not seen.
   */
  expectedRevision: expectedRevisionSchema,
  workspaceId: workspaceIdSchema
});

/** "Run live once", as it is set: for one action or step of one draft revision. */
export const runLiveOnceResponseSchema = z.object({
  draftRevision: revisionNumberSchema,
  part: z.string()
});

export const listLiveOnceQuerySchema = z.object({ workspaceId: workspaceIdSchema });

/**
 * The caller's own "Run live once" switches on the asset's current draft. A switch a Workflow
 * test run used names that run and when; it covers no later run until it is set again.
 */
export const liveOnceListSchema = z.object({
  items: z.array(
    z.object({
      part: z.string(),
      switchedAt: timestampSchema,
      usedByRunId: z.string().optional(),
      usedAt: timestampSchema.optional()
    })
  )
});

export const deleteAssetRequestSchema = z.object({
  /** The revision the caller last read. A delete is never made blind. Required. */
  expectedRevision: expectedRevisionSchema,
  workspaceId: workspaceIdSchema
});

export const revertAssetRequestSchema = z.object({
  /** The revision whose content becomes the asset's content again. */
  revision: revisionNumberSchema,
  /** The revision the asset is at now, a deleted asset's last one included. Required. */
  expectedRevision: expectedRevisionSchema,
  expectedDraftRevision: expectedRevisionOrNewSchema.optional(),
  workspaceId: workspaceIdSchema
});

export const setAssetDefaultRequestSchema = z.object({
  /** The asset that becomes the instance's default of its kind, or `null` for none. */
  name: nameText(z.string().min(1)).nullable(),
  /**
   * The id of the named asset as the caller read it. Given, the call is refused with a
   * conflict where the name is held by another asset by now. Left out, nothing is compared.
   */
  expectedAssetId: z.string().min(1).optional()
});

export const setAssetDefaultResponseSchema = z.object({
  /** The version of the instance's whole asset set after the change. */
  version: z.number().int().positive()
});

export const adoptAssetRepositoryRequestSchema = z.object({
  /** Only the asset of this name. Left out, every asset of the kind. */
  name: nameText(z.string().min(1)).optional(),
  /** The `after` of the answer before, to go on where it stopped. */
  after: z.string().min(1).optional()
});

/**
 * What one call of the adoption did. It walks every workspace, Personal Workspaces among them
 * (ADR-0015), so it answers counts and asset ids, never a name or content. A call stops after
 * a while: until `done`, call again with its `after`.
 */
export const adoptAssetRepositoryResponseSchema = z.object({
  /** Assets whose every revision names a commit now. */
  adopted: z.number().int().nonnegative(),
  /** Revisions this call gave a commit, a deletion's included. */
  revisions: z.number().int().nonnegative(),
  /** Commits this call made. */
  commits: z.number().int().nonnegative(),
  /** Assets left as they were, or part of the way, because a revision cannot be committed. */
  refused: z.number().int().nonnegative(),
  adoptedAssetIds: z.array(z.string()),
  refusedAssetIds: z.array(z.string()),
  done: z.boolean(),
  /** Where the next call goes on. Absent while it starts at the beginning again. */
  after: z.string().optional()
});

export const setAssetAvailabilityRequestSchema = z.object({
  /** Required with dependency consent: refuse a definition changed since it was reviewed. */
  expectedRevision: revisionNumberSchema.optional(),
  makeDependenciesAvailable: z.boolean().optional(),
  mode: agentAvailabilitySchema.shape.mode,
  // Both apply to `selected` only and are ignored for `all`.
  personalWorkspaces: z.boolean().optional(),
  collaborationWorkspaceIds: z.array(z.string().min(1)).optional(),
  /** The id of the asset as the caller read it. Another asset of the name is a conflict. */
  expectedAssetId: z.string().min(1).optional(),
  /**
   * The availability the caller read, or `null` where it read none. Given, the call is
   * refused with a conflict where the stored one differs by now, and nothing is written.
   * Left out, the call replaces whatever is stored.
   */
  expectedAvailability: agentAvailabilitySchema.nullable().optional()
});

export const validateAssetRequestSchema = z.object({
  /** With files, config supplies the name; the whole folder supplies the definition. */
  files: z.array(assetFileInputSchema).min(1).max(FILE_SET_MAX_FILES).optional(),
  /** Preview dependency use in these workspaces without creating the agent. */
  availability: agentAvailabilitySchema.optional(),
  config: assetDefinitionSchema,
  workspaceId: workspaceIdSchema
});

/** A name a create would take, asked before the create. */
export const checkAssetNameRequestSchema = z.object({
  // The kind decides empty and long names; NUL uses the definition transport rule.
  name: nameText(z.string()),
  workspaceId: workspaceIdSchema
});

/**
 * Whether a create would take the name. `name_invalid` breaks the kind's rule for names,
 * `name_taken` is the id of another asset; `message` says which rule or which id, in English.
 */
export const checkAssetNameResponseSchema = z.discriminatedUnion("available", [
  z.object({
    available: z.literal(true),
    /**
     * A create of the name by the caller files a request and takes effect once it is approved,
     * as `saveApproval` of a read of the asset says. Left out where a create takes effect at once.
     */
    saveApproval: saveApprovalSchema.optional()
  }),
  z.object({
    available: z.literal(false),
    reason: z.enum(ASSET_NAME_REFUSAL_REASONS),
    message: z.string()
  })
]);

export const assetValidationIssueSchema = z.object({
  message: z.string(),
  path: z.array(z.string()).optional(),
  /** The fixed code of the check that found the issue, such as `not_supported_yet`. */
  code: z.string().optional()
});

export const validateAssetResponseSchema = z.object({
  dependencyAvailability: dependencyAvailabilitySchema.optional(),
  valid: z.boolean(),
  issues: z.array(assetValidationIssueSchema),
  warnings: z.array(assetWarningSchema).optional()
});

/**
 * The id of the asset the expected revision was read of. A revision number alone does not say
 * which asset it counts: after a database was restored or replaced, another asset of the same
 * name can be at the same number. A caller that kept the id sends it, and an item whose asset
 * has another id is refused with `CONFLICT` and the reason `asset_replaced`.
 */
const expectedAssetIdSchema = z.string().min(1).optional();

export const assetSyncItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("put"),
    kind: z.string().min(1),
    config: assetDefinitionSchema,
    /** The revision the caller last read, or `null` to create the asset. Required. */
    expectedRevision: expectedRevisionOrNewSchema,
    expectedDraftRevision: expectedRevisionOrNewSchema.optional(),
    expectedAssetId: expectedAssetIdSchema
  }),
  z.object({
    type: z.literal("delete"),
    kind: z.string().min(1),
    name: nameText(z.string().min(1)),
    /** The revision the caller last read. Required. */
    expectedRevision: expectedRevisionSchema,
    expectedAssetId: expectedAssetIdSchema
  })
]);

export const syncAssetsRequestSchema = z.object({
  /**
   * The workspace that owns every asset the batch names, as a CLI root bound with
   * `--workspace` sends it. Left out, the batch names the instance's own assets. A batch
   * that names a workspace is no release: its agents start hidden and its writer holds the rights on what the workspace
   * owns.
   */
  workspaceId: workspaceIdSchema,
  /**
   * At most `ASSET_SYNC_MAX_ITEMS` items, or `ASSET_RELEASE_SYNC_MAX_ITEMS` for a holder of
   * the release right. A batch without items names the default agent.
   */
  items: z.array(assetSyncItemSchema).max(ASSET_RELEASE_SYNC_MAX_ITEMS),
  /**
   * The agent that becomes the instance default with this batch, or `null` for none. Only a
   * holder of the release right may name it. Left out, a release keeps the stored default.
   */
  defaultAgentName: nameText(z.string().min(1)).nullable().optional(),
  /**
   * The default agent the caller last read. Given, a batch made against another is refused,
   * whether or not it changes the default. Only a holder of the release right may send it.
   */
  expectedDefaultAgentName: nameText(z.string().min(1)).nullable().optional()
});

export const assetSyncAppliedItemSchema = z.discriminatedUnion("status", [
  z.object({
    type: z.enum(ASSET_SYNC_CHANGE_TYPES),
    kind: z.string(),
    name: z.string(),
    status: z.literal("applied"),
    /** The id of the asset that was written. */
    id: z.string(),
    /** The revision this batch gave the asset. */
    revision: revisionNumberSchema,
    draftRevision: revisionNumberSchema.optional(),
    publishedRevision: revisionNumberSchema.optional()
  }),
  // A delete in a release of an asset that is not there: nothing was written for it.
  z.object({
    type: z.literal("delete"),
    kind: z.string(),
    name: z.string(),
    status: z.literal("absent")
  })
]);

export const syncAssetsResponseSchema = z.object({
  version: z.number().int().positive(),
  items: z.array(assetSyncAppliedItemSchema),
  /** Agents the batch wrote that are available in no workspace afterwards. */
  hiddenAgentNames: z.array(z.string()).optional(),
  warnings: z.array(assetWarningSchema)
});

/** The answer for a batch a sync would apply. One it would refuse answers the sync's error. */
export const checkAssetSyncResponseSchema = z.object({
  valid: z.literal(true),
  warnings: z.array(assetWarningSchema).optional()
});

/**
 * One item of a refused `assets.sync`, in `details.items` of the error. Nothing of the batch
 * was applied: `refused` names an item that stopped it and says why, `not_applied` an item
 * that would have been written.
 */
export const assetSyncRefusedItemSchema = z.object({
  index: z.number().int().nonnegative(),
  type: z.enum(ASSET_SYNC_CHANGE_TYPES),
  kind: z.string(),
  name: z.string().optional(),
  status: z.enum(["refused", "not_applied"]),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      action: z.string().optional(),
      /** Told to a caller who may read the asset, as in `details.conflicts`. */
      currentRevision: revisionNumberSchema.nullable().optional()
    })
    .optional()
});

/**
 * One asset in `details.conflicts` of a `REVISION_CONFLICT`: a write named another revision
 * than the asset is at. The kind and the name are the ones the caller sent. The rest is told
 * only to a caller who may read the asset's history.
 */
export const assetRevisionConflictSchema = z.object({
  kind: z.string(),
  name: z.string(),
  /** The revision the name is at, or `null` where it was never stored. */
  currentRevision: revisionNumberSchema.nullable().optional(),
  /** The current revision is the delete of the asset. Creating it again names that revision. */
  deleted: z.literal(true).optional(),
  /** The display label of whoever wrote the current revision. */
  changedBy: z.string().optional(),
  changedAt: timestampSchema.optional()
});

/** `details` of a `REVISION_CONFLICT`. A refused batch carries `items` beside it. */
export const assetRevisionConflictDetailsSchema = z.object({
  reason: z.literal("revision_conflict"),
  conflicts: z.array(assetRevisionConflictSchema).min(1)
});

/** `details` of a `PRECONDITION_REQUIRED`: the assets the call names no revision for. */
export const assetPreconditionRequiredDetailsSchema = z.object({
  reason: z.literal("precondition_required"),
  assets: z.array(z.object({ kind: z.string(), name: z.string() })).min(1)
});

export type AssetScope = z.infer<typeof assetScopeSchema>;
export type AssetSummary = z.infer<typeof assetSummarySchema>;
export type Asset = z.infer<typeof assetSchema>;
export type AdoptAssetRepositoryResponse = z.infer<typeof adoptAssetRepositoryResponseSchema>;
export type PublishNarrative = z.infer<typeof publishNarrativeSchema>;
export type AssetSyncItem = z.infer<typeof assetSyncItemSchema>;
export type AssetSyncRefusedItem = z.infer<typeof assetSyncRefusedItemSchema>;
export type AssetRevisionConflict = z.infer<typeof assetRevisionConflictSchema>;
