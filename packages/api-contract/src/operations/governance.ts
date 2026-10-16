import { z } from "zod";
import { listQuerySchema } from "../shared";
import { auditActivitySchema, auditEventSchema, usageSummarySchema } from "../governance";
import { defineOperation, json, page } from "./define-operation";

export const governanceOperations = {
  "audit_events.list": defineOperation({
    id: "audit_events.list",
    method: "GET",
    path: "/api/v1/instance/audit-events",
    summary: "List the latest audit events",
    tag: "Governance",
    auth: "user",
    scope: "governance:read",
    requires: ["audit.view"],
    effect: "reading",
    query: listQuerySchema,
    response: page(auditEventSchema, ["createdAt", "id"], true),
    errors: [],
    rateClass: "read"
  }),
  "audit_activities.list": defineOperation({
    id: "audit_activities.list",
    method: "GET",
    path: "/api/v1/instance/audit-activities",
    summary: "List the latest audit activities",
    tag: "Governance",
    auth: "user",
    scope: "governance:read",
    requires: ["audit.view"],
    effect: "reading",
    // The latest activities only: not a paged list, so it takes no limit and no cursor.
    response: json(z.object({ items: z.array(auditActivitySchema) })),
    errors: [],
    rateClass: "read"
  }),
  "usage.get_summary": defineOperation({
    id: "usage.get_summary",
    method: "GET",
    path: "/api/v1/instance/usage",
    summary: "Read model usage and budget of the instance",
    tag: "Governance",
    auth: "user",
    scope: "governance:read",
    requires: ["usage.view"],
    effect: "reading",
    response: json(usageSummarySchema),
    errors: [],
    rateClass: "read"
  })
} as const;
