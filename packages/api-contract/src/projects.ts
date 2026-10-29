import { z } from "zod";
import {
  PROJECT_AUDIENCES,
  PROJECT_DELETION_CONVERSATIONS,
  PROJECT_FILE_CHANGES,
  PROJECT_FILE_ORIGINS,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_CHOICE_REFUSALS,
  PROJECT_KNOWLEDGE_BASES_MAX,
  PROJECT_SKILLS_MAX,
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
  updatedAt: timestampSchema,
  /** The agent a new chat in the project starts with (PRJ-7); not a lock. */
  defaultAgent: z.string().optional(),
  /** The skills every run in the project is offered beside its agent's own (PRJ-7). */
  skills: z.array(z.string()).optional(),
  /** The Knowledge Bases every run in the project may search beside its agent's own (PRJ-8). */
  knowledgeBases: z.array(z.string()).optional()
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
  projectId: z.string().min(1).nullable(),
  /**
   * Into a private project, a chat others read now is read by its author alone from then on:
   * `true` says the person saw that (PRJ-6). Without it such a move is refused
   * (`VALIDATION_FAILED`, `project_hides_conversation`).
   */
  hideFromOthers: z.boolean().optional()
});

// Moving, sharing and deleting a whole project (PRJ-6).

/** What a change to the whole project reaches, counted for its dialog. */
export const projectImpactSchema = z.object({
  /** The chats in the project. */
  conversations: z.number().int().nonnegative(),
  /** Of those, the chats someone other than its creator started. */
  conversationsOfOthers: z.number().int().nonnegative(),
  /** Chats that must stay private and keep the project from being shared. */
  conversationsKeptPrivate: z.number().int().nonnegative(),
  /** The project's files as they are now. */
  files: z.number().int().nonnegative(),
  /** Of those, the files someone other than its creator changed last. */
  filesOfOthers: z.number().int().nonnegative(),
  /** Files a chat that must stay private wrote, or one that is gone; they keep it unshared. */
  filesKeptPrivate: z.number().int().nonnegative()
});

/** Only the creator changes who reads a project, and only in a Shared Workspace. */
export const setProjectAudienceRequestSchema = z.object({
  audience: projectAudienceSchema,
  /** The audience the person saw; a project changed since is refused with `CONFLICT`. */
  expectedAudience: projectAudienceSchema
});

export const projectAudienceChangeSchema = z.object({
  project: projectSchema,
  /** Chats every member of the workspace reads from now on. */
  conversationsShared: z.number().int().nonnegative(),
  /** Other members' chats that left the project and stay shared in the workspace. */
  conversationsLeft: z.number().int().nonnegative(),
  /** The creator's own chats that only the creator reads from now on. */
  conversationsMadePrivate: z.number().int().nonnegative()
});

export const moveProjectRequestSchema = z.object({
  /** A workspace the caller is a member of, as of the project's own. */
  collaborationWorkspaceId: z.string().min(1),
  /**
   * Out of a Personal Workspace only: who reads the project in the Shared Workspace. Missing:
   * only its creator. Elsewhere a project keeps its audience; into a Personal Workspace it is
   * that person's.
   */
  audience: projectAudienceSchema.optional()
});

export const projectMoveSchema = z.object({
  project: projectSchema,
  /** The chats that moved with the project. */
  conversationsMoved: z.number().int().nonnegative()
});

/** The one choice of a deletion: the project's chats stay in the workspace, or go too. */
export const deleteProjectRequestSchema = z.object({
  conversations: z.enum(PROJECT_DELETION_CONVERSATIONS)
});

export const projectDeletionSchema = z.object({
  /** Chats deleted with the project. */
  conversationsDeleted: z.number().int().nonnegative(),
  /** Chats that stayed in the workspace, each read as it was before. */
  conversationsKept: z.number().int().nonnegative()
});

/**
 * Why a choice is greyed for this project. `own_in_shared_project` (PRJ-7): it is the person's
 * own ("Nur ich") and the project is read by others, who could not use it; sharing it with the
 * workspace opens it. `not_everyone_may_use` (PRJ-8): a Knowledge Base the person may search
 * and not everyone in the project's audience may, as it is not available in the workspace.
 */
export const projectChoiceRefusalSchema = z.enum(PROJECT_CHOICE_REFUSALS);

/** Where an own agent or skill sits, for the share that opens it to the project's audience. */
const projectChoiceAssetSchema = z.object({ id: z.string(), workspaceId: z.string() });

export const projectAgentChoiceSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  /** The person's own agent, of their Personal Workspace: a chat that uses it is theirs alone. */
  own: z.boolean(),
  refusal: projectChoiceRefusalSchema.optional(),
  asset: projectChoiceAssetSchema.optional()
});

export const projectSkillChoiceSchema = z.object({
  name: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  /** The icon of a skill the platform ships. */
  icon: z.string().optional(),
  /** The person's own skill, of their Personal Workspace: a chat that reads it is theirs alone. */
  own: z.boolean(),
  refusal: projectChoiceRefusalSchema.optional(),
  asset: projectChoiceAssetSchema.optional()
});

/** A Knowledge Base a project may attach (PRJ-8): one the person may search. */
export const projectKnowledgeBaseChoiceSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string().optional(),
  /** Not published yet: attached, it answers once it is. */
  unpublished: z.boolean().optional(),
  /** The person's own, of their Personal Workspace: only a chat they alone read searches it. */
  own: z.boolean(),
  refusal: projectChoiceRefusalSchema.optional(),
  asset: projectChoiceAssetSchema.optional()
});

/**
 * A project's default agent and skills (PRJ-7), with what the person may choose: the agents
 * offered to them in the workspace and the skills the workspace owns or its agents use; their
 * own where only they read the project, and greyed with the reason where others do. A stored
 * name that is none of these is not available to the person now.
 */
export const projectSetupSchema = z.object({
  defaultAgent: z.string().optional(),
  skills: z.array(z.string()),
  /** The agent a new chat starts with where the project names none, or one not offered now. */
  workspaceDefaultAgent: z.string().optional(),
  agents: z.array(projectAgentChoiceSchema),
  skillChoices: z.array(projectSkillChoiceSchema),
  /** The Knowledge Bases the project attaches (PRJ-8), kept where they no longer apply. */
  knowledgeBases: z.array(z.string()),
  /**
   * The Knowledge Bases the person may attach, those not everyone in the project's audience may
   * use greyed with the reason. Missing where the module `knowledge` is off.
   */
  knowledgeBaseChoices: z.array(projectKnowledgeBaseChoiceSchema).optional()
});

/** What is left out stays as it is. */
export const setProjectSetupRequestSchema = z.object({
  /** `null`: new chats start with the workspace's default. */
  defaultAgent: z.string().min(1).max(128).nullable().optional(),
  skills: z.array(z.string().min(1).max(128)).max(PROJECT_SKILLS_MAX).optional(),
  knowledgeBases: z.array(z.string().min(1).max(128)).max(PROJECT_KNOWLEDGE_BASES_MAX).optional()
});

export type ProjectView = z.infer<typeof projectSchema>;
export type ProjectSetupView = z.infer<typeof projectSetupSchema>;
export type ProjectAgentChoiceView = z.infer<typeof projectAgentChoiceSchema>;
export type ProjectSkillChoiceView = z.infer<typeof projectSkillChoiceSchema>;
export type ProjectKnowledgeBaseChoiceView = z.infer<typeof projectKnowledgeBaseChoiceSchema>;
export type ProjectImpactView = z.infer<typeof projectImpactSchema>;
export type ProjectListItemView = z.infer<typeof projectListItemSchema>;
export type ProjectAudienceView = z.infer<typeof projectAudienceSchema>;
export type ProjectDeletionConversationsView = z.infer<
  typeof deleteProjectRequestSchema
>["conversations"];

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
