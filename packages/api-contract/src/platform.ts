import {
  ASSET_LIFECYCLES,
  ASSET_OWNER_KINDS,
  ASSET_REPRESENTATIONS,
  COLLABORATION_WORKSPACE_KINDS
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";

/** One registered asset kind with the action names its rights are checked as. */
export const platformAssetKindSchema = z.object({
  kind: z.string(),
  plural: z.string(),
  /**
   * `active`: the newest write is what the kind's users are served. `draft_published`: a write
   * moves a draft, and `assets.publish` moves what its users are served.
   */
  lifecycle: z.enum(ASSET_LIFECYCLES),
  /** `config`: a revision is its config. `files`: a revision holds a set of files beside it. */
  representation: z.enum(ASSET_REPRESENTATIONS),
  /**
   * Who may own an asset of the kind: the instance, a workspace, or either. An asset a
   * workspace owns is read and written by naming that workspace.
   */
  owners: z.array(z.enum(ASSET_OWNER_KINDS)),
  actions: z.object({
    read: z.string(),
    write: z.string(),
    delete: z.string(),
    /** Named by a kind with the lifecycle `draft_published`. */
    publish: z.string().optional(),
    /**
     * Named by a kind whose publish a guardrail can hold for an approval: its holders decide
     * the request, and their own publish is the approval. A publish of such a kind goes live
     * only on a person's click. A CLI submission waits when approval is required.
     */
    approve: z.string().optional(),
    /**
     * Only for a kind whose assets are used through a right of their own: a Connection, or a
     * kind whose published revision has users of its own.
     */
    use: z.string().optional()
  }),
  /**
   * The rights of the kind a service principal can be granted, each on one named asset. Left
   * out for a kind that has none. `permissions.grant` hands out these and no other.
   */
  principalActions: z.array(z.string()).optional(),
  /** The file of a `files` kind that holds its manifest. */
  manifestFile: z.string().optional(),
  /** What a write of a `files` kind is held to, by the names of the limits. */
  limits: z
    .object({
      FILE_SET_MAX_FILES: z.number().int().positive(),
      FILE_SET_MAX_FILE_BYTES: z.number().int().positive(),
      FILE_SET_MAX_TOTAL_BYTES: z.number().int().positive(),
      ASSET_PUT_FILES_MAX_BYTES: z.number().int().positive(),
      ASSET_GET_FILES_MAX_BYTES: z.number().int().positive()
    })
    .optional()
});

/** A Namespace the caller holds a right in, with the actions that right covers there. */
export const platformContextNamespaceSchema = z.object({
  prefix: z.string(),
  displayName: z.string(),
  actions: z.array(z.string())
});

/** A workspace and the actions the caller can use on what it owns. */
export const platformContextWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(COLLABORATION_WORKSPACE_KINDS),
  /** The caller is a member: a new agent it makes there starts offered there. */
  member: z.boolean(),
  actions: z.array(z.string())
});

/** Where a caller is and what it can do there: the first read of an outside editor. */
export const platformContextSchema = z.object({
  instance: z.object({ id: z.string(), name: z.string() }),
  release: z.object({
    version: z.string(),
    /**
     * The version of `@work-shape/catalyst-cli` on npm that connects a local agent to this
     * instance. Absent while none is published for it.
     */
    cliVersion: z.string().optional()
  }),
  kinds: z.array(platformAssetKindSchema),
  /**
   * The actions of the listed kinds the caller can use on the instance's own assets as a
   * whole, whatever their names. A right in one Namespace or on one asset is not among them.
   */
  actions: z.array(z.string()),
  /**
   * The read actions of the listed kinds a grant allows the caller on one asset or on what one
   * workspace owns. Which assets those are, the kind's list says: a deny or a deleted asset can
   * leave it empty.
   */
  assetActions: z.array(z.string()),
  /**
   * The rights over the instance itself the caller holds that no asset kind carries and no
   * legacy key names, such as `service_principals.manage`.
   */
  instanceActions: z.array(z.string()),
  namespaces: z.array(platformContextNamespaceSchema),
  /**
   * The workspaces whose own assets the caller can use an action of a listed kind on, each
   * with those actions: through a membership, a grant on the workspace or a right on the
   * whole instance. A workspace where the caller can use none is left out.
   */
  workspaces: z.array(platformContextWorkspaceSchema),
  /**
   * The section rows of the interface's sidebar that are there for the caller, of those that
   * belong to no workspace. `workflows`: the module is on, and the caller is listed at least
   * one Workflow by `workflows.list` or holds `workflow.write` on the instance, in a Namespace
   * or on one Workflow. A member is never shown an empty row; whoever may build one is.
   */
  visibleSections: z.array(z.enum(["workflows"]))
});

export type PlatformContext = z.infer<typeof platformContextSchema>;
