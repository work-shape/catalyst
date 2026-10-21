import { knowledgeWorkflowSourceSchema } from "./knowledge-write";
import { z } from "zod";
import {
  KNOWLEDGE_DOCUMENT_FAILURE_CODES,
  KNOWLEDGE_DOCUMENT_STATES,
  KNOWLEDGE_SOURCE_FAILURE_CODES,
  KNOWLEDGE_SOURCE_ITEM_FAILURE_CODES,
  KNOWLEDGE_SYNC_MODES,
  KNOWLEDGE_SYNC_RUN_STATES,
  type KnowledgeSyncCount
} from "./contract-values";
const sourceIdSchema = z.union([
  z
    .string()
    .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u)
    .max(63),
  knowledgeWorkflowSourceSchema.shape.id.regex(/^workflow:[a-z][a-z0-9_-]{0,62}$/u)
]);
const countSchema = z.number().int().min(0);
/** What a sync run counts (`KNOWLEDGE_SYNC_COUNTS`). */
const countsSchema = z.strictObject({
  discovered: countSchema,
  added: countSchema,
  changed: countSchema,
  moved: countSchema,
  withdrawn: countSchema,
  failed: countSchema,
  skipped: countSchema
}) satisfies z.ZodType<Record<KnowledgeSyncCount, number>>;

export const knowledgeSyncInputSchema = z.strictObject({
  /** The `id` of the source in the definition. */
  source: sourceIdSchema,
  /** `changes` unless `full`. The initial import is started by publish, not by this call. */
  mode: z.enum(["changes", "full"]).optional()
});

export type KnowledgeSyncInput = z.infer<typeof knowledgeSyncInputSchema>;

/** What a sync run ends with: the result of its Operation Run, and a Workflow step's output. */
export const knowledgeSyncResultSchema = z.strictObject({
  syncRunId: z.string(),
  source: z.string(),
  mode: z.enum(KNOWLEDGE_SYNC_MODES),
  /** Why a run is of another mode than asked, such as a cursor the source refused. */
  reason: z.enum(["cursor_expired"]).optional(),
  state: z.enum(KNOWLEDGE_SYNC_RUN_STATES),
  counts: countsSchema,
  bytesFetched: z.number().int().min(0),
  /** Why the whole sync failed, for a run in state `failed`. */
  failureCode: z.enum(KNOWLEDGE_SOURCE_FAILURE_CODES).optional(),
  startedAt: z.string(),
  endedAt: z.string().optional()
});

export type KnowledgeSyncResult = z.infer<typeof knowledgeSyncResultSchema>;

/**
 * What the page shows of an item: its own state up to `fetched`, then its document's.
 * "Gefunden", "Geladen", "Durchsuchbar", "Fehlgeschlagen", "Entfernt".
 */
export const KNOWLEDGE_SOURCE_ITEM_SHOWN_STATES = [
  "discovered",
  "fetched",
  "indexed",
  "failed",
  "withdrawn"
] as const;

export type KnowledgeSourceItemShownState = (typeof KNOWLEDGE_SOURCE_ITEM_SHOWN_STATES)[number];

/** A failure of an item, from the source's side or its document's. */
const itemFailureCodeSchema = z.union([
  z.enum(KNOWLEDGE_SOURCE_ITEM_FAILURE_CODES),
  z.enum(KNOWLEDGE_DOCUMENT_FAILURE_CODES)
]);

const sourceStatusSchema = z.strictObject({
  id: z.string(),
  /** The name of the Connection it reads through. */
  connection: z.string(),
  kind: z.literal("connector").optional(),
  /** Items by the state the page shows. */
  items: z.strictObject({
    discovered: countSchema,
    fetched: countSchema,
    indexed: countSchema,
    failed: countSchema,
    withdrawn: countSchema
  }) satisfies z.ZodType<Record<KnowledgeSourceItemShownState, number>>,
  /** Failed items per code. */
  failures: z.array(z.strictObject({ code: itemFailureCodeSchema, count: countSchema })),
  /** The sync that runs now, with its rate in items per minute and its estimated end. */
  running: z
    .strictObject({
      syncRunId: z.string(),
      mode: z.enum(KNOWLEDGE_SYNC_MODES),
      startedAt: z.string(),
      itemsPerMinute: z.number().min(0).optional(),
      estimatedEndAt: z.string().optional()
    })
    .optional(),
  /** The last sync that ended. */
  last: knowledgeSyncResultSchema.optional(),
  /** "Letzte Änderung verarbeitet". */
  lastChangeAt: z.string().optional(),
  /** "Älteste offene Änderung". */
  oldestOpenChangeAt: z.string().optional()
});

export const knowledgeSourcesOutputSchema = z.strictObject({
  sources: z.array(
    z.union([
      sourceStatusSchema,
      knowledgeWorkflowSourceSchema.safeExtend(
        sourceStatusSchema.omit({ id: true, connection: true, kind: true }).shape
      )
    ])
  )
});

export type KnowledgeSourcesOutput = z.infer<typeof knowledgeSourcesOutputSchema>;

export const knowledgeSourceItemsInputSchema = z.strictObject({
  source: sourceIdSchema,
  state: z.enum(KNOWLEDGE_SOURCE_ITEM_SHOWN_STATES).optional(),
  failureCode: itemFailureCodeSchema.optional(),
  /** Items per page: 50 by default, at most 200. */
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).max(1_000).optional()
});

export type KnowledgeSourceItemsInput = z.infer<typeof knowledgeSourceItemsInputSchema>;

export const knowledgeSourceItemsOutputSchema = z.strictObject({
  /** Newest change first. */
  items: z.array(
    z.strictObject({
      /** The row in `source_items`: what `retry` and `locate` name. */
      id: z.string(),
      /** The id of the item at the source. */
      itemId: z.string(),
      name: z.string(),
      path: z.string(),
      state: z.enum(KNOWLEDGE_SOURCE_ITEM_SHOWN_STATES),
      failureCode: itemFailureCodeSchema.optional(),
      documentId: z.string().optional(),
      originLink: z.string().optional(),
      changedAt: z.string()
    })
  ),
  nextCursor: z.string().optional()
});

export type KnowledgeSourceItemsOutput = z.infer<typeof knowledgeSourceItemsOutputSchema>;

/** How many documents or items one retry names at most. */
const RETRY_MAX = 100;

/**
 * KB-5c's retry, widened: documents by id, or items of a source by id, by failure code or all
 * failed ones. A failed fetch is fetched again; a failed document of a synced source is
 * fetched and indexed again, because its original is not kept.
 */
export const knowledgeRetryInputSchema = z.union([
  z.strictObject({ documentIds: z.array(z.string().min(1).max(200)).min(1).max(RETRY_MAX) }),
  z.strictObject({
    source: sourceIdSchema,
    sourceItemIds: z.array(z.string().min(1).max(200)).min(1).max(RETRY_MAX)
  }),
  z.strictObject({ source: sourceIdSchema, failureCode: itemFailureCodeSchema }),
  z.strictObject({ source: sourceIdSchema, all: z.literal(true) })
]);

export type KnowledgeRetryInput = z.infer<typeof knowledgeRetryInputSchema>;

export const knowledgeRetryOutputSchema = z.strictObject({
  /** For a retry by document ids: each named document, with its state after the retry. */
  documents: z
    .array(z.strictObject({ id: z.string(), state: z.enum(KNOWLEDGE_DOCUMENT_STATES) }))
    .optional(),
  /** How many contents or items were queued again. */
  queued: z.number().int()
});

export type KnowledgeRetryOutput = z.infer<typeof knowledgeRetryOutputSchema>;

export const knowledgeLocateInputSchema = z.strictObject({
  /** The row in `source_items`. */
  sourceItemId: z.string().min(1).max(200)
});

export type KnowledgeLocateInput = z.infer<typeof knowledgeLocateInputSchema>;

/** An item's state and times, and no content, name or path. */
export const knowledgeLocateOutputSchema = z.strictObject({
  sourceItemId: z.string(),
  source: z.string(),
  itemId: z.string(),
  state: z.enum(KNOWLEDGE_SOURCE_ITEM_SHOWN_STATES),
  discoveredAt: z.string(),
  fetchedAt: z.string().optional(),
  withdrawnAt: z.string().optional(),
  purgedAt: z.string().optional()
});

export type KnowledgeLocateOutput = z.infer<typeof knowledgeLocateOutputSchema>;
