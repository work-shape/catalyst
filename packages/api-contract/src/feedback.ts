import {
  FEEDBACK_CATEGORY_MAX_LENGTH,
  FEEDBACK_NOTE_MAX_LENGTH,
  FEEDBACK_STATES,
  FEEDBACK_SUBJECT_KINDS,
  FEEDBACK_SUMMARY_MAX_LENGTH,
  FEEDBACK_TEXT_MAX_LENGTH
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { listQuerySchema } from "./shared";

// Written feedback on agent messages, of the module `feedback` (LU-4). The author reads their
// own comments with their state; a holder of `feedback.review` reads every comment on the
// agents the right covers, with the author, the agent's revision and the exchange where the
// author included it.

const feedbackTextSchema = z.string().trim().min(1).max(FEEDBACK_TEXT_MAX_LENGTH);

export const sendFeedbackRequestSchema = z
  .object({
    /** The Agent Run whose answer the comment is about. */
    runId: z.string().min(1),
    text: feedbackTextSchema,
    /** Copy the question and this one answer into the comment for its reviewer. */
    includeExchange: z.boolean()
  })
  .strict();

export const updateFeedbackRequestSchema = z
  .object({ text: feedbackTextSchema, includeExchange: z.boolean() })
  .strict();

export const markFeedbackHandledRequestSchema = z
  .object({ note: z.string().trim().max(FEEDBACK_NOTE_MAX_LENGTH).optional() })
  .strict();

export const annotateFeedbackRequestSchema = z
  .object({
    summary: z.string().trim().min(1).max(FEEDBACK_SUMMARY_MAX_LENGTH),
    category: z.string().trim().min(1).max(FEEDBACK_CATEGORY_MAX_LENGTH).optional()
  })
  .strict();

export const listFeedbackQuerySchema = listQuerySchema.extend({
  /** Only the comments on this agent, by its name. */
  agent: z.string().min(1).optional(),
  state: z.enum(FEEDBACK_STATES).optional()
});

/** A comment as its author reads it: its state, and nothing of its reviewer's note. */
export const ownFeedbackSchema = z.object({
  id: z.string(),
  messageId: z.string().optional(),
  agentRunId: z.string().optional(),
  text: z.string(),
  includesExchange: z.boolean(),
  state: z.enum(FEEDBACK_STATES),
  createdAt: z.string(),
  updatedAt: z.string()
});

/** A comment as its reviewer reads it. */
export const feedbackSchema = z.object({
  id: z.string(),
  subjectKind: z.enum(FEEDBACK_SUBJECT_KINDS),
  messageId: z.string().optional(),
  agent: z.object({
    name: z.string(),
    assetId: z.string().optional(),
    /** The agent's live revision when the comment was sent. */
    revision: z.number().int().optional(),
    workspaceId: z.string().optional()
  }),
  /** References; they may point at a conversation retention has deleted. */
  conversationId: z.string().optional(),
  agentRunId: z.string().optional(),
  workspaceId: z.string().optional(),
  author: z.object({ id: z.string(), displayLabel: z.string().optional() }),
  text: z.string(),
  exchange: z.object({ question: z.string(), answer: z.string() }).optional(),
  /** Written by a workflow, never by a person. */
  annotation: z
    .object({
      summary: z.string(),
      category: z.string().optional(),
      annotatedAt: z.string(),
      machineWritten: z.literal(true)
    })
    .optional(),
  state: z.enum(FEEDBACK_STATES),
  handled: z
    .object({ byLabel: z.string(), at: z.string(), note: z.string().optional() })
    .optional(),
  approvalRequestId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type SendFeedbackRequest = z.infer<typeof sendFeedbackRequestSchema>;
export type UpdateFeedbackRequest = z.infer<typeof updateFeedbackRequestSchema>;
export type OwnFeedback = z.infer<typeof ownFeedbackSchema>;
export type FeedbackView = z.infer<typeof feedbackSchema>;
