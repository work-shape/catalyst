import { z } from "zod";
import {
  annotateFeedbackRequestSchema,
  feedbackSchema,
  listFeedbackQuerySchema,
  markFeedbackHandledRequestSchema,
  ownFeedbackSchema,
  sendAppFeedbackRequestSchema,
  sendFeedbackRequestSchema,
  sendResultFeedbackRequestSchema,
  updateFeedbackRequestSchema
} from "../feedback";
import { defineRegisteredOperation, json, page } from "./define-operation";

const withdrawnFeedbackSchema = z.object({ withdrawn: z.literal(true) });

/**
 * Written feedback, of the module `feedback`. Its author sends, changes and withdraws a comment
 * under an answer of a conversation they can read, until a reviewer has marked it handled
 * (LU-4); sends one from inside a published App, and one on the result of a Workflow run that
 * a notice in their Inbox reports (LU-6). A holder of `feedback.review`, on the instance or on
 * the workspace that owns the agent, the App or the Workflow, reads it, marks it handled and
 * stores a machine-written summary on it. Spec: limits-usage-analytics-and-feedback.md, 3.5.
 */
export const feedbackOperations = {
  "feedback.list_own": defineRegisteredOperation({
    id: "feedback.list_own",
    method: "GET",
    path: "/api/v1/conversations/:conversationId/feedback",
    summary: "List the caller's own feedback in one conversation, with its state",
    tag: "Feedback",
    auth: "user",
    scope: "conversation:read",
    requires: [],
    effect: "reading",
    response: json(z.object({ items: z.array(ownFeedbackSchema) })),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "feedback.send": defineRegisteredOperation({
    id: "feedback.send",
    method: "POST",
    path: "/api/v1/conversations/:conversationId/feedback",
    summary: "Send a written comment on an agent's answer to the agent's reviewers",
    tag: "Feedback",
    auth: "user",
    scope: "conversation:write",
    requires: [],
    effect: "changing",
    body: sendFeedbackRequestSchema,
    response: json(ownFeedbackSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "feedback.update": defineRegisteredOperation({
    id: "feedback.update",
    method: "POST",
    path: "/api/v1/conversations/:conversationId/feedback/:feedbackId",
    summary: "Change one's own comment until a reviewer marked it handled",
    tag: "Feedback",
    auth: "user",
    scope: "conversation:write",
    requires: [],
    effect: "changing",
    body: updateFeedbackRequestSchema,
    response: json(ownFeedbackSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "feedback.withdraw": defineRegisteredOperation({
    id: "feedback.withdraw",
    method: "POST",
    path: "/api/v1/conversations/:conversationId/feedback/:feedbackId/withdraw",
    summary: "Withdraw one's own comment until a reviewer marked it handled; it is deleted",
    tag: "Feedback",
    auth: "user",
    scope: "conversation:write",
    requires: [],
    effect: "changing",
    response: json(withdrawnFeedbackSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "feedback.send_from_app": defineRegisteredOperation({
    id: "feedback.send_from_app",
    method: "POST",
    path: "/api/v1/app-content-sessions/:pageSessionId/feedback",
    summary:
      "Send a written comment on the published App a frame shows to the App's reviewers; the frame names the App and its revision",
    tag: "Feedback",
    auth: "user",
    scope: "conversation:write",
    requires: [],
    effect: "changing",
    body: sendAppFeedbackRequestSchema,
    response: json(ownFeedbackSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "feedback.list_own_on_result": defineRegisteredOperation({
    id: "feedback.list_own_on_result",
    method: "GET",
    path: "/api/v1/approval-requests/:requestId/feedback",
    summary:
      "List the caller's own feedback on the Workflow run a notice in their Inbox reports, with its state",
    tag: "Feedback",
    auth: "user",
    scope: "conversation:read",
    requires: [],
    effect: "reading",
    response: json(z.object({ items: z.array(ownFeedbackSchema) })),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "feedback.send_on_result": defineRegisteredOperation({
    id: "feedback.send_on_result",
    method: "POST",
    path: "/api/v1/approval-requests/:requestId/feedback",
    summary:
      "Send a written comment on the Workflow run a notice in the caller's Inbox reports to the Workflow's reviewers",
    tag: "Feedback",
    auth: "user",
    scope: "governance:write",
    requires: [],
    effect: "changing",
    body: sendResultFeedbackRequestSchema,
    response: json(ownFeedbackSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "feedback.list": defineRegisteredOperation({
    id: "feedback.list",
    method: "GET",
    path: "/api/v1/feedback",
    summary: "List the feedback on the agents the caller reviews, newest first",
    tag: "Feedback",
    auth: "principal",
    scope: "governance:read",
    requires: [],
    effect: "reading",
    query: listFeedbackQuerySchema,
    response: page(feedbackSchema, ["createdAt", "id"], true),
    errors: [],
    rateClass: "read"
  }),
  "feedback.get": defineRegisteredOperation({
    id: "feedback.get",
    method: "GET",
    path: "/api/v1/feedback/:feedbackId",
    summary: "Read one comment on an agent the caller reviews",
    tag: "Feedback",
    auth: "principal",
    scope: "governance:read",
    requires: [],
    effect: "reading",
    response: json(feedbackSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "feedback.mark_handled": defineRegisteredOperation({
    id: "feedback.mark_handled",
    method: "POST",
    path: "/api/v1/feedback/:feedbackId/handled",
    summary: "Mark a comment handled, with an optional note; its Inbox item is decided with it",
    tag: "Feedback",
    auth: "user",
    scope: "governance:write",
    requires: [],
    effect: "changing",
    body: markFeedbackHandledRequestSchema,
    response: json(feedbackSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "feedback.annotate": defineRegisteredOperation({
    id: "feedback.annotate",
    method: "POST",
    path: "/api/v1/feedback/:feedbackId/annotation",
    summary:
      "Store a machine-written summary and category on a comment; the comment stays unchanged",
    tag: "Feedback",
    auth: "principal",
    scope: "governance:write",
    requires: [],
    effect: "changing",
    body: annotateFeedbackRequestSchema,
    response: json(feedbackSchema),
    errors: ["NOT_FOUND"],
    rateClass: "write"
  })
} as const;
