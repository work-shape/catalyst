import {
  COLLABORATION_WORKSPACE_KINDS,
  SCHEDULED_START_STATES
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { timestampSchema } from "./shared";

/** A saved prompt shares the request body's existing one-megabyte ceiling. */
export const scheduledStartFieldsSchema = z.strictObject({
  agentName: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(100_000),
  cron: z.string().trim().min(1).max(128),
  timeZone: z.string().trim().min(1).max(100).optional()
});
export const createScheduledStartSchema = scheduledStartFieldsSchema.extend({
  collaborationWorkspaceId: z.string().min(1)
});
export const scheduledStartSchema = z.object({
  id: z.string(),
  clientInstanceId: z.string(),
  ownerUserId: z.string(),
  collaborationWorkspaceId: z.string(),
  agentName: z.string(),
  prompt: z.string(),
  cron: z.string(),
  timeZone: z.string(),
  state: z.enum(SCHEDULED_START_STATES),
  nextRunAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
});
/**
 * A start as somebody other than its owner reads it: an instance admin handing over or deleting
 * a deactivated person's starts. It never carries the prompt, which only its owner reads
 * (ADR-0015 for a Personal Workspace; a Shared Workspace the admin may not open). The workspace's
 * kind says whether a handover is possible: a start in a Personal Workspace is only deleted.
 */
export const withheldScheduledStartSchema = scheduledStartSchema.omit({ prompt: true }).extend({
  workspaceKind: z.enum(COLLABORATION_WORKSPACE_KINDS)
});
/** One row of a list: the owner's own start, or a withheld one for an instance admin. */
export const listedScheduledStartSchema = z.union([
  scheduledStartSchema,
  withheldScheduledStartSchema
]);
export const scheduledStartRunSchema = z.object({
  id: z.string(),
  scheduledStartId: z.string().nullable(),
  scheduledFor: timestampSchema,
  conversationId: z.string().nullable(),
  agentRunId: z.string().nullable(),
  status: z.string(),
  reason: z.string().nullable(),
  createdAt: timestampSchema
});
