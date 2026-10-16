import { WORKSPACE_FILE_KINDS } from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { listQuerySchema, timestampSchema } from "./shared";

// Mirrors `FOUND_FILE_KINDS` of core.
const workspaceFileKindSchema = z.enum(WORKSPACE_FILE_KINDS);

/**
 * A Page, an uploaded file or a file an agent made, in a conversation of the workspace that
 * the caller may read: what it is called and where it lives, never what it holds. `id` is
 * what the conversation's own reads take: the Page's id, the uploaded file's id or the id of
 * the artifact that holds the made file.
 */
export const workspaceFileSchema = z.object({
  kind: workspaceFileKindSchema,
  id: z.string(),
  name: z.string(),
  mimeType: z.string().optional(),
  bytes: z.number().int().nonnegative(),
  updatedAt: timestampSchema,
  conversation: z.object({ id: z.string(), title: z.string() })
});

export const listWorkspaceFilesQuerySchema = listQuerySchema.extend({
  /** Only what has this text in its name or in the title of its conversation, whatever the case. */
  text: z
    .string()
    .min(1)
    .max(200)
    .refine((value) => !value.includes("\u0000"), "The text must not contain a NUL byte")
    .optional(),
  kind: workspaceFileKindSchema.optional()
});
