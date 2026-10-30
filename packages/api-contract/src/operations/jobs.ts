import { z } from "zod";
import { jobKindSummarySchema, jobSchema, jobStatusListSchema } from "../jobs";
import { listQuerySchema } from "../shared";
import { defineOperation, defineRegisteredOperation, json, page } from "./define-operation";

// The two reads are plain operations. They were kept plain when every registered read wrote an
// Operation Run and three audit rows; an allowed read writes neither any more, so nothing but
// the work of moving them keeps them plain.
export const jobOperations = {
  "instance.jobs.summary": defineOperation({
    id: "instance.jobs.summary",
    method: "GET",
    path: "/api/v1/instance/jobs/summary",
    summary: "Count the queued, running, failed and dead background jobs of each kind",
    tag: "Jobs",
    auth: "principal",
    scope: "governance:read",
    personalKeyScope: "instance:inspect",
    requires: ["system.view"],
    effect: "reading",
    response: json(z.object({ items: z.array(jobKindSummarySchema) })),
    errors: [],
    rateClass: "read"
  }),
  "instance.jobs.list": defineOperation({
    id: "instance.jobs.list",
    method: "GET",
    path: "/api/v1/instance/jobs",
    summary: "List background jobs, newest first, without their payload",
    tag: "Jobs",
    auth: "principal",
    scope: "governance:read",
    personalKeyScope: "instance:inspect",
    requires: ["system.view"],
    effect: "reading",
    query: listQuerySchema.extend({
      kind: z.string().min(1).optional(),
      status: jobStatusListSchema.optional()
    }),
    response: page(jobSchema, ["createdAt", "id"], true),
    errors: [],
    rateClass: "read"
  }),
  "instance.jobs.retry": defineRegisteredOperation({
    id: "instance.jobs.retry",
    method: "POST",
    path: "/api/v1/instance/jobs/:jobId/retry",
    summary: "Queue a failed or dead background job again. Needs the right `jobs.retry`.",
    tag: "Jobs",
    auth: "user",
    scope: "governance:write",
    requires: ["jobs.retry"],
    effect: "changing",
    response: json(jobSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  })
} as const;
