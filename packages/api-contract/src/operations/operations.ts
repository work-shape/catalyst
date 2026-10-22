import {
  callableOperationsPageSchema,
  OPERATION_CONFIRMATION_DECISIONS,
  OPERATION_EFFECTS,
  OPERATION_ORIGIN_KINDS
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { appAudienceSchema } from "../assets";
import { agentRunStatusSchema } from "../conversations";
import { operationRunSchema, operationRunStatusSchema } from "../operation-runs";
import { listQuerySchema, timestampSchema } from "../shared";
import { defineOperation, defineRegisteredOperation, json, page } from "./define-operation";

/** A person's decision on a call their own Agent Run waits on. */
const decideOperationRunRequestSchema = z.object({
  decision: z.enum(OPERATION_CONFIRMATION_DECISIONS),
  /** For a waiting App publish: the audience chosen by the person. */
  audience: appAudienceSchema.optional(),
  /** Why, for a decline: the agent reads it. */
  reason: z.string().trim().min(1).max(500).optional()
});

const decideOperationRunResponseSchema = z.object({
  /** The run of the decided call. A confirmed call is executed when its Agent Run resumes. */
  run: operationRunSchema,
  /** The Agent Run that waited: queued again once nothing it waits on is undecided. */
  agentRun: z.object({
    id: z.string(),
    status: agentRunStatusSchema,
    lastSequence: z.number().int().nonnegative()
  })
});

export const operationRunOperations = {
  "operations.get_run": defineOperation({
    id: "operations.get_run",
    method: "GET",
    path: "/api/v1/operations/runs/:runId",
    summary: "Read one Operation Run: your own, or any with the right to view the audit log",
    tag: "Operations",
    auth: "principal",
    scope: "governance:read",
    personalKeyScope: "me:read",
    // A caller reads its own run without a right. Another caller's run takes the right
    // `audit.view`, which the operation checks itself.
    requires: [],
    effect: "reading",
    response: json(operationRunSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "operations.list_runs": defineOperation({
    id: "operations.list_runs",
    method: "GET",
    path: "/api/v1/operations/runs",
    summary: "List the Operation Runs of the instance, newest first",
    tag: "Operations",
    auth: "principal",
    scope: "governance:read",
    requires: ["audit.view"],
    effect: "reading",
    query: listQuerySchema.extend({
      operation: z.string().min(1).optional(),
      /** Only reading calls or only changing ones. Without it the list holds both. */
      effect: z.enum(OPERATION_EFFECTS).optional(),
      status: operationRunStatusSchema.optional(),
      /** The id of the user or service principal that called. */
      actor: z.string().min(1).optional(),
      origin: z.enum(OPERATION_ORIGIN_KINDS).optional(),
      workspaceId: z.string().min(1).optional(),
      /** Runs created at or after this moment. */
      since: timestampSchema.optional()
    }),
    response: page(operationRunSchema, ["createdAt", "id"], true),
    errors: [],
    rateClass: "read"
  }),
  "operations.list_callable": defineRegisteredOperation({
    id: "operations.list_callable",
    method: "GET",
    path: "/api/v1/operations/callable",
    summary:
      "List a page of the operations a step of a Workflow may call, as far as the caller may call them",
    tag: "Operations",
    auth: "principal",
    scope: "config_assets:read",
    // No right of its own: each operation is listed exactly where its own check of a call
    // from a Workflow step lets the caller call it. The listing grants nothing.
    requires: [],
    effect: "reading",
    query: z.object({
      /** Who calls: a step of a Workflow. An App's listing is the agent's alone. */
      for: z.enum(["workflow"]).default("workflow"),
      cursor: z.string().min(1).optional(),
      /** An exact full operation name. */
      name: z.string().min(1).optional(),
      /** Only operation names starting with this, such as `connection.crm.`. */
      prefix: z.string().min(1).optional()
    }),
    response: json(callableOperationsPageSchema),
    errors: [],
    rateClass: "read"
  }),
  "operations.decide": defineRegisteredOperation({
    id: "operations.decide",
    method: "POST",
    path: "/api/v1/operations/runs/:runId/decision",
    summary: "Confirm or decline a call your own Agent Run waits on",
    tag: "Operations",
    auth: "user",
    scope: "conversation:write",
    // Only the person the Agent Run works for decides, which the operation checks itself.
    requires: [],
    effect: "changing",
    body: decideOperationRunRequestSchema,
    response: json(decideOperationRunResponseSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  })
} as const;
