import {
  APP_ACTION_CALL_STATUSES,
  APP_MODES,
  OPERATION_EFFECTS,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_TEST_REVISIONS
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { appActionPermissionSchema, appStorageMutationSchema } from "./app-bridge";
import { operationTargetSchema } from "./operation-runs";
import { assetScopeSchema, publishNarrativeSchema } from "./assets";
import { listQuerySchema } from "./shared";
import { pagePreviewSchema } from "./pages";

/** The kind id of an App in the asset registry. */
export const APP_ASSET_KIND = "app";

/** Which revision of an App is shown: the one its users are served, or the one being edited. */
export const appModeSchema = z.enum(APP_MODES);

export type AppMode = z.infer<typeof appModeSchema>;

/**
 * The path of the interface route that shows one App to a signed-in person: the published
 * revision under `/apps/`, or the draft under `/app-drafts/`. Every path below the published
 * one is the App's own, so the draft stands outside it: an App may have any route, `/edit`
 * among them. The server answers it from `apps.preview` and the interface builds its routes
 * from it, so the two never disagree.
 */
export function appInterfacePath(input: {
  workspaceId: string;
  app: string;
  mode: AppMode;
}): string {
  const area = input.mode === "draft" ? "app-drafts" : "apps";
  return `/w/${encodeURIComponent(input.workspaceId)}/${area}/${encodeURIComponent(input.app)}`;
}

export const createAppFromPageRequestSchema = z
  .object({
    conversationId: z.string().min(1),
    pageId: z.string().min(1),
    /** The id of the App: lowercase letters, digits and '-'. It is unique on the instance. */
    name: z.string().min(1).max(63),
    /** What people read as the App's name. */
    title: z.string().min(1).max(120),
    /** The workspace the App belongs to. */
    workspaceId: z.string().min(1),
    /**
     * The revision of the Page to copy, by its file set's id. Without it the newest is copied.
     * A call held for an approval keeps the one its guardrails read, so the approval answers
     * what is written. A revision that is gone is refused with `CONFLICT`.
     */
    fileSetId: z.string().min(1).optional()
  })
  .strict();

export const createAppFromPageResponseSchema = z.object({
  /** The id of the asset. */
  id: z.string(),
  name: z.string(),
  workspaceId: z.string(),
  /** The draft revision the call made. Nothing is published. */
  revision: z.number().int().positive(),
  fileSetId: z.string()
});

export const updateAppFromPageRequestSchema = z
  .object({
    conversationId: z.string().min(1),
    /** The Page the App is updated from. An App of another Page is written only with `link`. */
    pageId: z.string().min(1),
    /**
     * The revision of the Page to copy, by its file set's id. Without it the newest is copied.
     * A call held for an approval keeps the one its guardrails read, so the approval answers
     * what is written. A revision that is gone is refused with `CONFLICT`.
     */
    fileSetId: z.string().min(1).optional(),
    /** The workspace the App belongs to. */
    workspaceId: z.string().min(1),
    /**
     * The draft revision the caller read, as `apps.get_from_page` answers it. A draft at
     * another revision is not overwritten: the call is refused with the revision it is at.
     */
    expectedRevision: z.number().int().positive(),
    /**
     * `true` writes an App that is not this Page's as well: one saved before Apps remembered
     * their Page, written another way, or updated from another Page. The App is this Page's
     * from then on.
     */
    link: z.boolean().optional()
  })
  .strict();

/** What `apps.get_from_page` is asked beside the Page. */
export const appFromPageQuerySchema = z.object({
  /** The id of an App the caller thinks of putting the Page into. Answered as `candidate`. */
  app: z.string().min(1).optional()
});

/**
 * The App of a Page, for the caller: among the Apps whose newest revision with a Page names
 * this one, the earliest the caller may write, and before it one the caller wrote from the
 * Page last. `app` is `null` where there is none, which is also what a caller is answered who
 * may write none of them.
 */
export const appFromPageSchema = z.object({
  app: z
    .object({
      /** The id of the App. */
      name: z.string(),
      /** What people read as the App's name. */
      title: z.string(),
      workspaceId: z.string(),
      /** The revision `apps.update_from_page` names as `expectedRevision`. */
      draftRevision: z.number().int().positive(),
      /**
       * Whether the draft is a copy of this Page. `false` once the draft was written another
       * way, such as with `assets.put`: an update then replaces what that write made.
       */
      draftFromPage: z.boolean()
    })
    .nullable(),
  /**
   * The App the question named, where the caller may write it: what `apps.update_from_page`
   * with `link` would write. `null` for an App that does not exist or that the caller may not
   * write. Absent where the question named none.
   */
  candidate: z
    .object({
      name: z.string(),
      title: z.string(),
      workspaceId: z.string(),
      draftRevision: z.number().int().positive(),
      /**
       * Which Page the App is updated from now: `none`, `this` one, `other_page` of the same
       * conversation, or a Page of an `other_conversation`.
       */
      page: z.enum(["none", "this", "other_page", "other_conversation"])
    })
    .nullable()
    .optional()
});

export type AppFromPageResponse = z.infer<typeof appFromPageSchema>;

export const appPreviewRequestSchema = z.object({ mode: appModeSchema }).strict();

/**
 * Where a frame loads one revision of an App, in the shape of `pages.preview`, and where a
 * signed-in person opens the same revision in the interface. `url` is a credential of its
 * caller: put it in the frame and nowhere else. `interfacePath` holds none and can be shared.
 */
export const appPreviewSchema = pagePreviewSchema.extend({
  /** Data scope labels the viewer has no assignment for; never sent into the App bridge. */
  unassignedScopes: z.array(z.string()).optional(),
  /** The number of the asset revision shown. */
  revision: z.number().int().positive(),
  interfacePath: z.string(),
  /**
   * The outside hosts the shown revision's manifest lists that its frame may not connect to:
   * those a draft adds to what is published, until it is published or the caller allowed one
   * for their own view (DRAFT-HOSTS-1). Always empty for the published view.
   */
  heldBackHosts: z.array(z.string())
});

export type AppPreviewResponse = z.infer<typeof appPreviewSchema>;

/**
 * A person allows an outside host for their own view of a draft (DRAFT-HOSTS-1): the draft of
 * an App, or a Page of a conversation that is no App yet. `fileSetId` is the revision their
 * preview shows; the host must be one its manifest lists and the frame holds back.
 */
export const allowDraftHostRequestSchema = z
  .object({
    fileSetId: z.string().min(1).max(200),
    host: z.string().min(1).max(253)
  })
  .strict();

export const allowDraftHostResponseSchema = z.object({
  host: z.string(),
  allowed: z.literal(true)
});

/**
 * What names the frame a call comes from: the file set it shows and the token of its address,
 * as `pages.preview` or `apps.preview` answered them to this caller. The server checks that
 * the token was minted for this caller, this file set and the page session of the path.
 */
const pageSessionProof = {
  fileSetId: z.string().min(1).max(200),
  token: z.string().min(1).max(512)
};

export const appStorageWriteResponseSchema = z.object({ saved: z.literal(true) }).strict();

export const appStorageWriteRequestSchema = z
  .object({ ...pageSessionProof, mutation: appStorageMutationSchema })
  .strict();

export const appSessionContextRequestSchema = z.object(pageSessionProof).strict();

/** What each action of the shown manifest would come to for the caller now. */
export const appSessionContextSchema = z.object({
  can: z.record(z.string(), appActionPermissionSchema)
});

export const appActionCallRequestSchema = z
  .object({
    ...pageSessionProof,
    /** The parameters of the action, by name. */
    input: z.record(z.string(), z.unknown()).default({})
  })
  .strict();

/**
 * How a call of a frame went. `done` carries what the operation answered. `pending_approval`
 * carries nothing: the call waits for another person and its run says how it ends. `dry_run`
 * is the answer of a draft, which carries out nothing that changes unless "Run live once"
 * covers the call: it says in `message` what the call would have done and holds in `result`
 * the input it would have done it with. A draft of an App leaves a run with the target
 * `dry_run`, named in the header `operation-run-id`; a Page of a conversation leaves none.
 */
export const appActionCallResultSchema = z.union([
  z.object({
    runId: z.string(),
    status: z.enum(APP_ACTION_CALL_STATUSES),
    result: z.unknown().optional()
  }),
  z.object({
    status: z.literal("dry_run"),
    message: z.string(),
    result: z.unknown()
  })
]);

export type AppSessionContextResponse = z.infer<typeof appSessionContextSchema>;

/** What an agent tries one action of an App's draft with: the action's parameters, by name. */
export const appTryActionRequestSchema = z
  .object({ input: z.record(z.string(), z.unknown()).default({}) })
  .strict();

/**
 * How a try of one action of an App's draft went (DP-2): the answer the button of the draft
 * gets, with the run it left and where the call went. A `workflow` action names the test run
 * it started and which revision of the Workflow runs in it; the run goes on after the answer
 * and is followed with `workflows.get_run` and `workflows.list_step_runs`.
 */
export const appTryActionResultSchema = z.object({
  operationRunId: z.string().optional(),
  status: z.enum([...APP_ACTION_CALL_STATUSES, "dry_run"]),
  target: operationTargetSchema.optional(),
  result: z.unknown().optional(),
  /** What a simulated call would have done. */
  message: z.string().optional(),
  workflowRun: z
    .object({
      runId: z.string(),
      workflow: z.string(),
      status: z.enum(WORKFLOW_RUN_STATUSES),
      revision: z.object({
        kind: z.enum(WORKFLOW_TEST_REVISIONS),
        number: z.number().int().positive().optional()
      })
    })
    .optional()
});

export type AppTryActionResult = z.infer<typeof appTryActionResultSchema>;

/** Why one asset of a publish would be refused now: a missing right or a check of the publish. */
export const appPublishRefusalSchema = z.object({
  /** `no_grant`, `workflow_not_published`, `workflow_unavailable` and the like. */
  reason: z.string(),
  message: z.string(),
  /** The right the caller lacks, where a right is missing. */
  right: z.string().optional()
});

const appPublishReviewItemSchema = z.object({
  name: z.string(),
  title: z.string(),
  draftRevision: z.number().int().positive(),
  publishedRevision: z.number().int().positive().optional(),
  /** The draft holds changes its published revision does not, or nothing is published yet. */
  pending: z.boolean(),
  /** The sentence the person's publish question leads with, for the draft revision. */
  narrative: publishNarrativeSchema.optional(),
  /** Who wrote the draft revision, as people read their name. */
  lastChangedBy: z.string().optional(),
  refusals: z.array(appPublishRefusalSchema)
});

/**
 * What publishing an App's draft comes to, read before the person is asked (DP-2): the App and
 * the Workflows it reaches, children before the Workflows that start them, each with its
 * pending draft, what its publish question says, and what would refuse it. It changes nothing.
 */
export const appPublishReviewSchema = z.object({
  app: appPublishReviewItemSchema,
  workflows: z.array(
    appPublishReviewItemSchema.extend({
      /** The actions of the App's draft that call it. None for a child of another Workflow. */
      actions: z.array(z.string()),
      /** The newest test run of the Workflow among its recent runs, by anyone. */
      lastTestRun: z
        .object({ runId: z.string(), status: z.enum(WORKFLOW_RUN_STATUSES), at: z.string() })
        .optional()
    })
  ),
  /**
   * One Publish of the App also publishes the pending Workflow drafts it reaches, when the
   * publish names them in `workflows` (DP-3). Where false, each pending Workflow is published
   * before the App, by its own publish.
   */
  publishesTogether: z.boolean(),
  /** Nothing in the review would be refused. */
  ready: z.boolean()
});

export type AppPublishReview = z.infer<typeof appPublishReviewSchema>;
export type AppActionCallResult = z.infer<typeof appActionCallResultSchema>;

export const appActionsListQuerySchema = listQuerySchema
  .extend({
    /**
     * The id of one App. Named, the answer holds that App alone: its draft for whoever writes
     * it, the published revision for everybody else who reads it. Left out, it holds the
     * published revisions of one cursor page of Apps the caller reads or uses.
     */
    app: z.string().min(1).max(63).optional()
  })
  .strict();

/** Why a call of an action cannot reach the operation it stands for, whoever calls. */
export const appActionUnavailableSchema = z.enum([
  "connection_missing",
  "connection_disabled",
  "operation_missing",
  "operation_disabled",
  /** The operation is not exposed to Apps (`bridge`). */
  "not_exposed"
]);

export type AppActionUnavailable = z.infer<typeof appActionUnavailableSchema>;

/** The catalog a use holder may choose from, without configuration or a call preview. */
const appActionSummary = {
  name: z.string(),
  effect: z.enum(OPERATION_EFFECTS),
  description: z.string().optional()
};

/** What every named action a reader sees is listed with, whatever its kind. */
const listedAppAction = {
  ...appActionSummary,
  /** The operation the action is, as an agent lists it: `app.<id>.<action>`. */
  toolName: z.string(),
  /** What the action takes: its declared parameters, as JSON Schema. */
  inputSchema: z.record(z.string(), z.unknown()),
  /**
   * What a call of the action would come to for the caller now, by the caller's rights and
   * the policy, as it would be live. Where a draft's call goes instead, `target` says.
   */
  policy: appActionPermissionSchema,
  /**
   * In the draft (ADR-0031): where the caller's next call of the action goes. `live` for a
   * reading action, and for a changing one the caller switched "Run live once" on for;
   * `dry_run` for any other changing action, which is simulated; `test` for a `workflow` action,
   * which starts a test run of the Workflow (DP-1). Missing for a published revision, every
   * call of which is live.
   */
  target: operationTargetSchema.optional(),
  /** An agent that lists `toolName` carries the action as a tool now. */
  agentTool: z.boolean()
};

/**
 * Why a call of an `sql` action cannot reach its Data Store, whoever calls: no published store
 * of the name is in the App's scope, the manifest does not list it, or its module is off.
 */
export const appSqlActionUnavailableSchema = z.enum(["data_store_missing"]);

/** Why a call of a `workflow` action cannot start its Workflow, whoever calls: the module is off. */
export const appWorkflowActionUnavailableSchema = z.enum(["workflows_off"]);

/**
 * One named action of a revision, with what a call of it would come to for the caller, by its
 * kind. A `connection` action names the Connection and the operation of it that it stands
 * for. An `sql` action names the Data Store its statement reads or adds a row to. A
 * `workflow` action names the Workflow it starts.
 */
export const appActionSchema = z.discriminatedUnion("kind", [
  z.object({
    ...listedAppAction,
    kind: z.literal("connection"),
    /** The Connection by its name, with its label where the caller may read the Connection. */
    connection: z.object({ name: z.string(), title: z.string().optional() }),
    /** The operation of the Connection the action stands for, by its name. */
    operation: z.string(),
    unavailable: appActionUnavailableSchema.optional()
  }),
  z.object({
    ...listedAppAction,
    kind: z.literal("sql"),
    /** The Data Store by its name, with its title where the caller may read the store. */
    dataStore: z.object({ name: z.string(), title: z.string().optional() }),
    unavailable: appSqlActionUnavailableSchema.optional()
  }),
  z.object({
    ...listedAppAction,
    kind: z.literal("workflow"),
    /** The Workflow by its id. */
    workflow: z.object({ name: z.string() }),
    unavailable: appWorkflowActionUnavailableSchema.optional()
  })
]);

export type AppAction = z.infer<typeof appActionSchema>;

export const appActionsSchema = z.object({
  apps: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      scope: assetScopeSchema,
      /** Which revision the actions are read from, and its number. */
      view: appModeSchema,
      revision: z.number().int().positive(),
      /** Readers get the full view; use-only holders get just name, description and effect. */
      actions: z.array(z.union([appActionSchema, z.strictObject(appActionSummary)]))
    })
  ),
  /** Kept for existing readers; true while another cursor page follows. */
  truncated: z.boolean(),
  nextCursor: z.string().optional()
});

export type AppActions = z.infer<typeof appActionsSchema>;
