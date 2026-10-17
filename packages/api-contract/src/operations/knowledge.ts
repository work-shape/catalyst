import {
  DATA_STORE_SCALAR_TYPES,
  KNOWLEDGE_BASE_STATUSES,
  KNOWLEDGE_DOCUMENT_FAILURE_CODES,
  KNOWLEDGE_DOCUMENT_STATES,
  KNOWLEDGE_DOCUMENT_WAIT_CODES,
  KNOWLEDGE_SEARCH_SIGNALS
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { defineRegisteredOperation, json } from "./define-operation";

// The routes to one Knowledge Base, each with its id in the path. A route is no operation of
// its own: its call runs as the Knowledge Base's operation `knowledge.<id>.<part>`, the one an
// agent's tool and a Workflow step call too, with that operation's right, policy, run and
// audit trail. The definition itself is written, published and read with `assets.*`.

const SCALAR_TYPES = DATA_STORE_SCALAR_TYPES;
const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const valueSchema = z.union([scalarSchema, z.array(scalarSchema)]);

const knowledgeQueryRequestSchema = z.strictObject({
  /** One read-only SELECT or WITH statement with positional placeholders. */
  sql: z.string().min(1),
  /** A bare value, or a value with the type it is bound as. Never part of the statement. */
  parameters: z
    .array(
      z.union([
        valueSchema,
        z.strictObject({
          type: z.enum(SCALAR_TYPES.flatMap((type) => [type, `${type}[]`] as const)),
          value: valueSchema
        })
      ])
    )
    .optional()
});

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

const knowledgeStateResponseSchema = z.object({
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
      /** `pending` until it is searchable, then `indexed`; `failed` with `failureCode`. */
      state: z.enum(KNOWLEDGE_DOCUMENT_STATES),
      failureCode: z.enum(KNOWLEDGE_DOCUMENT_FAILURE_CODES).optional(),
      /**
       * Why a `pending` document waits, where it waits for more than its turn: a usage limit
       * that refuses its embedding. It goes on by itself once the limit resets or is raised.
       */
      waitCode: z.enum(KNOWLEDGE_DOCUMENT_WAIT_CODES).optional(),
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
  nextCursor: z.string().optional()
});

const knowledgeRetryDocumentsRequestSchema = z.strictObject({
  /** The documents to index again: failed ones, or pending ones whose indexing seems stuck. */
  documentIds: z.array(z.string().min(1)).min(1).max(100)
});

const knowledgeRetryDocumentsResponseSchema = z.object({
  /** Each named document in the Knowledge Base, with its state after the retry. */
  documents: z.array(z.object({ id: z.string(), state: z.enum(KNOWLEDGE_DOCUMENT_STATES) })),
  /** How many contents were queued to be indexed again. */
  queued: z.number().int()
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
  "knowledge_bases.retry_documents": defineRegisteredOperation({
    ...BASE,
    id: "knowledge_bases.retry_documents",
    method: "POST",
    path: "/api/v1/knowledge-bases/:knowledgeBase/documents/retry",
    summary:
      "Index documents of a Knowledge Base again: a failed one goes back to pending, and its content is queued",
    scope: "data_store_rows:write",
    effect: "changing",
    body: knowledgeRetryDocumentsRequestSchema,
    response: json(knowledgeRetryDocumentsResponseSchema),
    errors: ["NOT_FOUND", "CONFLICT", "VALIDATION_FAILED", "TIMEOUT"],
    rateClass: "write"
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
