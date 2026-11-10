import {
  APPROVAL_CHECK_STATUSES,
  APPROVAL_REQUEST_STATUSES
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { timestampSchema } from "./shared";

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const approvalRequestStatusSchema = z.enum(APPROVAL_REQUEST_STATUSES);

export const approvalCheckResultSchema = z.object({
  id: z.string(),
  status: z.enum(APPROVAL_CHECK_STATUSES),
  message: z.string()
});

export const approvalRequestSchema = z.object({
  id: z.string(),
  clientInstanceId: z.string(),
  kind: z.string(),
  summary: z.string(),
  payload: jsonObjectSchema,
  requestedBy: z.object({ id: z.string(), displayLabel: z.string() }),
  origin: z
    .object({
      conversationId: z.string(),
      agentRunId: z.string(),
      toolCallId: z.string(),
      agentName: z.string()
    })
    .optional(),
  /**
   * The one person a confirmation in the Inbox is addressed to, who alone sees and decides it.
   * Absent on a request the holders of a right decide.
   */
  addresseeUserId: z.string().optional(),
  /**
   * The requester held the right that decides it when filing. Pending, it is listed in To
   * decide for them alone; the other holders of the right find it with `scope=others_own`.
   */
  requesterDecides: z.literal(true).optional(),
  status: approvalRequestStatusSchema,
  decision: z
    .object({
      approved: z.boolean(),
      decidedBy: z.string(),
      decidedByLabel: z.string(),
      decidedAt: timestampSchema,
      reason: z.string().optional(),
      comment: z.string().optional()
    })
    .optional(),
  reversion: z
    .object({ revertedBy: z.string(), revertedByLabel: z.string(), revertedAt: timestampSchema })
    .optional(),
  checks: z.array(approvalCheckResultSchema),
  applyResult: jsonObjectSchema.optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
});

export const approvalRequestViewSchema = approvalRequestSchema.extend({
  preview: jsonObjectSchema,
  canDecide: z.boolean(),
  canWithdraw: z.boolean(),
  canRevert: z.boolean()
});

/** The lists of `approval_requests.list` beside the plain one. */
export const APPROVAL_REQUEST_LIST_SCOPES = ["decided", "others_own"] as const;
export type ApprovalRequestListScope = (typeof APPROVAL_REQUEST_LIST_SCOPES)[number];

export const listApprovalRequestsQuerySchema = z.object({
  status: approvalRequestStatusSchema.optional(),
  /**
   * `decided`: the requests that are no longer pending and changed in the last 30 days.
   * `others_own`: the pending requests other people filed who may decide them themselves,
   * which the plain list leaves out.
   */
  scope: z.enum(APPROVAL_REQUEST_LIST_SCOPES).optional()
});
export const pendingApprovalRequestCountSchema = z.object({
  /** The pending requests the caller can decide. */
  count: z.number().int().nonnegative(),
  canReview: z.boolean(),
  /** How many requests the list with `scope=decided` holds for the caller. */
  decided: z.number().int().nonnegative(),
  /**
   * How many pending requests the list with `scope=others_own` holds: not in `count`, since
   * their requesters decide them themselves.
   */
  othersOwn: z.number().int().nonnegative(),
  /** The requests the caller made: those still pending, and all of them. */
  mine: z.object({
    pending: z.number().int().nonnegative(),
    total: z.number().int().nonnegative()
  })
});
export const decideApprovalRequestSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approve"),
    comment: z.string().optional(),
    /**
     * On a confirmation in the person's own Inbox: Allow, and set "Always allow" for the call's
     * operation (OP-6). Refused where the confirmation did not offer it.
     */
    alwaysAllow: z.literal(true).optional()
  }),
  z.object({ decision: z.literal("reject"), comment: z.string().optional() }),
  z.object({ decision: z.literal("request_changes"), comment: z.string().trim().min(1) })
]);

export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type ApprovalRequestView = z.infer<typeof approvalRequestViewSchema>;
export type ApprovalRequestStatus = z.infer<typeof approvalRequestStatusSchema>;
