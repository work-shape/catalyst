import { z } from "zod";
import { configAssetConfigSchema } from "./configuration";
import { conversationSchema } from "./conversations";
import { timestampSchema } from "./shared";

const revisionNumberSchema = z.number().int().positive();
export const agentDraftSchema = z.object({
  agent: z.string(),
  revision: revisionNumberSchema,
  baseRevision: revisionNumberSchema,
  liveRevision: revisionNumberSchema,
  stale: z.boolean(),
  config: configAssetConfigSchema,
  author: z.object({
    userId: z.string().optional(),
    /** The name of the person who wrote the draft last, while their account exists. */
    displayLabel: z.string().optional(),
    /** The name people read for the person who wrote the draft last, while they exist. */
    name: z.string().optional(),
    conversationId: z.string().optional(),
    release: z.boolean()
  }),
  updatedAt: timestampSchema
});
/** The agent's one draft as `agents.draft.get` answers it to a holder of its write right. */
export type AgentDraft = z.infer<typeof agentDraftSchema>;
export const agentDraftResponseSchema = z.object({ draft: agentDraftSchema.nullable() });
export const discardAgentDraftRequestSchema = z.object({
  expectedRevision: revisionNumberSchema,
  workspaceId: z.string().optional()
});
export const discardAgentDraftResponseSchema = z.object({ discarded: z.literal(true) });

// The Try conversation beside a Build conversation (TRY-1b): the person tries the agent under
// construction there. No conversation list shows it, and its usage is marked `preview`.
export const agentTryConversationResponseSchema = z.object({
  conversation: conversationSchema,
  /** A Try conversation is a preview: its head says so. */
  preview: z.literal(true)
});
