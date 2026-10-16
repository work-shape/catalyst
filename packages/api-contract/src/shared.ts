import { z } from "zod";

/** ISO 8601 timestamps always denote UTC, never a local offset. */
export const timestampSchema = z.iso.datetime({ offset: false });

/** How many items a list answers where its caller names no `limit`. */
export const DEFAULT_LIST_LIMIT = 50;
/** The most items one page of a list answers. */
export const MAX_LIST_LIMIT = 200;

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  cursor: z.string().min(1).optional()
});

export function listEnvelopeSchema<Schema extends z.ZodType>(item: Schema) {
  return z.object({ items: z.array(item), nextCursor: z.string().optional() });
}
