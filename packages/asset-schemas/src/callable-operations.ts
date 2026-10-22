import { z } from "zod";
import { OPERATION_EFFECTS, OPERATION_SOURCE_KINDS } from "./contract-values";

// One operation a step of a Workflow may call, as the HTTP listing `operations.list_callable`
// and the agent's `platform.assets.operations` answer it (WF-EDIT-3). Both answer this shape,
// so the tool stays a projection of the operation.

/** The source of an operation. A source the caller may not read is told by its kind alone. */
export const operationSourceSchema = z.object({
  kind: z.enum(OPERATION_SOURCE_KINDS),
  title: z.string().optional(),
  /** The Connection's `service`, for its icon. */
  service: z.string().optional()
});
export type OperationSourceView = z.infer<typeof operationSourceSchema>;

const jsonSchemaObject = z.record(z.string(), z.unknown());

export const callableOperationSchema = z.object({
  /** What a step writes under `operation`. */
  name: z.string(),
  effect: z.enum(OPERATION_EFFECTS),
  title: z.string(),
  /** The operation's own description, where its source gives one. */
  description: z.string().optional(),
  source: operationSourceSchema,
  /** False where a call cannot reach its source now, such as a Connection that is off. */
  available: z.boolean(),
  inputSchema: jsonSchemaObject.optional(),
  outputSchema: jsonSchemaObject.optional()
});
export type CallableOperationView = z.infer<typeof callableOperationSchema>;

/** One page of callable operations. */
export const callableOperationsPageSchema = z.object({
  operations: z.array(callableOperationSchema),
  /** Passed back as `cursor`, with the same filters, until it is absent. */
  nextCursor: z.string().optional(),
  /** A source left operations out: a missing name proves no absence. */
  truncated: z.boolean()
});
export type CallableOperationsPage = z.infer<typeof callableOperationsPageSchema>;
