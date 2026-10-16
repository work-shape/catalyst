import { listQuerySchema } from "../shared";
import {
  approvalRequestSchema,
  approvalRequestViewSchema,
  decideApprovalRequestSchema,
  listApprovalRequestsQuerySchema,
  pendingApprovalRequestCountSchema
} from "../approval-requests";
import { defineOperation, json, page } from "./define-operation";

export const approvalRequestOperations = {
  "approval_requests.get": defineOperation({
    id: "approval_requests.get",
    method: "GET",
    path: "/api/v1/approval-requests/:requestId",
    summary: "Read one approval request",
    tag: "Approval Requests",
    auth: "user",
    scope: "conversation:read",
    requires: [],
    effect: "reading",
    response: json(approvalRequestViewSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "approval_requests.list": defineOperation({
    id: "approval_requests.list",
    method: "GET",
    path: "/api/v1/approval-requests",
    summary: "List approval requests in the review queue",
    tag: "Approval Requests",
    auth: "user",
    scope: "governance:read",
    requires: [],
    effect: "reading",
    query: listApprovalRequestsQuerySchema.extend(listQuerySchema.shape),
    response: page(approvalRequestViewSchema, ["createdAt", "id"], true),
    errors: [],
    rateClass: "read"
  }),
  "approval_requests.list_mine": defineOperation({
    id: "approval_requests.list_mine",
    method: "GET",
    path: "/api/v1/approval-requests/mine",
    summary: "List the approval requests the caller made",
    tag: "Approval Requests",
    auth: "user",
    scope: "conversation:read",
    personalKeyScope: "me:read",
    requires: [],
    effect: "reading",
    query: listQuerySchema,
    response: page(approvalRequestViewSchema, ["createdAt", "id"], true),
    errors: [],
    rateClass: "read"
  }),
  "approval_requests.count_pending": defineOperation({
    id: "approval_requests.count_pending",
    method: "GET",
    path: "/api/v1/approval-requests/pending-count",
    summary: "Count the approval requests waiting for the caller",
    tag: "Approval Requests",
    auth: "user",
    scope: "conversation:read",
    personalKeyScope: "me:read",
    requires: [],
    effect: "reading",
    response: json(pendingApprovalRequestCountSchema),
    errors: [],
    rateClass: "read"
  }),
  "approval_requests.decide": defineOperation({
    id: "approval_requests.decide",
    method: "POST",
    path: "/api/v1/approval-requests/:requestId/decide",
    summary: "Approve or reject an approval request",
    tag: "Approval Requests",
    auth: "user",
    scope: "governance:write",
    requires: [],
    effect: "changing",
    body: decideApprovalRequestSchema,
    response: json(approvalRequestSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "approval_requests.withdraw": defineOperation({
    id: "approval_requests.withdraw",
    method: "POST",
    path: "/api/v1/approval-requests/:requestId/withdraw",
    summary: "Withdraw an approval request the caller created",
    tag: "Approval Requests",
    auth: "user",
    scope: "conversation:write",
    personalKeyScope: "config_assets:write",
    requires: [],
    effect: "changing",
    response: json(approvalRequestSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "approval_requests.revert": defineOperation({
    id: "approval_requests.revert",
    method: "POST",
    path: "/api/v1/approval-requests/:requestId/revert",
    summary: "Revert an applied approval request",
    tag: "Approval Requests",
    auth: "user",
    scope: "governance:write",
    requires: [],
    effect: "changing",
    response: json(approvalRequestSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  })
} as const;
