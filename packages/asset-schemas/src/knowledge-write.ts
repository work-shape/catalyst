import { z } from "zod";
import { KNOWLEDGE_FILE_MAX_BYTES } from "./contract-values";
import { operationBatchResultSchema, workflowDatasetReferenceSchema } from "./operation-batch";

// KBW-0 freezes these contracts before KBW-1, PROC-W and REC-W implement them. These
// descriptors register no callable operations or HTTP routes. Content is never audit data.

const id = z.string().min(1).max(200);
const count = z.number().int().min(0);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const text = z
  .string()
  .max(KNOWLEDGE_FILE_MAX_BYTES)
  .refine((value) => new TextEncoder().encode(value).byteLength <= KNOWLEDGE_FILE_MAX_BYTES, {
    message: `Document text exceeds ${KNOWLEDGE_FILE_MAX_BYTES} bytes`
  });

/** Reserved until CONN-DL: the Workflow's account must be allowed to use this Connection. */
export const knowledgeIngestFetchSchema = z.strictObject({
  connection: id,
  operation: id,
  input: z.record(z.string(), z.json())
});

const ingestItemIdentity = z.strictObject({
  itemId: id,
  version: id,
  name: z.string().min(1).max(1_000),
  path: z.string().startsWith("/").max(4_000).optional(),
  originLink: z
    .url({ protocol: /^https?$/u })
    .max(4_000)
    .optional(),
  metadata: z.record(z.string(), z.json()).optional(),
  text: z.never().optional(),
  fileId: z.never().optional(),
  fetch: z.never().optional()
});

/** Exactly one content, in both the TypeScript type and the runtime schema. */
export const knowledgeIngestItemSchema = z
  .union(
    [
      ingestItemIdentity.extend({ text }),
      ingestItemIdentity.extend({ fileId: id }),
      ingestItemIdentity.extend({ fetch: knowledgeIngestFetchSchema })
    ],
    { error: "knowledge_item_invalid: Supply exactly one of text, fileId or fetch" }
  )
  .superRefine((item, context) => {
    if (item.fetch !== undefined)
      context.addIssue({
        code: "custom",
        path: ["fetch"],
        message: "not_supported_yet: fetch arrives with CONN-DL; supply text or fileId"
      });
  });
export type KnowledgeIngestItem = z.infer<typeof knowledgeIngestItemSchema>;

export const knowledgeIngestInputSchema = z.union([
  z.strictObject({ items: z.array(knowledgeIngestItemSchema), complete: z.boolean().optional() }),
  z.strictObject({ dataset: workflowDatasetReferenceSchema, complete: z.boolean().optional() })
]);
export const knowledgeIngestOutputSchema = operationBatchResultSchema.extend({
  accepted: count,
  withdrawn: count
});
export const knowledgeWithdrawInputSchema = z.strictObject({ itemIds: z.array(id).min(1) });
export const knowledgeWithdrawOutputSchema = z.strictObject({ withdrawn: count });
export const knowledgePendingInputSchema = z.strictObject({
  type: id.optional(),
  since: z.iso.datetime({ offset: true }).optional(),
  limit: z.number().int().positive()
});
export const knowledgePendingRowSchema = z.strictObject({
  id,
  type: id,
  contentHash: hash,
  pages: workflowDatasetReferenceSchema
});
export const knowledgePendingOutputSchema = z.strictObject({
  documents: workflowDatasetReferenceSchema
});

const pageNumber = z.number().int().positive();
const range = z.strictObject({ pageFrom: pageNumber, pageTo: pageNumber });

const processorMetadataSchema = z.strictObject({
  documents: z.array(range).min(1),
  sections: z.array(range.extend({ title: z.string().min(1) })).optional(),
  fields: z.record(z.string(), z.json())
});

/**
 * A processor returns logical documents and page text (tables as Markdown), optional
 * section boundaries and fields. Chunking and vectors remain the platform's. This is the
 * single validator for built-ins and Workflow write-back; every refusal has the code
 * knowledge_processor_output_invalid. Fields' declared JSON Schema is checked by PROC-1.
 */
export const knowledgeProcessorOutputSchema = processorMetadataSchema
  .extend({
    // Count stays unbounded here: PROC-1/PROC-W must enforce the instance's
    // knowledge.maxPagesPerDocument at runtime (KB-ISO-3a), not a new contract cap.
    pages: z.array(z.strictObject({ page: pageNumber, text })).min(1)
  })
  .superRefine((output, context) => {
    const pages = new Set(output.pages.map((page) => page.page));
    if (
      output.pages.some(
        (page, index) => index > 0 && page.page <= (output.pages[index - 1]?.page ?? 0)
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["pages"],
        message: "knowledge_processor_output_invalid: Pages must be ascending and unique"
      });
    }
    const bytes = output.pages.reduce(
      (size, page) => size + new TextEncoder().encode(page.text).byteLength,
      0
    );
    if (bytes > KNOWLEDGE_FILE_MAX_BYTES)
      context.addIssue({
        code: "custom",
        path: ["pages"],
        message: "knowledge_processor_output_invalid: Document text exceeds the per-document limit"
      });
    for (const field of ["documents", "sections"] as const) {
      output[field]?.forEach((entry, index) => {
        if (
          entry.pageFrom > entry.pageTo ||
          !pages.has(entry.pageFrom) ||
          !pages.has(entry.pageTo)
        ) {
          context.addIssue({
            code: "custom",
            path: [field, index],
            message:
              "knowledge_processor_output_invalid: Page range must be ordered and inside the document"
          });
        }
      });
    }
  });
export type KnowledgeProcessorOutput = z.infer<typeof knowledgeProcessorOutputSchema>;

export const knowledgePutProcessedInputSchema = z.strictObject({
  items: z.union([
    z.array(
      z.strictObject({
        documentId: id,
        contentHash: hash,
        workflowRevision: id,
        // Mirror pending: page text lives outside step values and item dataset rows.
        // PROC-W resolves the pages and validates the full processor output above.
        output: processorMetadataSchema.extend({ pages: workflowDatasetReferenceSchema })
      })
    ),
    workflowDatasetReferenceSchema
  ])
});
export const knowledgeFieldValueSchema = z.json();
export const knowledgeExtractFieldsInputSchema = z.strictObject({
  documentId: id,
  schema: z.record(z.string(), knowledgeFieldValueSchema)
});
export const knowledgeExtractFieldsOutputSchema = z.strictObject({
  droppedFields: z.number().int().nonnegative().optional(),
  failedFields: z.number().int().nonnegative().optional(),
  path: z.string(),
  date: z.iso.date().nullable(),
  type: id,
  fields: z.record(
    z.string(),
    z.strictObject({ value: knowledgeFieldValueSchema, page: pageNumber, quote: z.string().min(1) })
  )
});

/** Created by the first ingest, never authored in kb.yaml; the id cannot collide with a connector source. */
export const knowledgeWorkflowSourceSchema = z
  .strictObject({
    id: z.string().startsWith("workflow:"),
    kind: z.literal("workflow"),
    workflowId: z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/u)
  })
  .refine(
    (source) =>
      source.id === `workflow:${source.workflowId}` ||
      (source.id.startsWith(`workflow:${source.workflowId}@`) &&
        /^[1-9][0-9]{0,9}$/u.test(source.id.slice(`workflow:${source.workflowId}@`.length))),
    {
      path: ["id"],
      message:
        "A Workflow source id is workflow:<workflowId>@<the revision that created the Workflow>"
    }
  );
export type KnowledgeWorkflowSource = z.infer<typeof knowledgeWorkflowSourceSchema>;

/** Contract inventory; completion, batch and dataset are present only where the table declares them. */
export const knowledgeWriteContracts = {
  ingest: {
    description:
      "Ingest items or a dataset into the calling data Workflow's source; complete promises a full pass, withdrawn only after the run succeeds.",
    inputSchema: knowledgeIngestInputSchema,
    outputSchema: knowledgeIngestOutputSchema,
    effect: "changing",
    right: "knowledge_base.ingest",
    keyLevel: "write",
    completion: "async",
    batch: true
  },
  withdraw: {
    description:
      "Withdraw item ids from the calling Workflow's source; removed from search immediately.",
    inputSchema: knowledgeWithdrawInputSchema,
    outputSchema: knowledgeWithdrawOutputSchema,
    effect: "changing",
    right: "knowledge_base.ingest",
    keyLevel: "write"
  },
  pending: {
    description:
      "Pull pending documents by type and time as a dataset; page text is another dataset reference.",
    inputSchema: knowledgePendingInputSchema,
    outputSchema: knowledgePendingOutputSchema,
    rowSchema: knowledgePendingRowSchema,
    effect: "reading",
    right: "knowledge_base.read",
    keyLevel: "read",
    dataset: true
  },
  put_processed: {
    description:
      "Write processor output by document, content hash and Workflow revision, with pages as a dataset reference like pending; the platform validates, chunks and indexes it, with per-item outcomes.",
    inputSchema: knowledgePutProcessedInputSchema,
    outputSchema: operationBatchResultSchema,
    effect: "changing",
    right: "knowledge_base.ingest",
    keyLevel: "write",
    batch: true
  },
  extract_fields: {
    description:
      "Extract fields by schema through the approved model binding within the Knowledge Base budget; each value carries page and quote evidence.",
    inputSchema: knowledgeExtractFieldsInputSchema,
    outputSchema: knowledgeExtractFieldsOutputSchema,
    effect: "reading",
    right: "knowledge_base.read",
    keyLevel: "read"
  }
} as const;

/** Records rules belong to the Data Store; kb.yaml must never hold them. */
export const knowledgeRecordsRefusalSchema = z
  .never({
    error:
      "'records' belongs in store.yaml. A data Workflow proposes fields into the Data Store's records mechanism."
  })
  .optional();

export type KnowledgeIngestInput = z.infer<typeof knowledgeIngestInputSchema>;
export type KnowledgeIngestOutput = z.infer<typeof knowledgeIngestOutputSchema>;
export type KnowledgeIngestFetch = z.infer<typeof knowledgeIngestFetchSchema>;
export type KnowledgeWithdrawInput = z.infer<typeof knowledgeWithdrawInputSchema>;
export type KnowledgeWithdrawOutput = z.infer<typeof knowledgeWithdrawOutputSchema>;
export type KnowledgePendingInput = z.infer<typeof knowledgePendingInputSchema>;
export type KnowledgePendingRow = z.infer<typeof knowledgePendingRowSchema>;
export type KnowledgePendingOutput = z.infer<typeof knowledgePendingOutputSchema>;
export type KnowledgePutProcessedInput = z.infer<typeof knowledgePutProcessedInputSchema>;
export type KnowledgeExtractFieldsInput = z.infer<typeof knowledgeExtractFieldsInputSchema>;
export type KnowledgeExtractFieldsOutput = z.infer<typeof knowledgeExtractFieldsOutputSchema>;
