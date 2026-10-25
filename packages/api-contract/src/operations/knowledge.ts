import { workflowDataFlowsSchema } from "@work-shape/catalyst-asset-schemas";
import {
  knowledgeSyncInputSchema,
  knowledgeSyncResultSchema,
  knowledgeSourcesOutputSchema,
  knowledgeSourceItemsInputSchema,
  knowledgeSourceItemsOutputSchema,
  knowledgeLocateInputSchema,
  knowledgeLocateOutputSchema,
  knowledgeExtractFieldsInputSchema,
  knowledgeExtractFieldsOutputSchema,
  knowledgeRetryInputSchema,
  knowledgeRetryOutputSchema,
  knowledgeWorkflowSourcesOutputSchema
} from "@work-shape/catalyst-asset-schemas";
import {
  DATA_STORE_SCALAR_TYPES,
  MANAGED_FILE_STATUSES,
  KNOWLEDGE_BASE_STATUSES,
  KNOWLEDGE_EMBEDDING_STATES,
  KNOWLEDGE_DOCUMENT_FAILURE_CODES,
  KNOWLEDGE_DOCUMENT_STATES,
  KNOWLEDGE_DOCUMENT_WAIT_CODES,
  KNOWLEDGE_SEARCH_SIGNALS
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { defineRegisteredOperation, json, blob } from "./define-operation";

// The routes to one Knowledge Base, each with its id in the path. A route is no operation of
// its own: its call runs as the Knowledge Base's operation `knowledge.<id>.<part>`, the one an
// agent's tool and a Workflow step call too, with that operation's right, policy, run and
// audit trail. The definition itself is written, published and read with `assets.*`.

const SCALAR_TYPES = DATA_STORE_SCALAR_TYPES;
const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const valueSchema = z.union([scalarSchema, z.array(scalarSchema)]);

/**
 * A cited document is opened from a conversation: its workspace is where the reader may use the
 * Knowledge Base through its availability. The reader must be able to open that conversation.
 */
const knowledgeOpenDocumentQuerySchema = z.object({
  conversationId: z.string().min(1).optional()
});

const knowledgeQueryRequestSchema = z
  .strictObject({
    sql: z.string().min(1).max(20000).optional(),
    query: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,62}$/u)
      .optional(),
    parameters: z
      .union([
        z
          .array(
            z.union([
              valueSchema,
              z.strictObject({
                type: z.enum(SCALAR_TYPES.flatMap((type) => [type, `${type}[]`] as const)),
                value: valueSchema
              })
            ])
          )
          .max(100),
        z.record(z.string(), valueSchema)
      ])
      .optional()
  })
  .refine(
    (input) => (input.sql === undefined) !== (input.query === undefined),
    "Give either sql or a named query"
  );

const knowledgeQueryResponseSchema = z.object({
  /** `type` is the product's name of the type, `nativeType` the database's. */
  columns: z.array(z.object({ name: z.string(), type: z.string(), nativeType: z.string() })),
  rows: z.array(z.record(z.string(), z.unknown())),
  /** Whether a cap ended the result before its last row. */
  truncated: z.boolean(),
  /** What a citation names: the Knowledge Base and the tables it describes. */
  source: z.object({
    knowledgeBase: z.string(),
    title: z.string(),
    tables: z.array(z.string())
  })
});

/** An approved embedding model as a Knowledge Base's index uses it. */
export interface KnowledgeEmbeddingModelState {
  /** The approved embedding binding. */
  bindingId: string;
  model: string;
  dimensions: number;
}

/** The embedding of a Knowledge Base that searches by meaning in the built-in store. */
export interface KnowledgeEmbeddingStateResponse {
  /**
   * `current`: search answers by meaning with the model the Knowledge Base is set to.
   * `reindex_needed`: the model of its index is no longer approved, so search answers by words
   * and titles alone until it is re-indexed. `reindex_available`: it is set to another model
   * than its index uses. `reindexing`: a new index is being built beside the one search reads.
   * `none`: nothing is embedded yet.
   */
  state: (typeof KNOWLEDGE_EMBEDDING_STATES)[number];
  /** The model search answers from. */
  active?: KnowledgeEmbeddingModelState | undefined;
  /** The approved model the Knowledge Base is set to. */
  target?: KnowledgeEmbeddingModelState | undefined;
  /** While re-indexing: the passages embedded of all it embeds. */
  progress?: { embedded: number; total: number } | undefined;
}

/** What `knowledge_bases.reindex` answers. */
export interface KnowledgeReindexResponse extends KnowledgeEmbeddingStateResponse {
  /** Whether this call started a re-index. */
  started: boolean;
  /** What a re-index embeds and costs; returned where one would start or did. */
  statement?:
    | {
        bindingId: string;
        model: string;
        /** The passages it embeds. */
        chunks: number;
        /** The tokens it embeds, estimated. */
        tokens: number;
        /** At the rate release config sets for the binding; omitted where it sets none. */
        cost?: { amount: number; currency: string } | undefined;
        /** Whether the store has room for the second index beside the first. */
        room: boolean;
        storeBytes: number;
        addedBytes: number;
        limitBytes?: number | undefined;
        /** Pass as `confirm` to start it. */
        confirmation: string;
      }
    | undefined;
  /** The statement as sentences, in the instance's language. */
  lines?: string[] | undefined;
}

// Typed by name, so the published declarations of every operation stay within what the
// compiler serializes.
const knowledgeEmbeddingModelSchema = z.object({
  bindingId: z.string(),
  model: z.string(),
  dimensions: z.number().int()
});

const knowledgeEmbeddingStateObject = z.object({
  state: z.enum(KNOWLEDGE_EMBEDDING_STATES),
  active: knowledgeEmbeddingModelSchema.optional(),
  target: knowledgeEmbeddingModelSchema.optional(),
  progress: z.object({ embedded: z.number().int(), total: z.number().int() }).optional()
});

const knowledgeEmbeddingStateSchema: z.ZodType<KnowledgeEmbeddingStateResponse> =
  knowledgeEmbeddingStateObject;

const knowledgeReindexResponseSchema: z.ZodType<KnowledgeReindexResponse> =
  knowledgeEmbeddingStateObject.extend({
    started: z.boolean(),
    statement: z
      .object({
        bindingId: z.string(),
        model: z.string(),
        chunks: z.number().int(),
        tokens: z.number().int(),
        cost: z.object({ amount: z.number(), currency: z.string() }).optional(),
        room: z.boolean(),
        storeBytes: z.number(),
        addedBytes: z.number(),
        limitBytes: z.number().optional(),
        confirmation: z.string()
      })
      .optional(),
    lines: z.array(z.string()).optional()
  });

const knowledgeStateResponseSchema = z.object({
  /** Published agents using this Knowledge Base that the caller may read. */
  agents: z.array(z.object({ name: z.string(), title: z.string() })).optional(),
  agentsTruncated: z.boolean().optional(),
  dataFlows: workflowDataFlowsSchema.optional(),
  /** Due ingestion has no reporting worker. Omitted for a structured Knowledge Base. */
  processingWaiting: z.boolean().optional(),
  /** The embedding of a Knowledge Base that searches by meaning in the built-in store. */
  embedding: knowledgeEmbeddingStateSchema.optional(),
  /**
   * The formats this instance reads into a Knowledge Base that keeps documents: `txt` and
   * `markdown`, with document processing also `pdf` and `docx`. Omitted for a structured one.
   */
  documentFormats: z.array(z.string()).optional(),
  /** The id of the Knowledge Base's asset. */
  id: z.string(),
  /** The id operations and routes name the Knowledge Base by. */
  name: z.string(),
  /** `unchecked` until the published revision was first checked. */
  status: z.enum(KNOWLEDGE_BASE_STATUSES),
  /** The revision the last check was of. */
  revision: z.number().int().optional(),
  checkedAt: z.string().optional(),
  /** Each described table, and whether the last check could read it. */
  tables: z.array(z.object({ name: z.string(), readable: z.boolean() })),
  /** Why the backend could not be asked at all, as a sentence. */
  problem: z.string().optional()
});

const knowledgeAddFilesRequestSchema = z.strictObject({
  /** Files the caller can open: each a file of a Conversation they may read. */
  files: z
    .array(z.strictObject({ conversationId: z.string().min(1), fileId: z.string().min(1) }))
    .min(1)
});

const knowledgeAddFilesResponseSchema = z.object({
  /** Each document added, and the copy of its file the Knowledge Base now owns. In input order. */
  documents: z.array(z.object({ id: z.string(), fileId: z.string() })),
  count: z.number().int(),
  bytes: z.number().int()
});

const knowledgeListDocumentsQuerySchema = z.object({
  /** Documents per page: 50 by default, at most 200. */
  limit: z.coerce.number().int().min(1).max(200).optional(),
  /** The `nextCursor` of the page before. */
  cursor: z.string().min(1).max(1_000).optional()
});

const knowledgeListDocumentsResponseSchema = z.object({
  /** The documents not removed, newest first. */
  documents: z.array(
    z.object({
      id: z.string(),
      /** The copy of the file the Knowledge Base owns. */
      fileId: z.string(),
      fileName: z.string(),
      title: z.string(),
      /** `txt`, `markdown`, `pdf` or `docx`. */
      format: z.string(),
      /** The size of the file in bytes. */
      bytes: z.number().int(),
      /** Released originals remain at the source; file metadata and extracted text stay here. */
      originalStatus: z.enum(MANAGED_FILE_STATUSES).exclude(["deleted"]).optional(),
      /** `pending` until it is searchable, then `indexed`; `failed` with `failureCode`. */
      state: z.enum(KNOWLEDGE_DOCUMENT_STATES),
      failureCode: z.enum(KNOWLEDGE_DOCUMENT_FAILURE_CODES).optional(),
      /** Current configured page limit when `failureCode` is `knowledge_file_too_many_pages`. */
      failurePageLimit: z.number().int().positive().optional(),
      /** Detected pages when conversion took too long. */
      failurePageCount: z.number().int().positive().optional(),
      /**
       * Why a `pending` document waits, where it waits for more than its turn: a usage limit
       * that refuses its embedding. It goes on by itself once the limit resets or is raised.
       */
      waitCode: z.enum(KNOWLEDGE_DOCUMENT_WAIT_CODES).optional(),
      /**
       * Field extraction paused at the Knowledge Base's budget before it reached this document.
       * The document stays searchable; its fields follow once the budget resets or is raised.
       */
      fieldsPending: z.boolean().optional(),
      fieldsPendingReason: z
        .discriminatedUnion("reason", [
          z.object({ reason: z.literal("monthly_budget") }),
          z.object({
            reason: z.literal("token_budget"),
            estimatedTokens: z.number(),
            reservedOutputTokens: z.number(),
            maxTokensPerDocument: z.number()
          })
        ])
        .optional(),
      /**
       * The source the document was synced from. Source withdrawal removes it; a manual
       * remove is refused with `knowledge_synced_document_remove_refused`.
       */
      sourceId: z.string().optional(),
      addedAt: z.string(),
      /** When its state last changed. */
      updatedAt: z.string()
    })
  ),
  /** Present while more documents follow. */
  nextCursor: z.string().optional(),
  /** Retained document totals and ingestion state, returned on the first page. */
  summary: z
    .object({
      count: z.number().int(),
      state: z.enum(KNOWLEDGE_DOCUMENT_STATES),
      lastIngestedAt: z.string().optional()
    })
    .optional()
});

const knowledgeSearchRequestSchema = z.strictObject({
  /** Words or a question. Quoted words are a phrase, and a word after `-` is left out. */
  query: z.string().trim().min(1).max(1_000),
  /** Passages to answer at most: 20 by default, at most 50. */
  limit: z.number().int().min(1).max(50).optional()
});

const knowledgeSearchResponseSchema = z.object({
  /** The passages that answer the query best, best first. */
  passages: z.array(
    z.object({
      /** `K1`, `K2` and so on, in the order of the answer. */
      ref: z.string(),
      knowledgeBase: z.string(),
      documentId: z.string(),
      /** The copy of the file the Knowledge Base owns. */
      fileId: z.string(),
      fileName: z.string(),
      title: z.string(),
      /** The page, from 1. None for a text file. */
      page: z.number().int().optional(),
      heading: z.string().optional(),
      text: z.string(),
      /** Reciprocal rank fusion of the lists in `signals`: compare it only within one Knowledge Base. */
      score: z.number(),
      originLink: z.string().optional()
    })
  ),
  /** The ranked lists fused: `semantic`, `keyword` and `title`. */
  signals: z.array(z.enum(KNOWLEDGE_SEARCH_SIGNALS))
});

const BASE = {
  tag: "Knowledge Bases",
  auth: "principal",
  requires: [],
  errors: ["NOT_FOUND", "CONFLICT", "TIMEOUT"]
} as const;

// None names its right in `requires`: the right is the Knowledge Base operation's.
export const knowledgeOperations = {
  "knowledge_bases.open_document": defineRegisteredOperation({
    id: "knowledge_bases.open_document",
    method: "GET",
    path: "/api/v1/knowledge-bases/:knowledgeBase/documents/:documentId/content",
    summary:
      "Open an original source document with knowledge_base.use; a cited document is opened in the context of its conversation's workspace; removed documents are unavailable",
    tag: "Knowledge Bases",
    auth: "user",
    scope: "data_store_rows:read",
    // The route checks knowledge_base.use itself, in the workspace of the citing conversation.
    requires: [],
    effect: "reading",
    query: knowledgeOpenDocumentQuerySchema,
    response: blob(),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "knowledge_bases.workflow_sources": defineRegisteredOperation({
    id: "knowledge_bases.workflow_sources",
    method: "GET",
    path: "/api/v1/workflows/:workflow/knowledge-sources",
    summary:
      "Read what deleting a Workflow ends: the Knowledge Bases its sources feed and how many documents each holds there; ones the caller may not open are only counted",
    tag: "Knowledge Bases",
    auth: "user",
    scope: "config_assets:read",
    // The route checks workflow.delete on the Workflow, and knowledge_base.use per Knowledge Base.
    requires: [],
    effect: "reading",
    response: json(knowledgeWorkflowSourcesOutputSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "knowledge_bases.sync": defineRegisteredOperation({
    ...BASE,
    id: "knowledge_bases.sync",
    method: "POST",
    path: "/api/v1/knowledge-bases/:knowledgeBase/sync",
    summary:
      "Start a full source sync and return its Operation Run immediately; concurrent starts join the running sync",
    scope: "config_assets:write",
    effect: "changing",
    body: knowledgeSyncInputSchema,
    response: json(knowledgeSyncResultSchema),
    rateClass: "write"
  }),
  "knowledge_bases.sources": defineRegisteredOperation({
    ...BASE,
    id: "knowledge_bases.sources",
    method: "GET",
    path: "/api/v1/knowledge-bases/:knowledgeBase/sources",
    summary: "Read source states, counts, failure codes and sync progress",
    scope: "config_assets:read",
    effect: "reading",
    response: json(knowledgeSourcesOutputSchema),
    rateClass: "read"
  }),
  "knowledge_bases.source_items": defineRegisteredOperation({
    ...BASE,
    id: "knowledge_bases.source_items",
    method: "GET",
    path: "/api/v1/knowledge-bases/:knowledgeBase/sources/:source/items",
    summary:
      "Page through the items of a source, newest change first; filter by state or failure code",
    scope: "config_assets:read",
    effect: "reading",
    query: knowledgeSourceItemsInputSchema.omit({ source: true }),
    response: json(knowledgeSourceItemsOutputSchema),
    rateClass: "read"
  }),
  "knowledge_bases.locate": defineRegisteredOperation({
    ...BASE,
    id: "knowledge_bases.locate",
    method: "GET",
    path: "/api/v1/knowledge-bases/:knowledgeBase/locate",
    summary:
      "Locate a source item for erasure: state and lifecycle times without content, file name or path",
    scope: "config_assets:read",
    effect: "reading",
    query: knowledgeLocateInputSchema,
    response: json(knowledgeLocateOutputSchema),
    rateClass: "read"
  }),
  "knowledge_bases.get": defineRegisteredOperation({
    ...BASE,
    id: "knowledge_bases.get",
    method: "GET",
    path: "/api/v1/knowledge-bases/:knowledgeBase",
    summary:
      "Read the state of one published Knowledge Base: whether its last check could read every table it describes",
    scope: "config_assets:read",
    effect: "reading",
    response: json(knowledgeStateResponseSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "knowledge_bases.check": defineRegisteredOperation({
    ...BASE,
    id: "knowledge_bases.check",
    method: "POST",
    path: "/api/v1/knowledge-bases/:knowledgeBase/check",
    summary:
      "Check one published Knowledge Base now: whether every table it describes can be read. It reads no row",
    scope: "config_assets:write",
    effect: "changing",
    response: json(knowledgeStateResponseSchema),
    rateClass: "write"
  }),
  "knowledge_bases.query": defineRegisteredOperation({
    ...BASE,
    id: "knowledge_bases.query",
    method: "POST",
    path: "/api/v1/knowledge-bases/:knowledgeBase/query",
    summary:
      "Read rows of one published Knowledge Base with one read-only statement and bound parameters",
    scope: "data_store_rows:read",
    effect: "reading",
    body: knowledgeQueryRequestSchema,
    response: json(knowledgeQueryResponseSchema),
    rateClass: "read"
  }),
  "knowledge_bases.add_files": defineRegisteredOperation({
    ...BASE,
    id: "knowledge_bases.add_files",
    method: "POST",
    path: "/api/v1/knowledge-bases/:knowledgeBase/files",
    summary:
      "Add files the caller can open to a Knowledge Base that keeps documents. Each is copied into a file the Knowledge Base owns",
    scope: "data_store_rows:write",
    effect: "changing",
    body: knowledgeAddFilesRequestSchema,
    response: json(knowledgeAddFilesResponseSchema),
    errors: ["NOT_FOUND", "CONFLICT", "VALIDATION_FAILED", "TIMEOUT"],
    rateClass: "write"
  }),
  "knowledge_bases.upload_file": defineRegisteredOperation({
    ...BASE,
    id: "knowledge_bases.upload_file",
    method: "POST",
    path: "/api/v1/knowledge-bases/:knowledgeBase/uploads",
    summary:
      "Upload one file from the caller's device to a Knowledge Base that keeps documents. It runs as the Knowledge Base's add_files and keeps the file as a copy the Knowledge Base owns",
    scope: "data_store_rows:write",
    effect: "changing",
    multipart: true,
    response: json(knowledgeAddFilesResponseSchema),
    errors: ["NOT_FOUND", "CONFLICT", "VALIDATION_FAILED", "TIMEOUT"],
    rateClass: "write"
  }),
  "knowledge_bases.list_documents": defineRegisteredOperation({
    ...BASE,
    id: "knowledge_bases.list_documents",
    method: "GET",
    path: "/api/v1/knowledge-bases/:knowledgeBase/documents",
    summary:
      "List the documents of a Knowledge Base that keeps documents, newest first, each with its state and the failure code of a failed one",
    scope: "data_store_rows:read",
    effect: "reading",
    query: knowledgeListDocumentsQuerySchema,
    response: json(knowledgeListDocumentsResponseSchema),
    errors: ["NOT_FOUND", "CONFLICT", "VALIDATION_FAILED", "TIMEOUT"],
    rateClass: "read"
  }),
  "knowledge_bases.remove_documents": defineRegisteredOperation({
    ...BASE,
    id: "knowledge_bases.remove_documents",
    method: "POST",
    path: "/api/v1/knowledge-bases/:knowledgeBase/documents/remove",
    summary:
      "Remove documents from search immediately and queue deletion of their unshared content and files",
    scope: "data_store_rows:write",
    effect: "changing",
    body: z.strictObject({ documentIds: z.array(z.string().min(1).max(200)).min(1).max(100) }),
    response: json(z.object({ removed: z.number().int() })),
    errors: ["NOT_FOUND", "CONFLICT", "VALIDATION_FAILED", "TIMEOUT"],
    rateClass: "write"
  }),
  "knowledge_bases.reindex": defineRegisteredOperation({
    ...BASE,
    id: "knowledge_bases.reindex",
    method: "POST",
    path: "/api/v1/knowledge-bases/:knowledgeBase/reindex",
    summary:
      "Re-index a Knowledge Base with the embedding model it is set to. Without confirm it states the passages, tokens and cost and starts nothing; with the statement's confirmation it builds a new index beside the one search reads and switches when it is complete",
    scope: "config_assets:write",
    effect: "changing",
    body: z.strictObject({ confirm: z.string().trim().min(1).max(64).optional() }),
    response: json(knowledgeReindexResponseSchema),
    errors: ["NOT_FOUND", "CONFLICT", "VALIDATION_FAILED", "TIMEOUT"],
    rateClass: "write"
  }),
  "knowledge_bases.retry_documents": defineRegisteredOperation({
    ...BASE,
    id: "knowledge_bases.retry_documents",
    method: "POST",
    path: "/api/v1/knowledge-bases/:knowledgeBase/documents/retry",
    summary:
      "Index documents of a Knowledge Base again: a failed one goes back to pending, and its content is queued",
    scope: "config_assets:write",
    effect: "changing",
    body: knowledgeRetryInputSchema,
    response: json(knowledgeRetryOutputSchema),
    errors: ["NOT_FOUND", "CONFLICT", "VALIDATION_FAILED", "TIMEOUT"],
    rateClass: "write"
  }),
  "knowledge_bases.extract_fields": defineRegisteredOperation({
    ...BASE,
    id: "knowledge_bases.extract_fields",
    method: "POST",
    path: "/api/v1/knowledge-bases/:knowledgeBase/extract-fields",
    summary:
      "Extract declared fields with page and quote evidence through the approved model binding, within this Knowledge Base's extraction budget. Unsupported evidence is dropped and counted.",
    scope: "data_store_rows:read",
    effect: "reading",
    body: knowledgeExtractFieldsInputSchema,
    response: json(knowledgeExtractFieldsOutputSchema),
    errors: ["NOT_FOUND", "CONFLICT", "VALIDATION_FAILED", "TIMEOUT"],
    rateClass: "read"
  }),
  "knowledge_bases.search": defineRegisteredOperation({
    ...BASE,
    id: "knowledge_bases.search",
    method: "POST",
    path: "/api/v1/knowledge-bases/:knowledgeBase/search",
    summary:
      "Search the documents of a Knowledge Base: the passages that answer a query best, by meaning, by words and by title, with file and page",
    scope: "data_store_rows:read",
    effect: "reading",
    body: knowledgeSearchRequestSchema,
    response: json(knowledgeSearchResponseSchema),
    errors: ["NOT_FOUND", "CONFLICT", "VALIDATION_FAILED", "TIMEOUT"],
    rateClass: "read"
  })
};

// Contract only: routes and execution arrive with KBW-1 and PROC-W.
export { knowledgeWriteContracts } from "@work-shape/catalyst-asset-schemas";
