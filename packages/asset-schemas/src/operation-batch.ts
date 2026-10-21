import { z } from "zod";

/** The reference kept in step data; rows live in the owning run's dataset. */
export const workflowDatasetReferenceSchema = z.strictObject({
  $dataset: z.string().min(1),
  rowCount: z.number().int().min(0),
  // A view keeps the parent byte count as an upper bound.
  bytes: z.number().int().min(0),
  /** Absolute offset in the parent; rowCount bounds the view. No rows are copied. */
  offset: z.number().int().nonnegative().optional()
});

/** One row of a batch's failures dataset, preserving the input item for a retry. */
export const operationBatchFailureSchema = z.strictObject({
  item: z.json(),
  code: z.string().min(1),
  message: z.string().min(1)
});

/** One failed item never fails the call or its neighbours. */
export const operationBatchResultSchema = z.strictObject({
  done: z.number().int().min(0),
  failed: z.number().int().min(0),
  failures: workflowDatasetReferenceSchema
});

export type OperationBatchResult = z.infer<typeof operationBatchResultSchema>;
export type OperationBatchFailure = z.infer<typeof operationBatchFailureSchema>;
