import { SCHEDULED_START_STATES } from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { listQuerySchema } from "../shared";
import {
  createScheduledStartSchema,
  scheduledStartFieldsSchema,
  listedScheduledStartSchema,
  scheduledStartSchema,
  scheduledStartRunSchema,
  withheldScheduledStartSchema
} from "../scheduled-starts";
import { defineRegisteredOperation, json, page } from "./define-operation";

const own = {
  auth: "user",
  scope: "conversation:write",
  requires: [],
  tag: "Scheduled starts",
  rateClass: "write",
  effect: "changing",
  errors: ["NOT_FOUND", "CONFLICT"]
} as const;
export const scheduledStartOperations = {
  "scheduled_starts.list": defineRegisteredOperation({
    ...own,
    id: "scheduled_starts.list",
    method: "GET",
    path: "/api/v1/scheduled-starts",
    summary:
      "List your own scheduled prompts, or as an instance admin a deactivated person's without their prompts",
    effect: "reading",
    scope: "conversation:read",
    rateClass: "read",
    query: listQuerySchema.extend({
      collaborationWorkspaceId: z.string().optional(),
      ownerUserId: z.string().min(1).optional()
    }),
    response: page(listedScheduledStartSchema, ["createdAt", "id"], true)
  }),
  "scheduled_starts.create": defineRegisteredOperation({
    ...own,
    id: "scheduled_starts.create",
    method: "POST",
    path: "/api/v1/scheduled-starts",
    summary: "Schedule a saved prompt to run as you",
    body: createScheduledStartSchema,
    response: json(scheduledStartSchema)
  }),
  "scheduled_starts.update": defineRegisteredOperation({
    ...own,
    id: "scheduled_starts.update",
    method: "PATCH",
    path: "/api/v1/scheduled-starts/:scheduledStartId",
    summary: "Change your scheduled prompt",
    body: scheduledStartFieldsSchema,
    response: json(scheduledStartSchema)
  }),
  "scheduled_starts.set_state": defineRegisteredOperation({
    ...own,
    id: "scheduled_starts.set_state",
    method: "POST",
    path: "/api/v1/scheduled-starts/:scheduledStartId/state",
    summary: "Pause or resume your scheduled prompt",
    body: z.strictObject({ state: z.enum(SCHEDULED_START_STATES) }),
    response: json(scheduledStartSchema)
  }),
  "scheduled_starts.run_now": defineRegisteredOperation({
    ...own,
    id: "scheduled_starts.run_now",
    method: "POST",
    path: "/api/v1/scheduled-starts/:scheduledStartId/run",
    summary: "Queue your scheduled prompt now",
    response: json(z.object({ queued: z.literal(true) }))
  }),
  "scheduled_starts.delete": defineRegisteredOperation({
    ...own,
    id: "scheduled_starts.delete",
    method: "DELETE",
    path: "/api/v1/scheduled-starts/:scheduledStartId",
    summary: "Delete your scheduled prompt or a deactivated owner's start",
    response: json(z.object({ deleted: z.literal(true) }))
  }),
  "scheduled_starts.runs": defineRegisteredOperation({
    ...own,
    id: "scheduled_starts.runs",
    method: "GET",
    path: "/api/v1/scheduled-starts/:scheduledStartId/runs",
    summary: "Read the runs of your scheduled prompt",
    effect: "reading",
    scope: "conversation:read",
    rateClass: "read",
    query: listQuerySchema,
    response: page(scheduledStartRunSchema, ["createdAt", "id"], true)
  }),
  "scheduled_starts.handover": defineRegisteredOperation({
    ...own,
    id: "scheduled_starts.handover",
    method: "POST",
    path: "/api/v1/scheduled-starts/:scheduledStartId/handover",
    summary: "Hand a deactivated owner's scheduled prompt to another person, paused",
    body: z.strictObject({ ownerUserId: z.string().min(1) }),
    response: json(withheldScheduledStartSchema)
  })
};
