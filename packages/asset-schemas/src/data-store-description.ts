import { z } from "zod";

export const DATA_STORE_DESCRIPTION_TOOL_NAME = "platform.data_stores.describe";
export const dataStoreDescriptionInputSchema = z.strictObject({ store: z.string().min(1) });
const useSchema = z.object({ kind: z.string(), name: z.string(), title: z.string() });
/** Metadata only. No defaults, SQL, rows, samples or distinct values belong here. */
export const dataStoreDescriptionSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string().optional(),
  owner: z.union([
    z.object({ kind: z.literal("instance") }),
    z.object({ kind: z.literal("workspace"), workspaceId: z.string() })
  ]),
  published: z.boolean(),
  tables: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
      rowEstimate: z.number().nullable(),
      fields: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          description: z.string(),
          nullable: z.boolean()
        })
      )
    })
  ),
  schemaAvailable: z.boolean(),
  filledBy: z.array(useSchema),
  readBy: z.array(useSchema),
  usesTruncated: z.boolean(),
  rights: z.object({ read: z.boolean(), add: z.boolean(), change: z.boolean() }),
  chat: z.object({ canReadRows: z.boolean(), reason: z.string(), nextStep: z.string().optional() })
});
