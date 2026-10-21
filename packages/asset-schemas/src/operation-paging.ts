import { z } from "zod";

/** Paging settings shared by accepted Connections and their API view. */
export const operationPagingSchema = z.discriminatedUnion("by", [
  z.strictObject({
    by: z.enum(["page", "offset"]),
    param: z.string().min(1),
    sizeParam: z.string().min(1),
    size: z.number().int().min(1),
    start: z.number().int().min(0).optional()
  }),
  z.strictObject({
    by: z.enum(["cursor", "next_link"]),
    param: z.string().min(1),
    cursor: z.string().min(1)
  })
]);

export type OperationPaging = z.infer<typeof operationPagingSchema>;
