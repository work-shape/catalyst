import { platformReportSchema, sendPlatformReportRequestSchema } from "../platform-report";
import { defineRegisteredOperation, json } from "./define-operation";

/**
 * "Problem an Workshape melden" (PLATFORM-REPORT): a person who reads a conversation reports a
 * run of it that failed for a platform reason to the operator's support address. The mail
 * carries the run's id, the error code, the instance, the time and the person's note; nothing
 * of the conversation. One report per run and person, a few per person and hour. Only a
 * person in the interface sends one; an agent, a key or a Workflow is refused.
 */
export const platformReportOperations = {
  "platform_report.send": defineRegisteredOperation({
    id: "platform_report.send",
    method: "POST",
    path: "/api/v1/conversations/:conversationId/runs/:runId/platform-report",
    summary: "Report a run that failed for a platform reason to the operator's support address",
    tag: "Conversations",
    auth: "user",
    scope: "conversation:read",
    requires: [],
    effect: "changing",
    body: sendPlatformReportRequestSchema,
    response: json(platformReportSchema),
    errors: ["NOT_FOUND", "CONFLICT", "FORBIDDEN", "VALIDATION_FAILED"],
    rateClass: "write"
  })
};
