import { z } from "zod";
import { agentUseSchema, dependencyAvailabilitySchema } from "./assets";
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
  dependencyAvailability: dependencyAvailabilitySchema.optional(),
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

/** The most tools one give names: a Connection's operations for agents fit well within it. */
export const AGENT_GIVE_TOOLS_MAX = 200;

/**
 * `agents.give_tools`: tools for the instance's own agent, live at once. `agentId` and
 * `expectedLiveRevision` name the published agent the caller read; another agent of the name
 * or a later live revision is a conflict.
 */
export const giveAgentToolsRequestSchema = z.object({
  agentId: z.string().min(1),
  toolNames: z.array(z.string().trim().min(1).max(300)).min(1).max(AGENT_GIVE_TOOLS_MAX),
  expectedLiveRevision: revisionNumberSchema
});
/**
 * The live revision the give wrote and the one it replaced, and the tools it added: none where
 * the agent held every one already, and then nothing was written.
 */
export const giveAgentToolsResponseSchema = z.object({
  publishedRevision: revisionNumberSchema,
  replacedRevision: revisionNumberSchema,
  givenTools: z.array(z.string())
});

export const setAgentUseRequestSchema = z.object({
  use: agentUseSchema,
  /** The id of the agent as the caller read it. Another agent of the name is a conflict. */
  expectedAssetId: z.string().min(1).optional()
});
export const setAgentUseResponseSchema = z.object({ use: agentUseSchema });

// The Try conversation beside a Build conversation (TRY-1b): the person tries the agent under
// construction there. No conversation list shows it, and its usage is marked `preview`.
export const agentTryConversationResponseSchema = z.object({
  conversation: conversationSchema,
  /** A Try conversation is a preview: its head says so. */
  preview: z.literal(true)
});
