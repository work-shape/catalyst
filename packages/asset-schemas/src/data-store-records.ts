import { z } from "zod";
import { operationBatchResultSchema } from "./operation-batch";
import { knowledgeExtractFieldsOutputSchema } from "./knowledge-write";
import type { DATA_STORE_SCALAR_TYPES } from "./contract-values";

// REC-0: frozen contracts, no callable operations. Extraction's value/page/quote is
// knowledgeExtractFieldsOutputSchema (KBW-0); records adds the evidence result only.
// Per-call work bounds: callers split larger proposals into batches and follow flagged cursors.
// Exceeding one refuses the call with its named maximum; total stored capacity is unchanged.
export const RECORDS_PROPOSE_MAX_ITEMS_PER_CALL = 1_000;
export const RECORDS_PROPOSE_MAX_FIELDS_PER_ITEM = 1_000;
export const RECORDS_FLAGGED_MAX_ITEMS_PER_PAGE = 10_000;

const name = z.string().min(1);
const id = z.string().min(1).max(200);
const key = z.union([z.string().min(1), z.number(), z.boolean()]);

export const dataStoreRecordsRuleSchema = z
  .strictObject({
    table: name,
    key: z.union([
      z.strictObject({ column: name, fromPath: z.string().startsWith("/").min(1) }),
      z.strictObject({ column: name, fromField: name })
    ]),
    precedence: z.array(name).default([]),
    review: z.strictObject({ always: z.array(name).default([]) }).default({ always: [] }),
    retainWithoutSource: z.boolean().default(false)
  })
  .superRefine((rule, context) => {
    if ("fromPath" in rule.key) {
      const placeholders = rule.key.fromPath.match(/\{[^{}]*\}/gu);
      if (placeholders?.length !== 1 || placeholders[0] !== `{${rule.key.column}}`) {
        context.addIssue({
          code: "custom",
          path: ["key", "fromPath"],
          message: "fromPath must contain exactly one placeholder naming the key column"
        });
      }
    }
  });
export type DataStoreRecordsRule = z.infer<typeof dataStoreRecordsRuleSchema>;

/** A necessary condition, never a model confidence score or proof of correctness. */
export const recordEvidenceResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("passed") }),
  z.strictObject({
    status: z.literal("failed"),
    reason: z.enum(["page_not_found", "quote_not_found", "value_not_parsed"])
  })
]);
export type RecordEvidenceResult = z.infer<typeof recordEvidenceResultSchema>;

export const RECORD_FIELD_STATES = ["extracted", "confirmed", "corrected", "conflict"] as const;
export const RECORD_FIELD_FAILURE_CODES = ["record_field_unknown"] as const;

const fieldSchema = knowledgeExtractFieldsOutputSchema.shape.fields.valueType.extend({ name });
export const dataStoreRecordProposalItemSchema = z.strictObject({
  // Document ids are scoped by their Knowledge Base. Both ids travel with every citation.
  knowledgeBaseId: id,
  documentId: id,
  kind: name,
  documentDate: z.iso.date().nullable(),
  path: z.string().startsWith("/").optional(),
  fields: z
    .array(fieldSchema)
    .min(1)
    .max(
      RECORDS_PROPOSE_MAX_FIELDS_PER_ITEM,
      "At most 1000 fields per item (RECORDS_PROPOSE_MAX_FIELDS_PER_ITEM); split larger proposals into batches"
    )
});
export type DataStoreRecordProposalItem = z.infer<typeof dataStoreRecordProposalItemSchema>;
export const dataStoreRecordsProposeInputSchema = z.strictObject({
  table: name,
  items: z
    .array(dataStoreRecordProposalItemSchema)
    .max(
      RECORDS_PROPOSE_MAX_ITEMS_PER_CALL,
      "At most 1000 items per call (RECORDS_PROPOSE_MAX_ITEMS_PER_CALL); send another batch"
    )
});
export type DataStoreRecordsProposeInput = z.infer<typeof dataStoreRecordsProposeInputSchema>;

const decisionSchema = z.strictObject({
  table: name,
  key,
  field: name,
  documentId: id.optional(),
  knowledgeBaseId: id.optional()
});
export const dataStoreRecordsDecideInputSchema = z
  .discriminatedUnion("action", [
    decisionSchema.extend({ action: z.literal("confirm") }),
    decisionSchema.extend({ action: z.literal("correct"), value: z.json() }),
    decisionSchema.extend({ action: z.literal("assign"), documentId: id, knowledgeBaseId: id })
  ])
  .refine(
    (decision) => (decision.documentId === undefined) === (decision.knowledgeBaseId === undefined),
    {
      path: ["documentId"],
      message: "A citation needs both knowledgeBaseId and documentId"
    }
  );
export type DataStoreRecordsDecideInput = z.infer<typeof dataStoreRecordsDecideInputSchema>;
export const dataStoreRecordsDecideOutputSchema = z.strictObject({ decided: z.literal(true) });
export const dataStoreRecordsFlaggedInputSchema = z.strictObject({
  table: name.optional(),
  cursor: z.string().min(1).optional(),
  limit: z
    .number()
    .int()
    .positive()
    .max(
      RECORDS_FLAGGED_MAX_ITEMS_PER_PAGE,
      "At most 10000 items per page (RECORDS_FLAGGED_MAX_ITEMS_PER_PAGE); follow nextCursor"
    )
});
export const dataStoreRecordFieldSchema = fieldSchema.extend({
  table: name,
  // Unresolved keys go to review, without writing a customer row.
  key: key.nullable(),
  knowledgeBaseId: id,
  documentId: id,
  kind: name,
  documentDate: z.iso.date().nullable(),
  extractedAt: z.iso.datetime({ offset: true }),
  evidence: recordEvidenceResultSchema,
  state: z.enum(RECORD_FIELD_STATES),
  decidedBy: id.nullable(),
  decidedAt: z.iso.datetime({ offset: true }).nullable()
});
export type DataStoreRecordField = z.infer<typeof dataStoreRecordFieldSchema>;
export const dataStoreRecordsFlaggedOutputSchema = z.strictObject({
  // A citation is shown only after checking access to its Knowledge Base, even for a
  // holder of data_store.records. Values/quotes never enter jobs, runs or audit metadata.
  items: z
    .array(
      dataStoreRecordFieldSchema.extend({
        reason: z.enum(["conflict", "not_evidenced", "confirmation_required", "key_unresolved"])
      })
    )
    .max(RECORDS_FLAGGED_MAX_ITEMS_PER_PAGE),
  nextCursor: z.string().optional()
});

type ColumnType = (typeof DATA_STORE_SCALAR_TYPES)[number];
export interface RecordColumn {
  name: string;
  type: ColumnType | `${ColumnType}[]` | "other";
  nullable: boolean;
  generated?: boolean;
}
const scalarSchemas = {
  text: z.string(),
  integer: z.number().int(),
  number: z.number(),
  boolean: z.boolean(),
  date: z.iso.date(),
  timestamp: z.iso.datetime({ offset: true })
};
function compatible(column: RecordColumn, value: unknown): boolean {
  if (column.generated || column.type === "other") return false;
  if (value === null) return column.nullable;
  for (const [type, schema] of Object.entries(scalarSchemas)) {
    if (column.type === type) return schema.safeParse(value).success;
    if (column.type === `${type}[]`) return z.array(schema.nullable()).safeParse(value).success;
  }
  return false;
}

/**
 * Validate a whole item before any candidate or customer row is written. The batch writer
 * maps this refusal to record_field_unknown for that item and continues with other items.
 * Types come from the store catalog, never from the caller's extraction schema.
 */
function proposalItemSchemaFor(columns: readonly RecordColumn[]) {
  const byName = new Map(columns.map((column) => [column.name, column]));
  return dataStoreRecordProposalItemSchema.superRefine((item, context) => {
    const seen = new Set<string>();
    item.fields.forEach((field, index) => {
      const column = byName.get(field.name);
      if (!column || !compatible(column, field.value) || seen.has(field.name)) {
        context.addIssue({
          code: "custom",
          path: ["fields", index],
          message: `record_field_unknown: Field '${field.name}' has no writable column of a compatible type, or occurs twice`
        });
      }
      seen.add(field.name);
    });
  });
}

/** Contracts only: REC-1a/1b/2 register the implementations, not REC-0. */
export const dataStoreRecordsContracts = {
  propose: {
    description:
      "Propose extracted fields with Knowledge Base/document/page/quote evidence. Validate each whole item against the published table before writing; failures are per item. Send at most 1000 items per call and 1000 fields per item; split larger work into batches. Merge by evidence precedence, then document date; unresolved keys and evidence go to review.",
    inputSchema: dataStoreRecordsProposeInputSchema,
    outputSchema: operationBatchResultSchema,
    itemSchemaFor: proposalItemSchemaFor,
    effect: "changing",
    right: "data_store.records",
    keyLevel: "write",
    batch: true
  },
  decide: {
    description:
      "Confirm or correct a field against its evidence, or assign a document to an object key. Decisions are pinned; audit table/field/action/actor only, never the value.",
    inputSchema: dataStoreRecordsDecideInputSchema,
    outputSchema: dataStoreRecordsDecideOutputSchema,
    effect: "changing",
    right: "data_store.records",
    keyLevel: "write"
  },
  flagged: {
    description:
      "Page through fields needing review, up to 10000 per call; pass nextCursor as cursor for the next page. Check Knowledge Base access before showing any document citation; the store right alone does not grant access to source documents.",
    inputSchema: dataStoreRecordsFlaggedInputSchema,
    outputSchema: dataStoreRecordsFlaggedOutputSchema,
    effect: "reading",
    right: "data_store.records",
    keyLevel: "read"
  }
} as const;

export type DataStoreRecordsDecideOutput = z.infer<typeof dataStoreRecordsDecideOutputSchema>;
export type DataStoreRecordsFlaggedInput = z.infer<typeof dataStoreRecordsFlaggedInputSchema>;
export type DataStoreRecordsFlaggedOutput = z.infer<typeof dataStoreRecordsFlaggedOutputSchema>;
