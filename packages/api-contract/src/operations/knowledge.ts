import {
  DATA_STORE_SCALAR_TYPES,
  KNOWLEDGE_BASE_STATUSES
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
  })
};
