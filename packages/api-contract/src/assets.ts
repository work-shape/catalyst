import {
  ASSET_NAME_REFUSAL_REASONS,
  ASSET_SYNC_CHANGE_TYPES
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
const workspaceIdSchema = z.string().min(1).optional();

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
export const agentDraftSummarySchema = z.object({
  revision: revisionNumberSchema,
  baseRevision: revisionNumberSchema,
  author: z.object({
    userId: z.string().optional(),
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

/** One asset as a list shows it: what every kind can say about itself, without its content. */
export const assetSummarySchema = z.object({
  /** What an asset-scoped grant names as its `scopeId`. */
  id: z.string(),
  kind: z.string(),
  name: z.string(),
  title: z.string(),
  description: z.string().optional(),
  scope: assetScopeSchema,
  /** The prefix of the Namespace the name belongs to, where it belongs to one. */
  namespace: z.string().optional(),
  revision: revisionNumberSchema,
  ...pointerShape,
  isDefault: isDefaultSchema,
  /**
   * What the kind says of the asset beside its name, by the kind's own keys: a Connection
   * names its `connectorType`, its `origin`, whether it is `enabled` and, where it has one, its
   * `service`, which picks its icon. A skill names its
   * `origin`, who ships it: `instance` for a skill of the instance's own, `release` for one a
   * release ships. It names its `summary`, the sentence for people, where it has one. A skill
   * a release ships also names its `icon`, a key of the interface's icon registry; no other
   * skill names an icon.
   */
  attributes: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
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

export const assetSchema = z.object({
  id: z.string(),
  kind: z.string(),
  name: z.string(),
  scope: assetScopeSchema,
  namespace: z.string().optional(),
  revision: revisionNumberSchema,
  ...pointerShape,
  config: configAssetConfigSchema,
  /** The active account's display label for the Workflow revision returned by this read. */
  runsAs: z.string().optional(),
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
  /** Only on agent reads. The stored config stays intact; these references cannot run. */
  unavailableTools: z.array(unavailableToolSchema).optional(),
  unavailableSkills: z.array(unavailableSkillSchema).optional(),
  unavailableModels: z.array(unavailableModelSchema).optional(),
  /** False when the primary model is unavailable; no model is substituted. */
  chatAvailable: z.boolean().optional(),
  updatedAt: timestampSchema
});

/** Something a write did that its caller should know and that did not refuse it. */
export const assetWarningSchema = z.object({ code: z.string(), message: z.string() });

export const listAssetsQuerySchema = z.object({
  /** Only names that start with this text, such as a Namespace prefix. */
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

export const getAssetQuerySchema = assetScopeQuerySchema.extend({
  revision: assetRevisionSelectorSchema.optional(),
  /** `true` adds the source files of the revision, for a kind whose revisions hold files. */
  files: z.enum(["true", "false"]).optional()
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
  /**
   * The number of the revision that becomes the published one. It is required: a publish
   * never means "whatever the draft is now". Naming an earlier number is the way back.
   */
  revision: revisionNumberSchema,
  workspaceId: workspaceIdSchema
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
  replacedRevision: revisionNumberSchema.optional()
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

export const setAssetAvailabilityRequestSchema = z.object({
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
  z.object({ available: z.literal(true) }),
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
   * The prefix of the one Namespace the batch belongs to. No item may name an asset outside it.
   * Only a holder of the release right may leave it out: a release names any asset of the
   * instance.
   */
  namespace: nameText(z.string().min(1)).optional(),
  /**
   * The workspace that owns every asset the batch names, as a CLI root bound with
   * `--workspace` sends it. Left out, the batch names the instance's own assets. A batch
   * names a Namespace or a workspace, never both, and one that names a workspace is no
   * release: its agents start hidden and its writer holds the rights on what the workspace
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
export type AssetSyncItem = z.infer<typeof assetSyncItemSchema>;
export type AssetSyncRefusedItem = z.infer<typeof assetSyncRefusedItemSchema>;
export type AssetRevisionConflict = z.infer<typeof assetRevisionConflictSchema>;
