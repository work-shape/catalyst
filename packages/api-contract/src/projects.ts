import { z } from "zod";
import {
  PROJECT_AUDIENCES,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_TITLE_MAX_LENGTH
} from "@work-shape/catalyst-asset-schemas";
import { timestampSchema } from "./shared";

// Projects (PRJ-1): a named folder of chat work in one workspace, shared with the workspace
// or private to its creator. A conversation in a project is read by exactly that audience.

/** `workspace`: every member of the workspace. `private`: its creator alone. */
export const projectAudienceSchema = z.enum(PROJECT_AUDIENCES);

export const projectSchema = z.object({
  /** The id of the project's asset. */
  id: z.string(),
  /** Made by the server from the title and a random suffix; never changes. */
  name: z.string(),
  collaborationWorkspaceId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  audience: projectAudienceSchema,
  createdByUserId: z.string(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
});

export const projectsSchema = z.object({ items: z.array(projectSchema) });

export const createProjectRequestSchema = z.object({
  collaborationWorkspaceId: z.string().min(1),
  title: z.string().trim().min(1).max(PROJECT_TITLE_MAX_LENGTH),
  description: z.string().trim().max(PROJECT_DESCRIPTION_MAX_LENGTH).optional(),
  /** Missing: the workspace's default for conversations. A Personal Workspace has no choice. */
  audience: projectAudienceSchema.optional()
});

/** A project of the conversation's own workspace, or `null` to take it out of its project. */
export const setConversationProjectRequestSchema = z.object({
  projectId: z.string().min(1).nullable()
});

export type ProjectView = z.infer<typeof projectSchema>;
export type ProjectAudienceView = z.infer<typeof projectAudienceSchema>;
