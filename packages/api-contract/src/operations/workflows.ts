import { WORKFLOW_KINDS } from "@work-shape/catalyst-asset-schemas";
import {
  AGENT_RUN_STATUSES,
  OPERATION_EFFECTS,
  OPERATION_TARGETS,
  PRINCIPAL_HOLDER_KINDS,
  WORKFLOW_RESERVED_STEP_TYPES,
  WORKFLOW_DATASET_STATES,
  WORKFLOW_RUN_MODES,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_STEP_RUN_STATUSES,
  WORKFLOW_STEP_TYPES,
  WORKFLOW_DATASET_DOWNLOAD_FORMATS,
  WORKFLOW_TRIGGER_KINDS
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { assetWarningSchema } from "../assets";
import { listQuerySchema, timestampSchema } from "../shared";
import { defineRegisteredOperation, blob, json, page } from "./define-operation";

// The Workflows of an instance and their runs: the list, the start by hand, the test run of a
// draft, the reads and the cancel. A read answers states,
// times and errors, and of what a run or a step returned only a cut preview. It never answers
// an input.

/** How many characters of a result a read shows at most. The store cuts to the same number. */
export const WORKFLOW_RUN_OUTPUT_PREVIEW_MAX_CHARS = 2_000;

/** How long a run key is at most: `WORKFLOW_RUN_KEY_MAX_LENGTH` of the contract. */
export const WORKFLOW_RUN_KEY_MAX_CHARS = 200;

const runKeySchema = z.string().min(1).max(WORKFLOW_RUN_KEY_MAX_CHARS);

// The values of the Workflow contract in `@work-shape/catalyst-core`, which this package does not
// import. A value the engine writes and this list lacks fails the answer of the read.
const runStatusSchema = z.enum(WORKFLOW_RUN_STATUSES);
const stepRunStatusSchema = z.enum(WORKFLOW_STEP_RUN_STATUSES);
// The reserved blocks are among them: a step run of one says that the engine refused it.
const stepTypeSchema = z.enum([...WORKFLOW_STEP_TYPES, ...WORKFLOW_RESERVED_STEP_TYPES]);
const countsSchema = z.object({
  total: z.number().int().min(0),
  done: z.number().int().min(0),
  failed: z.number().int().min(0),
  running: z.number().int().min(0)
});

const workflowRunErrorSchema = z.object({
  /** A code of the engine, or the code of the refusal or failure of the step's operation. */
  code: z.string(),
  /** A sentence of the product. Never a value of the run and never text of an outside system. */
  message: z.string(),
  /** Where the run's principal was refused for a right it does not hold: that right. */
  action: z.string().optional(),
  /** The Connection of a refused connection.use call, as the step recorded it. */
  connection: z.string().optional(),
  /** That Connection's display name, where the reader may read or use it. */
  connectionTitle: z.string().optional(),
  /** On `confirmation_unattended`: the operation an agent step called that needed one. */
  operation: z.string().optional(),
  /** On a run: the step run it ended at. */
  stepRunId: z.string().optional()
});

const workflowOutputPreviewSchema = z.object({
  /** The start of the value as JSON. */
  text: z.string().max(WORKFLOW_RUN_OUTPUT_PREVIEW_MAX_CHARS),
  truncated: z.boolean()
});

const datasetMetadataSchema = z.object({
  id: z.string(),
  rowSchema: z.record(z.string(), z.unknown()),
  rowCount: z.number().int().min(0),
  bytes: z.number().int().min(0),
  state: z.enum(WORKFLOW_DATASET_STATES)
});

export const workflowRunSchema = z.object({
  /** Descendants that failed, reached a limit or contain failed items, excluding this run. */
  failedDescendantCount: z.number().int().min(0).optional(),
  failedItemCount: z.number().int().min(0).optional(),
  id: z.string(),
  workflow: z.string(),
  /** The revision of the definition the run started on and keeps to its end. */
  definitionRevisionId: z.string(),
  mode: z.enum(WORKFLOW_RUN_MODES),
  trigger: z.enum(WORKFLOW_TRIGGER_KINDS),
  status: runStatusSchema,
  /** A completed data run whose write steps handled no items. */
  empty: z.boolean().optional(),
  /**
   * The service principal the run acts as. Its rights are the rights of every step. A test run
   * (`mode: test`) acts as the person who started it, bounded by this principal.
   */
  principal: z.object({ id: z.string(), name: z.string(), displayLabel: z.string() }),
  startedBy: z.object({
    kind: z.enum(PRINCIPAL_HOLDER_KINDS),
    id: z.string(),
    label: z.string()
  }),
  /** The due time of the schedule that started the run. Missing on every other run. */
  scheduledFor: timestampSchema.optional(),
  /**
   * The run key its start gave the run, such as `2026-09/1402`. Among the Workflow's runs that
   * are open or `done` a key exists once. Missing on a run started without one.
   */
  runKey: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  continuation: z
    .object({
      rootRunId: z.string(),
      previousRunId: z.string().optional(),
      successorRunId: z.string().optional(),
      number: z.number().int().positive()
    })
    .optional(),
  /** The Operation Run of the call that started the run. */
  operationRunId: z.string().optional(),
  parentRunId: z.string().optional(),
  parentStepRunId: z.string().optional(),
  rootRunId: z.string(),
  depth: z.number().int().min(0).max(2),
  itemIndex: z.number().int().min(0).optional(),
  itemLabel: z.string().optional(),
  stepRunCount: z.number().int().min(0),
  /** After this moment no further step starts and the run ends as `limit_reached`. */
  deadlineAt: timestampSchema,
  error: workflowRunErrorSchema.optional(),
  outputPreview: workflowOutputPreviewSchema.optional(),
  datasets: z.array(datasetMetadataSchema).optional(),
  createdAt: timestampSchema,
  startedAt: timestampSchema.optional(),
  finishedAt: timestampSchema.optional(),
  /** The person who cancelled the run. Missing where a service principal did, and on a run nobody cancelled. */
  cancelledBy: z.string().optional(),
  cancelledAt: timestampSchema.optional(),
  /**
   * When the values of the run were removed: its input and result, and the inputs and outputs
   * of its step runs. The run and its step runs stay. Missing while the run has its values.
   */
  dataPrunedAt: timestampSchema.optional()
});

/**
 * The transcript of one agent step's run, read by a holder of `workflow.read_run_data`. It is
 * bounded: at most 100 messages, each text cut at 10,000 characters and a tool input over 2,000
 * characters left out; `truncated` says that something was.
 */
export const workflowStepTranscriptSchema = z.object({
  runId: z.string(),
  messages: z.array(
    z.object({
      role: z.string(),
      text: z.string(),
      toolCalls: z
        .array(z.object({ toolName: z.string(), input: z.unknown().optional() }))
        .optional()
    })
  ),
  truncated: z.boolean()
});

export const workflowStepRunSchema = z.object({
  id: z.string(),
  runId: z.string(),
  stepId: z.string(),
  stepType: stepTypeSchema,
  /** The step's path in the run, such as `each_client[3].bookings`. */
  key: z.string(),
  /** The step run of the block that holds the step: today a loop. */
  containerStepRunId: z.string().optional(),
  /** The branch of that block the step stands in. No block with branches runs yet. */
  branch: z.string().optional(),
  /** Which item of that loop, from 0, and what the loop's `itemLabel` field holds for it. */
  iteration: z.object({ index: z.number().int().min(0), label: z.string().optional() }).optional(),
  /** On the step run of a loop: how many items it has and how far they are. */
  loop: countsSchema.optional(),
  /** On the step run of a loop: how the step runs of each step directly inside it stand, by step id. */
  bodyCounts: z.record(z.string(), countsSchema).optional(),
  /**
   * On the step run of a loop: how many of its items run at once. `asked` is the loop's
   * `concurrency`, an upper bound; `ranWith` is what one process runs of it, which the step
   * slots of a process bound.
   */
  concurrency: z
    .object({ asked: z.number().int().min(1), ranWith: z.number().int().min(1) })
    .optional(),
  /** On the step run of an operation step: what its operation does and what it belongs to. */
  effect: z.enum(OPERATION_EFFECTS).optional(),
  source: z.string().optional(),
  /**
   * On the step run of an operation step: where its call went (ADR-0031). `live` on every step
   * of a run of the published revision; in a test run `dry_run` for a changing step that was
   * simulated, `test` for a call to a test target, `live` for a read and for "Run live once".
   */
  target: z.enum(OPERATION_TARGETS).optional(),
  /**
   * On a step run of a test run: the tester's start satisfied the step's `confirm`, and a run
   * of the published revision asks for an approval here.
   */
  publishedWouldAsk: z.enum(["approval"]).optional(),
  /**
   * On the step run of a code step that ran: what its script wrote to its output and error
   * streams beside its result, each cut to 16 KiB.
   */
  log: z.object({ stdout: z.string(), stderr: z.string(), truncated: z.boolean() }).optional(),
  status: stepRunStatusSchema,
  attempt: z.number().int().min(0),
  /** The Operation Run of the call an operation step made. */
  operationRunId: z.string().optional(),
  /**
   * On the step run of a `workflow` step whose start a run key answered: the run it waits for
   * and does not own. Cancelling this run leaves that one going.
   */
  linkedRunId: z.string().optional(),
  /** The child run owned by this step, when one has started. */
  childRunId: z.string().optional(),
  agent: z
    .object({
      runId: z.string(),
      status: z.enum(AGENT_RUN_STATUSES),
      usage: z.object({
        modelCallCount: z.number(),
        inputTokens: z.number(),
        outputTokens: z.number(),
        totalTokens: z.number()
      })
    })
    .optional(),
  error: workflowRunErrorSchema.optional(),
  inputPreview: workflowOutputPreviewSchema.optional(),
  outputPreview: workflowOutputPreviewSchema.optional(),
  datasets: z.array(datasetMetadataSchema).optional(),
  createdAt: timestampSchema,
  startedAt: timestampSchema.optional(),
  finishedAt: timestampSchema.optional()
});

export const startWorkflowRunRequestSchema = z.object({
  /** The input of the run, checked against the `inputs` of the Workflow's definition. */
  input: z.record(z.string(), z.unknown()).optional(),
  /**
   * The run key, such as `2026-09/1402`. Where a run of the Workflow that is open or `done`
   * holds it, the start starts nothing and answers that run; a run that ended `failed`,
   * `cancelled` or `limit_reached` holds no key.
   */
  key: runKeySchema.optional()
});

/**
 * The runs of a Workflow by their run key: `key` answers the run with that key, `keyPrefix`
 * those whose key starts with it, taken as it is written. Not both.
 */
export const listWorkflowRunsQuerySchema = listQuerySchema.extend({
  key: runKeySchema.optional(),
  keyPrefix: runKeySchema.optional()
});

/**
 * The filters of the step runs of a run: those of one block, one status, one item of a loop.
 * `iteration` counts the items of one loop, so it is given with the `containerStepRunId` of
 * that loop's step run and refused without it. `topLevel=true` answers the step runs that
 * stand in no block, a loop's own step run among them and none of its items; it is refused
 * together with `containerStepRunId`.
 */
export const listWorkflowStepRunsQuerySchema = listQuerySchema.extend({
  topLevel: z.enum(["true", "false"]).optional(),
  containerStepRunId: z.string().min(1).optional(),
  status: stepRunStatusSchema.optional(),
  iteration: z.coerce.number().int().min(0).optional()
});

/**
 * One thing a start by hand of a Workflow is refused for, under the code the refusal of the
 * start carries as its `reason`: a code of the definition (`not_supported_yet`,
 * `block_depth`, `reference_out_of_scope`, `duplicate_step_id`, `operation_not_callable`,
 * `definition_invalid`) or of
 * the start (`no_manual_trigger`, `inputs_unreadable`, `operation_secret`,
 * `principal_inactive`). A later engine may name further codes.
 */
export const workflowStartIssueSchema = z.object({
  /** The technical account’s display label, when it still exists. */
  principalDisplayLabel: z.string().optional(),
  code: z.string(),
  /** A sentence of the product. Never a value of a run. */
  message: z.string(),
  /** Where in the definition it is, such as `steps.check.type`. */
  path: z.string().optional()
});

export const workflowSummarySchema = z.object({
  kind: z.enum(WORKFLOW_KINDS).default("process"),
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  /** The published revision: what a run started now has as its `definitionRevisionId`. */
  definitionRevisionId: z.string(),
  /** Whether a start by hand is accepted now, as far as that is known before its input. */
  runnable: z.boolean(),
  /** Why not. Empty exactly where `runnable` is true. */
  reasons: z.array(workflowStartIssueSchema),
  /**
   * The published revision's `inputs`: the JSON Schema a start's `input` is checked against,
   * from which a page builds its start form. Missing where the definition cannot be read.
   */
  inputs: z.record(z.string(), z.unknown()).optional(),
  /**
   * The display label of the service principal every run of the Workflow acts as. Missing
   * where that principal is disabled or gone, which `reasons` then says.
   */
  runsAs: z.string().optional(),
  /**
   * What the caller may do with this Workflow, of `workflow.read` (its runs) and `workflow.use`
   * (a start). Never empty: a Workflow the caller holds neither on is not listed.
   */
  actions: z.array(z.string()),
  /** The latest run of the Workflow. Missing on one that never ran. */
  lastRun: z
    .object({
      failedDescendantCount: z.number().int().min(0).optional(),
      failedItemCount: z.number().int().min(0).optional(),
      id: z.string(),
      status: runStatusSchema,
      startedAt: timestampSchema.optional(),
      endedAt: timestampSchema.optional()
    })
    .optional()
});

export type WorkflowSummaryResource = z.infer<typeof workflowSummarySchema>;
export type WorkflowRunResource = z.infer<typeof workflowRunSchema>;
export type WorkflowStepRunResource = z.infer<typeof workflowStepRunSchema>;
export type StartWorkflowRunRequest = z.infer<typeof startWorkflowRunRequestSchema>;

// Each is an operation of the registry. None names its right in `requires`: the right is the
// Workflow's own (`workflow.use`, `workflow.read`, `workflow.write`) and is decided on the
// Workflow the call or its run names.
export const workflowOperations = {
  "workflows.unpublish": defineRegisteredOperation({
    id: "workflows.unpublish",
    method: "POST",
    path: "/api/v1/workflows/:workflow/unpublish",
    summary: "Stop a Workflow and remove its owned account and rights; keep its draft",
    tag: "Workflows",
    auth: "user",
    scope: "config_assets:publish",
    requires: [],
    effect: "changing",
    response: json(
      z.object({
        draftRevision: z.number().int().positive(),
        unpublishedRevision: z.number().int().positive(),
        /** The live Apps that start the Workflow and stop working without it (DP-0). */
        warnings: z.array(assetWarningSchema)
      })
    ),
    errors: ["NOT_FOUND", "VALIDATION_FAILED"],
    rateClass: "write"
  }),
  "workflows.download_dataset": defineRegisteredOperation({
    id: "workflows.download_dataset",
    method: "GET",
    path: "/api/v1/workflow-runs/:runId/datasets/:datasetId",
    summary:
      "Download a result dataset as streamed JSON Lines or CSV; requires run-data access or the run starter",
    tag: "Workflows",
    auth: "principal",
    scope: "config_assets:read",
    requires: [],
    effect: "reading",
    query: z.object({ format: z.enum(WORKFLOW_DATASET_DOWNLOAD_FORMATS).default("jsonl") }),
    response: blob(),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "workflows.list": defineRegisteredOperation({
    id: "workflows.list",
    method: "GET",
    path: "/api/v1/workflows",
    summary:
      "List a cursor page of published Workflows the caller may read or use, with latest runs and start readiness. Follow nextCursor until absent to reach every Workflow.",
    tag: "Workflows",
    auth: "principal",
    scope: "config_assets:read",
    requires: [],
    effect: "reading",
    query: listQuerySchema,
    response: json(
      z.object({ items: z.array(workflowSummarySchema), nextCursor: z.string().optional() })
    ),
    errors: [],
    rateClass: "read"
  }),
  "workflows.start": defineRegisteredOperation({
    id: "workflows.start",
    method: "POST",
    path: "/api/v1/workflows/:workflow/runs",
    summary: "Start a run of one published Workflow by hand; it acts as the Workflow's principal",
    tag: "Workflows",
    auth: "principal",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    body: startWorkflowRunRequestSchema,
    response: json(workflowRunSchema),
    errors: ["NOT_FOUND", "CONFLICT", "VALIDATION_FAILED"],
    rateClass: "write"
  }),
  "workflows.test": defineRegisteredOperation({
    id: "workflows.test",
    method: "POST",
    path: "/api/v1/workflows/:workflow/test-runs",
    summary:
      "Start a test run of a Workflow's draft; it acts as the person testing, bounded by the Workflow's principal, and simulates changing steps",
    tag: "Workflows",
    auth: "principal",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    body: startWorkflowRunRequestSchema,
    response: json(workflowRunSchema),
    errors: ["NOT_FOUND", "CONFLICT", "VALIDATION_FAILED"],
    rateClass: "write"
  }),
  "workflows.list_runs": defineRegisteredOperation({
    id: "workflows.list_runs",
    method: "GET",
    path: "/api/v1/workflows/:workflow/runs",
    summary:
      "List the runs of one Workflow with their status, newest first: all of them, or those of one run key or key prefix",
    tag: "Workflows",
    auth: "principal",
    scope: "config_assets:read",
    requires: [],
    effect: "reading",
    query: listWorkflowRunsQuerySchema,
    response: page(workflowRunSchema, ["createdAt", "id"], true),
    errors: ["VALIDATION_FAILED"],
    rateClass: "read"
  }),
  "workflows.get_run": defineRegisteredOperation({
    id: "workflows.get_run",
    method: "GET",
    path: "/api/v1/workflow-runs/:runId",
    summary: "Read one Workflow Run: its status, its times, its error and a preview of its result",
    tag: "Workflows",
    auth: "principal",
    scope: "config_assets:read",
    requires: [],
    effect: "reading",
    response: json(workflowRunSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "workflows.list_step_runs": defineRegisteredOperation({
    id: "workflows.list_step_runs",
    method: "GET",
    path: "/api/v1/workflow-runs/:runId/steps",
    summary:
      "List the step runs of one Workflow Run in the order they were created: all, or those of one block, status or loop item",
    tag: "Workflows",
    auth: "principal",
    scope: "config_assets:read",
    requires: [],
    effect: "reading",
    query: listWorkflowStepRunsQuerySchema,
    response: page(workflowStepRunSchema, ["createdAt", "id"], false),
    errors: ["NOT_FOUND", "VALIDATION_FAILED"],
    rateClass: "read"
  }),
  "workflows.get_step_transcript": defineRegisteredOperation({
    id: "workflows.get_step_transcript",
    method: "GET",
    path: "/api/v1/workflow-runs/:runId/steps/:stepRunId/transcript",
    summary:
      "Read the bounded transcript of one agent step of a Workflow Run; requires run-data access",
    tag: "Workflows",
    auth: "principal",
    scope: "config_assets:read",
    requires: [],
    effect: "reading",
    response: json(workflowStepTranscriptSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "workflows.cancel_run": defineRegisteredOperation({
    id: "workflows.cancel_run",
    method: "POST",
    path: "/api/v1/workflow-runs/:runId/cancel",
    summary: "Cancel one Workflow Run; no further step starts and a running call finishes",
    tag: "Workflows",
    auth: "principal",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    response: json(workflowRunSchema),
    errors: ["NOT_FOUND"],
    rateClass: "write"
  })
} as const;
