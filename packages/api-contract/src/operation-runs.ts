import {
  OPERATION_EFFECTS,
  OPERATION_RUN_DECISION_MODES,
  OPERATION_RUN_DECISION_REASONS,
  OPERATION_RUN_STATUSES,
  OPERATION_TARGETS,
  PRINCIPAL_HOLDER_KINDS
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { timestampSchema } from "./shared";

/** Where a call goes or went (ADR-0031): the called asset, its test target, or nowhere. */
export const operationTargetSchema = z.enum(OPERATION_TARGETS);

export const operationRunOriginSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("agent"),
    agentRunId: z.string(),
    conversationId: z.string(),
    agentName: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    /** The revision a data tool was read from when the call was made, where it names one. */
    toolRevisionId: z.string().optional(),
    /**
     * A Workflow agent step's call in a test run of a draft, which acts as the person testing:
     * the service principal whose rights bounded theirs.
     */
    boundBy: z.object({ id: z.string(), label: z.string() }).optional(),
    draft: z
      .object({
        kind: z.literal("agent_preview"),
        asset: z.object({ kind: z.string(), id: z.string(), name: z.string() }),
        revisionId: z.string(),
        part: z.string()
      })
      .optional()
  }),
  z.object({ kind: z.literal("user") }),
  z.object({ kind: z.literal("cli"), unattended: z.literal(true).optional() }),
  z.object({ kind: z.literal("mcp"), clientName: z.string().optional() }),
  z.object({
    kind: z.literal("app"),
    /** The App the frame shows, by its name. A Page of a conversation names none. */
    appName: z.string().optional(),
    appRevisionId: z.string(),
    actionName: z.string(),
    pageSessionId: z.string(),
    conversationId: z.string().optional(),
    /**
     * What the call reached, by name: a Connection and its operation, the Data Store a
     * statement read, or the Workflow it started. No input and no result.
     */
    target: z
      .union([
        z.object({ connection: z.string(), operation: z.string() }),
        z.object({ dataStore: z.string() }),
        z.object({ workflow: z.string() })
      ])
      .optional()
  }),
  z.object({
    kind: z.literal("workflow"),
    workflowRunId: z.string(),
    stepRunId: z.string(),
    /**
     * In a test run of a Workflow draft, which acts as the person testing: the service
     * principal whose rights bounded theirs.
     */
    boundBy: z.object({ id: z.string(), label: z.string() }).optional()
  }),
  z.object({ kind: z.literal("schedule"), scheduleId: z.string() })
]);

export const operationRunStatusSchema = z.enum(OPERATION_RUN_STATUSES);

/**
 * The record of one call of an operation, as a caller reads it. It names the input by its
 * hash and holds neither the input nor what the call answered.
 */
export const operationRunSchema = z.object({
  id: z.string(),
  operation: z.string(),
  effect: z.enum(OPERATION_EFFECTS),
  status: operationRunStatusSchema,
  actor: z.object({
    kind: z.enum(PRINCIPAL_HOLDER_KINDS),
    id: z.string(),
    label: z.string()
  }),
  origin: operationRunOriginSchema,
  /**
   * Where the call went: `live`, the asset it calls; `test`, that asset's test target; or
   * `dry_run`, nowhere, a changing call of a draft that answered what it would have done.
   */
  target: operationTargetSchema,
  /**
   * The App a call with the origin `app` came from, as the instance holds it when the run is
   * read. Nothing of it is kept on the run. A run of a Page of a conversation has none.
   */
  app: z
    .object({
      /** What people read as the App's name. Absent once the App is deleted. */
      title: z.string().optional(),
      /** The number of the revision the call was made in, while the App still points at it. */
      revision: z.number().int().positive().optional(),
      deleted: z.boolean()
    })
    .optional(),
  workspaceId: z.string().optional(),
  /** The request another person decides, while and after the run waits for it. */
  approvalRequestId: z.string().optional(),
  inputHash: z.string(),
  attempt: z.number().int().min(1),
  decision: z
    .object({
      mode: z.enum(OPERATION_RUN_DECISION_MODES),
      /**
       * `inherited_approval_not_applied`: the instance default asked for an approval and the
       * call ran on its caller's word, because its answer is a secret that is shown once.
       * `workflow_publish`: a step of a run of a published Workflow revision made a call whose
       * policy asks for a confirmation, and publishing the Workflow was that confirmation.
       * `approved_by_caller`: a guardrail asked for an approval and the caller holds the right
       * that decides it, so their own call was the approval; `by` is caller and approver.
       */
      reason: z.enum(OPERATION_RUN_DECISION_REASONS).optional(),
      by: z.string(),
      /** The name of who decided, where the decision was another person's. */
      byLabel: z.string().optional(),
      at: timestampSchema,
      comment: z.string().optional()
    })
    .optional(),
  /** Why the run failed or was refused: a code and a message, never a provider's text. */
  error: z
    .object({ code: z.string(), message: z.string(), reason: z.string().optional() })
    .optional(),
  /** What the model calls made inside the run used, where it made any. */
  usage: z
    .object({
      modelCalls: z.number().int().min(0),
      inputTokens: z.number().int().min(0),
      outputTokens: z.number().int().min(0),
      totalTokens: z.number().int().min(0)
    })
    .optional(),
  correlationId: z.string(),
  createdAt: timestampSchema,
  startedAt: timestampSchema.optional(),
  finishedAt: timestampSchema.optional(),
  /** When a waiting run expires unexecuted. */
  expiresAt: timestampSchema.optional(),
  /** Where this run is read. */
  href: z.string()
});

export type OperationRunResource = z.infer<typeof operationRunSchema>;
