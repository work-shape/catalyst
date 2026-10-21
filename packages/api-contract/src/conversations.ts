import {
  AGENT_PREVIEW_SOURCES,
  FOLLOW_UP_MODES,
  FOLLOW_UP_STATUSES,
  TOOL_DECISION_MODES,
  TOOL_DECISION_OUTCOMES
} from "@work-shape/catalyst-asset-schemas";
import {
  AGENT_RUN_FAILURE_CATEGORIES,
  AGENT_RUN_STATUSES,
  ARTIFACT_PREVIEW_IMAGE_FORMATS,
  ARTIFACT_PREVIEW_IMAGE_MIME_TYPES,
  ATTACHMENT_CREATE_OUTCOMES,
  CHAT_MESSAGE_ROLES,
  CONVERSATION_ATTACHMENT_STATUSES,
  CONVERSATION_VISIBILITIES,
  DECIDED_APPROVAL_REQUEST_STATUSES,
  ENDED_APPROVAL_EXECUTIONS,
  MESSAGE_FINISH_STATUSES,
  MODEL_USAGE_LIMIT_PERIODS,
  MODEL_USAGE_LIMIT_METRICS,
  MODEL_USAGE_LIMIT_SCOPES,
  STRUCTURED_DATA_REVIEW_REASONS,
  TOOL_CALL_STATES,
  WEB_SOURCE_PROVIDERS
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { reasoningEffortSchema } from "./configuration";
import { localeCodeSchema, timestampSchema } from "./shared";

export const conversationVisibilitySchema = z.enum(CONVERSATION_VISIBILITIES);

/**
 * The asset a conversation is about, such as `{ kind: "workflow", name: "month-end" }`. The
 * agent of such a conversation is given the tools that read, check and save a draft of that
 * asset, bound to it by the server.
 */
export const conversationSubjectSchema = z.object({
  kind: z.string().min(1).max(64),
  name: z.string().min(1).max(200)
});

export const conversationSchema = z.object({
  id: z.string(),
  clientInstanceId: z.string(),
  collaborationWorkspaceId: z.string(),
  createdByUserId: z.string(),
  createdByExternalUserId: z.string(),
  visibility: conversationVisibilitySchema,
  title: z.string(),
  status: z.string(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  retainedUntil: timestampSchema,
  deletedAt: timestampSchema.optional(),
  /** The asset the conversation is about. Missing on a conversation about none. */
  subject: conversationSubjectSchema.optional()
});

export const moveConversationRequestSchema = z.object({
  collaborationWorkspaceId: z.string().min(1),
  visibility: conversationVisibilitySchema.optional()
});

export const messageMetadataVersionSchema = z.literal(1);

export const storedReasoningSummarySchema = z.object({
  id: z.string(),
  text: z.string()
});

export const storedModelContextSnapshotSchema = z.object({
  inputTokens: z.number(),
  compactThresholdTokens: z.number(),
  compacted: z.boolean()
});

export const storedToolCallSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.unknown()
});

export const webSourceSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string().optional(),
  provider: z.enum(WEB_SOURCE_PROVIDERS),
  query: z.string().optional(),
  retrievedAt: timestampSchema.optional(),
  snippet: z.string().optional(),
  contentHash: z.string().optional(),
  resultPosition: z.number().optional()
});

const knowledgeCitationSourceSchema = z.object({
  ref: z.string().regex(/^K[1-9][0-9]*$/),
  knowledgeBase: z.string().min(1),
  documentId: z.string().min(1),
  fileId: z.string().min(1),
  fileName: z.string().min(1),
  page: z.number().int().positive().optional(),
  originLink: z.string().optional()
});

export const messageCitationSchema = z.object({
  sourceId: z.string(),
  label: z.string().optional(),
  quote: z.string().optional(),
  characterRange: z
    .object({
      start: z.number(),
      end: z.number()
    })
    .optional()
});

export const userMessageMetadataSchema = z.object({
  version: messageMetadataVersionSchema,
  kind: z.literal("user_message"),
  // Provenance only: the private frozen config remains in the worker's stored message.
  preview: z
    .object({
      agentId: z.string(),
      revision: z.number().int().positive(),
      source: z.enum(AGENT_PREVIEW_SOURCES)
    })
    .optional(),
  attachmentManifest: z.unknown()
});

export const assistantToolCallsMessageMetadataSchema = z.object({
  version: messageMetadataVersionSchema,
  kind: z.literal("assistant_tool_calls"),
  runId: z.string(),
  toolCalls: z.array(storedToolCallSchema),
  reasoning: z.array(storedReasoningSummarySchema).optional(),
  modelContext: storedModelContextSnapshotSchema.optional()
});

export const assistantFinalMessageMetadataSchema = z.object({
  version: messageMetadataVersionSchema,
  kind: z.literal("assistant_final"),
  runId: z.string(),
  finishStatus: z.enum(MESSAGE_FINISH_STATUSES),
  cancellationReason: z.string().optional(),
  reasoning: z.array(storedReasoningSummarySchema).optional(),
  sources: z.array(webSourceSchema).optional(),
  knowledgeSources: z.array(knowledgeCitationSourceSchema).optional(),
  citations: z.array(messageCitationSchema).optional(),
  modelContext: storedModelContextSnapshotSchema.optional()
});

export const toolResultMessageMetadataSchema = z.object({
  version: messageMetadataVersionSchema,
  kind: z.literal("tool_result"),
  runId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
  result: z.unknown(),
  modelOutput: z.string(),
  projectionNotice: z.record(z.string(), z.unknown()).optional()
});

export const approvalDecisionMessageMetadataSchema = z.object({
  version: messageMetadataVersionSchema,
  kind: z.literal("approval_decision"),
  requestId: z.string(),
  requestKind: z.string(),
  status: z.enum(DECIDED_APPROVAL_REQUEST_STATUSES),
  decidedBy: z.string(),
  decidedByLabel: z.string(),
  decidedAt: timestampSchema,
  summary: z.string(),
  comment: z.string().optional(),
  requestedBy: z.string().optional(),
  /** What became of an approved change that ran after the decision. */
  execution: z.enum(ENDED_APPROVAL_EXECUTIONS).optional()
});

export const agentRuntimeMessageMetadataSchema = z.discriminatedUnion("kind", [
  approvalDecisionMessageMetadataSchema,
  userMessageMetadataSchema,
  assistantToolCallsMessageMetadataSchema,
  assistantFinalMessageMetadataSchema,
  toolResultMessageMetadataSchema
]);

export const messageMetadataSchema = z
  .object({
    agentRuntime: z
      .union([agentRuntimeMessageMetadataSchema, z.record(z.string(), z.unknown())])
      .optional(),
    display: z.unknown().optional()
  })
  .catchall(z.unknown());

export const messageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  clientInstanceId: z.string(),
  role: z.enum(CHAT_MESSAGE_ROLES),
  text: z.string(),
  createdAt: timestampSchema,
  metadata: messageMetadataSchema.optional()
});

export const draftAttachmentStatusSchema = z.enum(CONVERSATION_ATTACHMENT_STATUSES);

export const draftAttachmentSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  fileId: z.string(),
  filename: z.string(),
  mimeType: z.string().optional(),
  byteSize: z.number(),
  status: draftAttachmentStatusSchema,
  format: z.string().optional(),
  artifactRefs: z.record(z.string(), z.string()),
  processingMetadata: z.record(z.string(), z.unknown()),
  warnings: z.array(
    z.object({
      code: z.string(),
      message: z.string()
    })
  ),
  error: z.record(z.string(), z.unknown()).optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
});

export const draftAttachmentUploadResponseSchema = z.object({
  attachment: draftAttachmentSchema,
  attachments: z.array(draftAttachmentSchema),
  outcome: z.enum(ATTACHMENT_CREATE_OUTCOMES).optional()
});

export type DraftAttachment = z.infer<typeof draftAttachmentSchema>;
export type DraftAttachmentUploadResponse = z.infer<typeof draftAttachmentUploadResponseSchema>;

export const conversationResourceBaseSchema = z.object({
  resourceId: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
});

export const conversationResourceListItemSchema = z.discriminatedUnion("resourceType", [
  conversationResourceBaseSchema.extend({
    resourceType: z.literal("source_file"),
    attachmentId: z.string(),
    mimeType: z.string().optional(),
    preview: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("source_file"), fileId: z.string() }),
      z.object({
        kind: z.literal("artifact"),
        artifactId: z.string(),
        mimeType: z.string().optional()
      })
    ]),
    download: z.object({
      kind: z.literal("source_file"),
      fileId: z.string(),
      filename: z.string()
    })
  }),
  conversationResourceBaseSchema.extend({
    resourceType: z.literal("generated_file"),
    preview: z.object({ kind: z.literal("artifact"), artifactId: z.string() }),
    download: z.object({
      kind: z.literal("artifact"),
      artifactId: z.string(),
      filename: z.string()
    })
  }),
  conversationResourceBaseSchema.extend({
    resourceType: z.literal("analysis"),
    preview: z.object({
      kind: z.literal("typed_display"),
      display: z.record(z.string(), z.unknown())
    })
  }),
  conversationResourceBaseSchema.extend({
    resourceType: z.literal("structured_result"),
    key: z.string(),
    kind: z.string(),
    schemaVersion: z.number().int().positive(),
    revision: z.number().int().positive(),
    preview: z.object({
      kind: z.literal("typed_display"),
      display: z.record(z.string(), z.unknown())
    })
  }),
  conversationResourceBaseSchema.extend({
    resourceType: z.literal("structured_data"),
    preview: z.object({
      kind: z.literal("structured_data"),
      structuredDataResourceId: z.string()
    })
  })
]);

export const conversationResourceListResponseSchema = z.object({
  items: z.array(conversationResourceListItemSchema),
  nextCursor: z.string().optional()
});

const structuredDataValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const structuredDataResourceResponseSchema = z.object({
  id: z.string(),
  resourceKey: z.string(),
  title: z.string(),
  revision: z.number().int().positive(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  sections: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      fields: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          value: structuredDataValueSchema,
          attention: z
            .object({
              reason: z.enum(STRUCTURED_DATA_REVIEW_REASONS),
              message: z.string().optional()
            })
            .optional(),
          sources: z
            .array(
              z.object({
                attachmentId: z.string(),
                page: z.number().int().positive().optional(),
                filename: z.string()
              })
            )
            .optional()
        })
      )
    })
  )
});

export type StructuredDataResourceResponse = z.infer<typeof structuredDataResourceResponseSchema>;

export const artifactPreviewImagePageSchema = z.object({
  artifactId: z.string(),
  mimeType: z.enum(ARTIFACT_PREVIEW_IMAGE_MIME_TYPES),
  filename: z.string().optional(),
  pageNumber: z.number().int().positive().optional(),
  slideNumber: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional()
});

export const artifactPreviewPendingResponseSchema = z.object({
  status: z.literal("pending"),
  artifactId: z.string(),
  queuedAt: timestampSchema.optional()
});

export const artifactPreviewReadyResponseSchema = z.object({
  status: z.literal("ready"),
  artifactId: z.string(),
  type: z.literal("image_pages"),
  format: z.enum(ARTIFACT_PREVIEW_IMAGE_FORMATS),
  pageCount: z.number().int().positive().optional(),
  truncated: z.boolean().optional(),
  pages: z.array(artifactPreviewImagePageSchema)
});

export const artifactPreviewFailedResponseSchema = z.object({
  status: z.literal("failed"),
  artifactId: z.string(),
  errorCode: z.string().optional(),
  retryable: z.boolean().optional()
});

export const artifactPreviewUnsupportedResponseSchema = z.object({
  status: z.literal("unsupported"),
  artifactId: z.string(),
  errorCode: z.string().optional()
});

export const artifactPreviewResponseSchema = z.discriminatedUnion("status", [
  artifactPreviewPendingResponseSchema,
  artifactPreviewReadyResponseSchema,
  artifactPreviewFailedResponseSchema,
  artifactPreviewUnsupportedResponseSchema
]);

export type ArtifactPreviewResponse = z.infer<typeof artifactPreviewResponseSchema>;

export const createConversationRequestSchema = z.object({
  /** A build starts privately even in a workspace with shared conversations by default. */
  visibility: z.literal("private").optional(),
  title: z.string().min(1).optional(),
  collaborationWorkspaceId: z.string().min(1).optional(),
  locale: localeCodeSchema.optional(),
  /**
   * The asset the conversation is about. The caller holds the read right on it; a subject the
   * caller may not read and one that does not exist are refused alike.
   */
  subject: conversationSubjectSchema.optional()
});

/**
 * The person makes an asset what their conversation is about, as going to the asset's page
 * after its agent opened it does. `toolCallId` names the agent's open the step answers, for
 * the audit; it is missing where the person took the step of their own accord.
 */
export const openConversationSubjectRequestSchema = conversationSubjectSchema.extend({
  toolCallId: z.string().min(1).max(200).optional()
});

export const renameConversationRequestSchema = z.object({
  title: z.string().trim().min(1).max(120)
});

/** How a call waits: for its own person's confirmation, or for another person's approval. */
export const toolDecisionModeSchema = z.enum(TOOL_DECISION_MODES);

export const agentRunStatusSchema = z.enum(AGENT_RUN_STATUSES);

export const agentRunErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  category: z.enum(AGENT_RUN_FAILURE_CATEGORIES),
  /** The tool a run waited on when it was ended for standing still: its name only. */
  tool: z.string().optional(),
  /**
   * The usage limit that refused the run's model call: its window, what it counts and whose
   * counter it is. A value this contract does not know is left out, so the reader says that
   * a limit was reached without naming it.
   */
  usageLimit: z
    .object({
      period: z.enum(MODEL_USAGE_LIMIT_PERIODS),
      metric: z.enum(MODEL_USAGE_LIMIT_METRICS),
      scope: z.enum(MODEL_USAGE_LIMIT_SCOPES)
    })
    .optional()
    .catch(undefined)
});

export const agentRuntimeEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("follow_up_changed"),
    runId: z.string(),
    sequence: z.number().int().positive(),
    createdAt: timestampSchema,
    followUp: z.lazy(() => conversationFollowUpSchema)
  }),
  z.object({
    type: z.literal("message_delta"),
    runId: z.string(),
    sequence: z.number(),
    createdAt: timestampSchema,
    delta: z.string()
  }),
  z.object({
    type: z.literal("reasoning_delta"),
    runId: z.string(),
    sequence: z.number(),
    createdAt: timestampSchema,
    id: z.string(),
    delta: z.string()
  }),
  z.object({
    type: z.literal("message_completed"),
    runId: z.string(),
    sequence: z.number(),
    createdAt: timestampSchema,
    message: z.object({
      id: z.string(),
      role: z.literal("assistant"),
      text: z.string(),
      metadata: z.record(z.string(), z.unknown()).optional()
    })
  }),
  z.object({
    type: z.literal("tool_call_preparing"),
    runId: z.string(),
    sequence: z.number(),
    createdAt: timestampSchema,
    toolCallId: z.string(),
    toolName: z.string()
  }),
  z.object({
    type: z.literal("tool_call_preparation_cancelled"),
    runId: z.string(),
    sequence: z.number(),
    createdAt: timestampSchema,
    toolCallId: z.string()
  }),
  z.object({
    type: z.literal("tool_call_started"),
    runId: z.string(),
    sequence: z.number(),
    createdAt: timestampSchema,
    toolCallId: z.string(),
    toolName: z.string(),
    input: z.unknown()
  }),
  z.object({
    type: z.literal("tool_decision_requested"),
    runId: z.string(),
    sequence: z.number(),
    createdAt: timestampSchema,
    toolCallId: z.string(),
    toolName: z.string(),
    operationRunId: z.string(),
    operationId: z.string(),
    mode: toolDecisionModeSchema,
    targetTitle: z.string().optional(),
    inputPreview: z.unknown(),
    simulation: z.unknown().optional(),
    expiresAt: timestampSchema
  }),
  z.object({
    type: z.literal("tool_decision_recorded"),
    runId: z.string(),
    sequence: z.number(),
    createdAt: timestampSchema,
    toolCallId: z.string(),
    operationRunId: z.string(),
    outcome: z.enum(TOOL_DECISION_OUTCOMES),
    decidedBy: z.string().optional(),
    reason: z.string().optional()
  }),
  z.object({
    type: z.literal("subagent_started"),
    runId: z.string(),
    sequence: z.number(),
    createdAt: timestampSchema,
    toolCallId: z.string(),
    subagentRunId: z.string(),
    threadId: z.string(),
    agent: z.string(),
    description: z.string()
  }),
  z.object({
    type: z.literal("tool_call_completed"),
    runId: z.string(),
    sequence: z.number(),
    createdAt: timestampSchema,
    toolCallId: z.string(),
    toolName: z.string(),
    result: z.unknown(),
    modelOutput: z.string(),
    projectionNotice: z.record(z.string(), z.unknown()).optional()
  }),
  z.object({
    type: z.literal("tool_call_failed"),
    runId: z.string(),
    sequence: z.number(),
    createdAt: timestampSchema,
    toolCallId: z.string(),
    toolName: z.string(),
    result: z.unknown(),
    modelOutput: z.string(),
    projectionNotice: z.record(z.string(), z.unknown()).optional()
  }),
  z.object({
    type: z.literal("run_completed"),
    runId: z.string(),
    sequence: z.number(),
    createdAt: timestampSchema
  }),
  z.object({
    type: z.literal("run_cancelled"),
    runId: z.string(),
    sequence: z.number(),
    createdAt: timestampSchema,
    reason: z.string().optional()
  }),
  z.object({
    type: z.literal("run_failed"),
    runId: z.string(),
    sequence: z.number(),
    createdAt: timestampSchema,
    error: agentRunErrorSchema
  })
]);

export const agentRunSchema = z.object({
  id: z.string(),
  clientInstanceId: z.string(),
  conversationId: z.string(),
  ownerUserId: z.string(),
  inputMessageId: z.string(),
  agentName: z.string(),
  status: agentRunStatusSchema,
  idempotencyKey: z.string().optional(),
  startedAt: timestampSchema,
  updatedAt: timestampSchema,
  completedAt: timestampSchema.optional(),
  cancelledAt: timestampSchema.optional(),
  failedAt: timestampSchema.optional(),
  lastSequence: z.number().int().nonnegative(),
  error: agentRunErrorSchema.optional(),
  correlationId: z.string(),
  leaseOwner: z.string().optional(),
  leaseExpiresAt: timestampSchema.optional(),
  heartbeatAt: timestampSchema.optional()
});

export const activeRunSummarySchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  ownerUserId: z.string().optional(),
  inputMessageId: z.string().optional(),
  agentName: z.string(),
  status: agentRunStatusSchema,
  startedAt: timestampSchema,
  updatedAt: timestampSchema,
  lastSequence: z.number().int().nonnegative()
});

/** On a `run_agent` call that started its subagent: the subagent, for its card. */
const toolCallSubagentSchema = z.object({
  runId: z.string(),
  threadId: z.string(),
  agent: z.string(),
  description: z.string()
});

/** While a call waits for a decision: what the person is asked to decide. */
const toolCallDecisionSchema = z.object({
  operationRunId: z.string(),
  operationId: z.string(),
  mode: toolDecisionModeSchema,
  targetTitle: z.string().optional(),
  inputPreview: z.unknown(),
  /** What the operation's own simulation answered, such as the mail `mail.send` would send. */
  simulation: z.unknown().optional(),
  expiresAt: timestampSchema
});

const agentRunProjectionToolCallStateSchema = z.enum(TOOL_CALL_STATES);

export const agentRunProjectionPartSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string()
  }),
  z.object({
    type: z.literal("reasoning"),
    id: z.string(),
    text: z.string(),
    open: z.boolean()
  }),
  z.object({
    type: z.literal("tool_call"),
    toolCallId: z.string(),
    toolName: z.string(),
    input: z.unknown().optional(),
    state: agentRunProjectionToolCallStateSchema,
    output: z.unknown().optional(),
    errorText: z.string().optional(),
    errorReason: z.literal("subject_conversation_shared").optional(),
    decision: toolCallDecisionSchema.optional(),
    subagent: toolCallSubagentSchema.optional()
  })
]);

export const agentRunProjectionSchema = z.object({
  runId: z.string(),
  ownerUserId: z.string().optional(),
  inputMessageId: z.string().optional(),
  lastSequence: z.number().int().nonnegative(),
  status: agentRunStatusSchema,
  durationMs: z.number().int().nonnegative().optional(),
  parts: z.array(agentRunProjectionPartSchema).default([]),
  text: z.string(),
  reasoning: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      open: z.boolean()
    })
  ),
  preparingTool: z
    .object({
      toolCallId: z.string(),
      toolName: z.string()
    })
    .optional(),
  activeToolCalls: z.array(
    z.object({
      toolCallId: z.string(),
      toolName: z.string(),
      input: z.unknown().optional(),
      state: agentRunProjectionToolCallStateSchema,
      output: z.unknown().optional(),
      errorText: z.string().optional(),
      errorReason: z.literal("subject_conversation_shared").optional(),
      decision: toolCallDecisionSchema.optional(),
      subagent: toolCallSubagentSchema.optional()
    })
  ),
  error: agentRunErrorSchema.optional()
});

export const runObservationSchema = z.object({
  clientInstanceId: z.string(),
  runId: z.string(),
  conversationId: z.string(),
  ownerUserId: z.string(),
  sequence: z.number().int().positive(),
  type: z.string(),
  payload: agentRuntimeEventSchema,
  createdAt: timestampSchema
});

const knownEventTypes: ReadonlySet<string> = new Set(
  agentRuntimeEventSchema.options.map((option) => option.shape.type.value)
);

/**
 * An observation of an event type this release does not know, which a newer server may send.
 * A client passes it over and keeps its sequence as its position.
 */
export const unknownRunObservationSchema = z.object({
  runId: z.string(),
  conversationId: z.string(),
  sequence: z.number().int().positive(),
  payload: z.object({ type: z.string().refine((type) => !knownEventTypes.has(type)) })
});

/** A subagent of a chat conversation's runs, for the Resources panel and its thread view. */
export const subagentSummarySchema = z.object({
  runId: z.string(),
  threadId: z.string(),
  parentRunId: z.string(),
  toolCallId: z.string(),
  agentName: z.string(),
  description: z.string(),
  status: agentRunStatusSchema,
  startedAt: timestampSchema,
  endedAt: timestampSchema.optional()
});

export const subagentListSchema = z.object({ items: z.array(subagentSummarySchema) });

export const conversationFollowUpSchema = z.object({
  id: z.string(),
  clientInstanceId: z.string(),
  conversationId: z.string(),
  authorUserId: z.string(),
  authorDisplayLabel: z.string().optional(),
  text: z.string(),
  mode: z.enum(FOLLOW_UP_MODES),
  status: z.enum(FOLLOW_UP_STATUSES),
  position: z.number().int().positive(),
  agentName: z.string(),
  modelBindingId: z.string().optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  idempotencyKey: z.string().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  dispatchedRunId: z.string().optional()
});

export const queuedConversationRunResponseSchema = z.object({
  followUp: conversationFollowUpSchema
});

export const startConversationRunRequestSchema = z.object({
  followUp: z
    .literal("queue")
    .optional()
    .describe(
      "Queue the message when this conversation has an active run. Without this option, an active run still returns CONFLICT."
    ),
  idempotencyKey: z.string().min(1),
  agentName: z.string().min(1).optional(),
  modelBindingId: z.string().min(1).optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  locale: localeCodeSchema.optional(),
  message: z.object({
    text: z.string().min(1)
  })
});

export const startConversationRunResponseSchema = z.object({
  conversation: conversationSchema,
  userMessage: messageSchema,
  run: agentRunSchema,
  thread: z.lazy(() => conversationThreadSnapshotSchema),
  eventsUrl: z.string()
});

export const createConversationRunRequestSchema = startConversationRunRequestSchema.extend({
  conversation: createConversationRequestSchema.optional()
});

// A decision on a waiting call is `operations.decide`, keyed by the call's Operation Run.
export const runCommandSchema = z.object({
  type: z.literal("continue")
});

export const runCommandRequestSchema = z.object({
  command: runCommandSchema
});

export const runCommandResponseSchema = z.object({
  run: agentRunSchema
});

export const conversationListItemSchema = conversationSchema.extend({
  latestMessageAt: timestampSchema.optional(),
  activeRun: activeRunSummarySchema.optional(),
  unread: z.boolean().optional(),
  lastViewedAt: timestampSchema.optional()
});

export const conversationUserStateSchema = z.object({
  clientInstanceId: z.string(),
  conversationId: z.string(),
  userId: z.string(),
  lastViewedAt: timestampSchema.optional(),
  lastReadMessageId: z.string().optional(),
  lastReadRunId: z.string().optional(),
  lastReadRunSequence: z.number().int().nonnegative().optional(),
  updatedAt: timestampSchema
});

export const conversationThreadSnapshotSchema = z.object({
  followUps: z.array(conversationFollowUpSchema).optional(),
  conversation: conversationSchema,
  messages: z.array(messageSchema),
  completedRunProjections: z.record(z.string(), agentRunProjectionSchema).optional(),
  activeRun: z
    .object({
      run: activeRunSummarySchema,
      projection: agentRunProjectionSchema
    })
    .optional(),
  /**
   * What the conversation's latest run was asked to use. Absent before the first run; a run that
   * followed the configured defaults leaves both fields out.
   */
  modelSelection: z
    .object({
      modelBindingId: z.string().min(1).optional(),
      reasoningEffort: reasoningEffortSchema.optional()
    })
    .optional(),
  userState: conversationUserStateSchema,
  serverTime: timestampSchema
});

export const cancelRunRequestSchema = z
  .object({
    reason: z.string().min(1).optional()
  })
  .optional()
  .default({});

export const cancelRunResponseSchema = z.object({
  run: agentRunSchema
});

export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationVisibility = z.infer<typeof conversationVisibilitySchema>;
export type ConversationListItem = z.infer<typeof conversationListItemSchema>;
export type RenameConversationRequest = z.infer<typeof renameConversationRequestSchema>;
export type OpenConversationSubjectRequest = z.infer<typeof openConversationSubjectRequestSchema>;
export type Message = z.infer<typeof messageSchema>;
export type MessageMetadata = z.infer<typeof messageMetadataSchema>;
export type ConversationResourceBase = z.infer<typeof conversationResourceBaseSchema>;
export type ConversationResourceListItem = z.infer<typeof conversationResourceListItemSchema>;
export type ConversationResourceListResponse = z.infer<
  typeof conversationResourceListResponseSchema
>;
export type AgentRuntimeMessageMetadata = z.infer<typeof agentRuntimeMessageMetadataSchema>;
export type UserMessageMetadata = z.infer<typeof userMessageMetadataSchema>;
export type AssistantToolCallsMessageMetadata = z.infer<
  typeof assistantToolCallsMessageMetadataSchema
>;
export type AssistantFinalMessageMetadata = z.infer<typeof assistantFinalMessageMetadataSchema>;
export type ToolResultMessageMetadata = z.infer<typeof toolResultMessageMetadataSchema>;
export type AgentRuntimeEvent = z.infer<typeof agentRuntimeEventSchema>;
export type AgentRun = z.infer<typeof agentRunSchema>;
export type ActiveRunSummary = z.infer<typeof activeRunSummarySchema>;
export type AgentRunProjection = z.infer<typeof agentRunProjectionSchema>;
export type RunObservation = z.infer<typeof runObservationSchema>;
export type StartConversationRunRequest = z.infer<typeof startConversationRunRequestSchema>;
export type StartConversationRunResponse = z.infer<typeof startConversationRunResponseSchema>;
export type CreateConversationRunRequest = z.infer<typeof createConversationRunRequestSchema>;
export type RunCommand = z.infer<typeof runCommandSchema>;
export type RunCommandRequest = z.infer<typeof runCommandRequestSchema>;
export type RunCommandResponse = z.infer<typeof runCommandResponseSchema>;
export type ConversationUserState = z.infer<typeof conversationUserStateSchema>;
export type ConversationFollowUp = z.infer<typeof conversationFollowUpSchema>;
export type SubagentSummary = z.infer<typeof subagentSummarySchema>;

export type ConversationThreadSnapshot = z.infer<typeof conversationThreadSnapshotSchema>;
export type CancelRunRequest = z.infer<typeof cancelRunRequestSchema>;
export type CancelRunResponse = z.infer<typeof cancelRunResponseSchema>;
