import { z } from "zod";
import {
  PROJECT_AUDIENCES,
  PROJECT_FILE_CHANGES,
  PROJECT_FILE_ORIGINS,
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

/** A project in a list: with its sent chats counted and when it was last used (PRJ-5). */
export const projectListItemSchema = projectSchema.extend({
  /** The sent chats in the project; everyone who sees the project reads all of them. */
  conversationCount: z.number().int().nonnegative(),
  /** The latest change to the project or to a chat in it. */
  lastActivityAt: timestampSchema
});

/** Latest activity first. */
export const projectsSchema = z.object({ items: z.array(projectListItemSchema) });

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
export type ProjectListItemView = z.infer<typeof projectListItemSchema>;
export type ProjectAudienceView = z.infer<typeof projectAudienceSchema>;

// Project files (PRJ-2): one folder per project that people and agents write in place. Every
// change is a version; a change to a file that changed since its writer read it is kept beside
// it as a conflict copy. Paths are relative to the project's folder, folders joined by `/`.

export const projectFileOriginSchema = z.enum(PROJECT_FILE_ORIGINS);

export const projectFileSchema = z.object({
  path: z.string(),
  version: z.number().int().positive(),
  byteSize: z.number().int().nonnegative(),
  mimeType: z.string(),
  origin: projectFileOriginSchema,
  updatedAt: timestampSchema,
  /** Who made the current version. Absent once that person is deleted: a former member. */
  updatedBy: z.object({ id: z.string(), label: z.string() }).optional(),
  /** The chat whose agent or upload made the current version. */
  conversationId: z.string().optional()
});

export const projectFileLimitsSchema = z.object({
  maxFiles: z.number().int().positive(),
  maxFileBytes: z.number().int().positive(),
  maxProjectBytes: z.number().int().positive(),
  versionsPerFile: z.number().int().positive()
});

export const projectFilesSchema = z.object({
  items: z.array(projectFileSchema),
  /** What the project holds now: its files, and its bytes with every kept version. */
  usage: z.object({ files: z.number().int(), bytes: z.number().int() }),
  limits: projectFileLimitsSchema
});

export const projectFileVersionSchema = z.object({
  version: z.number().int().positive(),
  /** A deletion: a version without content. */
  deleted: z.boolean(),
  byteSize: z.number().int().nonnegative(),
  mimeType: z.string().optional(),
  origin: projectFileOriginSchema,
  at: timestampSchema,
  /** Absent once that person is deleted: a former member. */
  by: z.object({ id: z.string(), label: z.string() }).optional(),
  conversationId: z.string().optional()
});

export const projectFileVersionsSchema = z.object({
  path: z.string(),
  /** The current version; absent where the file is deleted now. */
  currentVersion: z.number().int().positive().optional(),
  items: z.array(projectFileVersionSchema)
});

export const projectFilePathQuerySchema = z.object({ path: z.string().min(1).max(512) });

export const projectFileContentQuerySchema = z.object({
  path: z.string().min(1).max(512),
  /** Missing: the current version. */
  version: z.coerce.number().int().positive().optional(),
  download: z.string().optional()
});

export const projectFileUploadQuerySchema = z.object({
  /** Where the file goes in the folder; missing: the file's own name at the root. */
  path: z.string().min(1).max(512).optional(),
  /**
   * The version the upload replaces, after the person confirmed "Replace". Missing: the path
   * must be free, and a taken one is refused with `CONFLICT`.
   */
  replaces: z.coerce.number().int().nonnegative().optional()
});

/** What a change did to the folder. */
export const projectFileChangeSchema = z.object({
  path: z.string(),
  version: z.number().int().positive(),
  change: z.enum(PROJECT_FILE_CHANGES),
  previousVersion: z.number().int().positive().optional(),
  /** For a conflict copy: the file that changed in the meantime, and its version. */
  changed: z.object({ path: z.string(), version: z.number().int().positive() }).optional()
});

export const moveProjectFilesRequestSchema = z.object({
  /** A file, or a folder ending in `/`. */
  from: z.string().min(1).max(512),
  to: z.string().min(1).max(512)
});

export const moveProjectFilesResponseSchema = z.object({ moved: z.number().int() });

export const deleteProjectFileRequestSchema = z.object({
  path: z.string().min(1).max(512),
  /** The version the person saw; a file that changed since is not deleted (`CONFLICT`). */
  replaces: z.number().int().positive().optional()
});

export const purgeProjectFileRequestSchema = z.object({ path: z.string().min(1).max(512) });

export const purgeProjectFileResponseSchema = z.object({ versions: z.number().int() });

export const restoreProjectFileRequestSchema = z.object({
  path: z.string().min(1).max(512),
  version: z.number().int().positive(),
  /**
   * The version the restore replaces: a file that changed since is refused with `CONFLICT`,
   * so an Undo never takes back someone else's later change.
   */
  replaces: z.number().int().positive().optional()
});

/** A file of the chat itself, kept in its project's folder ("Save to project"). */
export const saveToProjectRequestSchema = z.object({
  source: z.union([
    z.object({ fileId: z.string().min(1) }),
    z.object({ artifactId: z.string().min(1) })
  ]),
  /** Missing: the file's own name at the root. */
  path: z.string().min(1).max(512).optional()
});

/** A project file attached to the next message ("Add from project"). */
export const addFromProjectRequestSchema = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1).max(512),
  agentName: z.string().min(1).optional()
});

/**
 * Whether the instructions of a chat's project, its `AGENTS.md`, changed since the chat's last
 * run took them, from outside this chat (PRJ-3). Only the versions: the chat reads the text
 * through the project's files.
 */
export const conversationProjectInstructionsSchema = z.object({
  /** Absent where the chat is in no project. */
  projectId: z.string().optional(),
  projectTitle: z.string().optional(),
  /** The current version of `AGENTS.md`; absent where there is none. */
  currentVersion: z.number().int().positive().optional(),
  /** The version the chat's last run took; absent where it took none. */
  usedVersion: z.number().int().positive().optional(),
  /** The chat's last run was in the project, and the instructions changed since elsewhere. */
  changed: z.boolean()
});

export type ConversationProjectInstructionsView = z.infer<
  typeof conversationProjectInstructionsSchema
>;
export type ProjectFileView = z.infer<typeof projectFileSchema>;
export type ProjectFilesView = z.infer<typeof projectFilesSchema>;
export type ProjectFileVersionView = z.infer<typeof projectFileVersionSchema>;
export type ProjectFileVersionsView = z.infer<typeof projectFileVersionsSchema>;
export type ProjectFileChangeView = z.infer<typeof projectFileChangeSchema>;
