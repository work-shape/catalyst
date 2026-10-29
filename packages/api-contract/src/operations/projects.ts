import {
  addFromProjectRequestSchema,
  conversationProjectInstructionsSchema,
  createProjectRequestSchema,
  deleteProjectFileRequestSchema,
  moveProjectFilesRequestSchema,
  moveProjectFilesResponseSchema,
  projectFileChangeSchema,
  projectFileContentQuerySchema,
  projectFilePathQuerySchema,
  projectFilesSchema,
  projectFileUploadQuerySchema,
  projectFileVersionsSchema,
  purgeProjectFileRequestSchema,
  purgeProjectFileResponseSchema,
  restoreProjectFileRequestSchema,
  saveToProjectRequestSchema,
  projectSchema,
  projectSetupSchema,
  projectsSchema,
  setConversationProjectRequestSchema,
  setProjectSetupRequestSchema,
  deleteProjectRequestSchema,
  moveProjectRequestSchema,
  projectAudienceChangeSchema,
  projectDeletionSchema,
  projectImpactSchema,
  projectMoveSchema,
  setProjectAudienceRequestSchema
} from "../projects";
import { conversationSchema, draftAttachmentUploadResponseSchema } from "../conversations";
import { blob, defineOperation, defineRegisteredOperation, json } from "./define-operation";

/**
 * Projects, of the module `projects` (PRJ-1): a named folder of chat work in one workspace,
 * shared with its members or private to its creator. Only membership reaches a project; no
 * grant and no bundle opens one, and a project outside the caller's audience answers as one
 * that does not exist. `projects.list_mine` answers across the caller's memberships (PRJ-5).
 * Spec: projects.md, sections 3, 8 and 9.
 */
export const projectOperations = {
  "projects.list": defineOperation({
    id: "projects.list",
    method: "GET",
    path: "/api/v1/workspaces/:collaborationWorkspaceId/projects",
    summary: "List the projects of a workspace the caller is in the audience of",
    tag: "Projects",
    auth: "user",
    scope: "conversation:read",
    requires: [],
    effect: "reading",
    response: json(projectsSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "projects.list_mine": defineOperation({
    id: "projects.list_mine",
    method: "GET",
    path: "/api/v1/projects",
    summary:
      "List the projects of every workspace the caller is a member of that the caller is in the audience of",
    tag: "Projects",
    auth: "user",
    scope: "conversation:read",
    requires: [],
    effect: "reading",
    response: json(projectsSchema),
    errors: [],
    rateClass: "read"
  }),
  "projects.get": defineOperation({
    id: "projects.get",
    method: "GET",
    path: "/api/v1/projects/:projectName",
    summary: "Read one project the caller is in the audience of",
    tag: "Projects",
    auth: "user",
    scope: "conversation:read",
    requires: [],
    effect: "reading",
    response: json(projectSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "projects.create": defineRegisteredOperation({
    id: "projects.create",
    method: "POST",
    path: "/api/v1/projects",
    summary: "Create a project in a workspace the caller is a member of",
    tag: "Projects",
    auth: "user",
    scope: "conversation:write",
    requires: [],
    effect: "changing",
    body: createProjectRequestSchema,
    response: json(projectSchema),
    errors: ["NOT_FOUND"],
    rateClass: "write"
  }),
  // A project's default agent and skills (PRJ-7) and Knowledge Bases (PRJ-8), with what the
  // caller may choose of them.
  "projects.setup.get": defineOperation({
    id: "projects.setup.get",
    method: "GET",
    path: "/api/v1/project-settings/:projectId/setup",
    summary:
      "Read a project's default agent, skills and Knowledge Bases, with those the caller may choose for it",
    tag: "Projects",
    auth: "user",
    scope: "conversation:read",
    requires: [],
    effect: "reading",
    response: json(projectSetupSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "projects.setup.set": defineRegisteredOperation({
    id: "projects.setup.set",
    method: "PUT",
    path: "/api/v1/project-settings/:projectId/setup",
    summary:
      "Set the agent a new chat in a project starts with and the skills and Knowledge Bases every run in it is offered",
    tag: "Projects",
    auth: "user",
    scope: "conversation:write",
    requires: [],
    effect: "changing",
    body: setProjectSetupRequestSchema,
    response: json(projectSetupSchema),
    errors: ["NOT_FOUND", "CONFLICT", "VALIDATION_FAILED"],
    rateClass: "write"
  }),
  // A whole project (PRJ-6): who reads it, its workspace, its deletion.
  "projects.impact": defineOperation({
    id: "projects.impact",
    method: "GET",
    path: "/api/v1/project-settings/:projectId/impact",
    summary:
      "Count what a change to the whole project reaches: its chats and files, and whose they are",
    tag: "Projects",
    auth: "user",
    scope: "conversation:read",
    requires: [],
    effect: "reading",
    response: json(projectImpactSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "projects.set_audience": defineRegisteredOperation({
    id: "projects.set_audience",
    method: "PUT",
    path: "/api/v1/project-settings/:projectId/audience",
    summary:
      "Share a project with its workspace or make it private to its creator, with every chat in it",
    tag: "Projects",
    auth: "user",
    scope: "conversation:write",
    requires: [],
    effect: "changing",
    body: setProjectAudienceRequestSchema,
    response: json(projectAudienceChangeSchema),
    errors: ["NOT_FOUND", "CONFLICT", "VALIDATION_FAILED"],
    rateClass: "write"
  }),
  "projects.move": defineRegisteredOperation({
    id: "projects.move",
    method: "POST",
    path: "/api/v1/project-settings/:projectId/move",
    summary:
      "Move a project with its chats and files to another workspace the caller is a member of",
    tag: "Projects",
    auth: "user",
    scope: "conversation:write",
    requires: [],
    effect: "changing",
    body: moveProjectRequestSchema,
    response: json(projectMoveSchema),
    errors: ["NOT_FOUND", "CONFLICT", "VALIDATION_FAILED"],
    rateClass: "write"
  }),
  "projects.delete": defineRegisteredOperation({
    id: "projects.delete",
    method: "POST",
    path: "/api/v1/project-settings/:projectId/delete",
    summary: "Delete a project with its files; its chats stay in the workspace or are deleted too",
    tag: "Projects",
    auth: "user",
    scope: "conversation:write",
    requires: [],
    effect: "changing",
    body: deleteProjectRequestSchema,
    response: json(projectDeletionSchema),
    errors: ["NOT_FOUND", "CONFLICT", "FORBIDDEN"],
    rateClass: "write"
  }),
  "conversations.set_project": defineRegisteredOperation({
    id: "conversations.set_project",
    method: "PUT",
    path: "/api/v1/conversations/:conversationId/project",
    summary:
      "Put a conversation into a project of its workspace, or take it out; it takes the project's audience",
    tag: "Projects",
    auth: "user",
    scope: "conversation:write",
    requires: [],
    effect: "changing",
    body: setConversationProjectRequestSchema,
    response: json(conversationSchema),
    errors: ["NOT_FOUND", "CONFLICT", "VALIDATION_FAILED"],
    rateClass: "write"
  }),
  // Project files (PRJ-2). Every read and write asks the project's audience: a person
  // outside it gets a project that does not exist, also by its id.
  "projects.files.list": defineOperation({
    id: "projects.files.list",
    method: "GET",
    path: "/api/v1/project-files/:projectId",
    summary: "List the files of a project as they are now, with what the project holds",
    tag: "Projects",
    auth: "user",
    scope: "conversation:read",
    requires: [],
    effect: "reading",
    response: json(projectFilesSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "projects.files.versions": defineOperation({
    id: "projects.files.versions",
    method: "GET",
    path: "/api/v1/project-files/:projectId/versions",
    summary: "List the kept versions of a project file, newest first, with who made each",
    tag: "Projects",
    auth: "user",
    scope: "conversation:read",
    requires: [],
    effect: "reading",
    query: projectFilePathQuerySchema,
    response: json(projectFileVersionsSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "projects.files.get_content": defineOperation({
    id: "projects.files.get_content",
    method: "GET",
    path: "/api/v1/project-files/:projectId/content",
    summary: "Download or display a project file, or one of its versions",
    tag: "Projects",
    auth: "user",
    scope: "conversation:read",
    requires: [],
    effect: "reading",
    query: projectFileContentQuerySchema,
    response: blob(),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "projects.files.upload": defineRegisteredOperation({
    id: "projects.files.upload",
    method: "POST",
    path: "/api/v1/project-files/:projectId",
    summary:
      "Upload one file into a project's folder; over a taken path only with the version it replaces",
    tag: "Projects",
    auth: "user",
    scope: "conversation:write",
    requires: [],
    effect: "changing",
    multipart: true,
    query: projectFileUploadQuerySchema,
    response: json(projectFileChangeSchema),
    errors: ["NOT_FOUND", "CONFLICT", "VALIDATION_FAILED"],
    rateClass: "write"
  }),
  "projects.files.move": defineRegisteredOperation({
    id: "projects.files.move",
    method: "POST",
    path: "/api/v1/project-files/:projectId/move",
    summary: "Rename or move a project file, or a folder with every file below it",
    tag: "Projects",
    auth: "user",
    scope: "conversation:write",
    requires: [],
    effect: "changing",
    body: moveProjectFilesRequestSchema,
    response: json(moveProjectFilesResponseSchema),
    errors: ["NOT_FOUND", "CONFLICT", "VALIDATION_FAILED"],
    rateClass: "write"
  }),
  "projects.files.delete": defineRegisteredOperation({
    id: "projects.files.delete",
    method: "POST",
    path: "/api/v1/project-files/:projectId/delete",
    summary:
      "Delete a project file as a new version; it stays restorable while its versions are kept",
    tag: "Projects",
    auth: "user",
    scope: "conversation:write",
    requires: [],
    effect: "changing",
    body: deleteProjectFileRequestSchema,
    response: json(projectFileChangeSchema),
    errors: ["NOT_FOUND", "CONFLICT", "VALIDATION_FAILED"],
    rateClass: "write"
  }),
  "projects.files.purge": defineRegisteredOperation({
    id: "projects.files.purge",
    method: "POST",
    path: "/api/v1/project-files/:projectId/purge",
    summary: "Delete a project file for good, with all its versions",
    tag: "Projects",
    auth: "user",
    scope: "conversation:write",
    requires: [],
    effect: "changing",
    body: purgeProjectFileRequestSchema,
    response: json(purgeProjectFileResponseSchema),
    errors: ["NOT_FOUND", "VALIDATION_FAILED"],
    rateClass: "write"
  }),
  "projects.files.restore": defineRegisteredOperation({
    id: "projects.files.restore",
    method: "POST",
    path: "/api/v1/project-files/:projectId/restore",
    summary: "Make an older version of a project file the newest one",
    tag: "Projects",
    auth: "user",
    scope: "conversation:write",
    requires: [],
    effect: "changing",
    body: restoreProjectFileRequestSchema,
    response: json(projectFileChangeSchema),
    errors: ["NOT_FOUND", "CONFLICT", "VALIDATION_FAILED"],
    rateClass: "write"
  }),
  // The project's instructions (PRJ-3): whether they changed since a chat's last run.
  "conversations.project_instructions.get": defineOperation({
    id: "conversations.project_instructions.get",
    method: "GET",
    path: "/api/v1/conversations/:conversationId/project-instructions",
    summary:
      "Say whether the instructions of a chat's project changed since the chat's last run took them",
    tag: "Projects",
    auth: "user",
    scope: "conversation:read",
    requires: [],
    effect: "reading",
    response: json(conversationProjectInstructionsSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "conversations.project_files.save": defineRegisteredOperation({
    id: "conversations.project_files.save",
    method: "POST",
    path: "/api/v1/conversations/:conversationId/project-files",
    summary: "Keep a file of a chat in a project in that project's folder",
    tag: "Projects",
    auth: "user",
    scope: "conversation:write",
    requires: [],
    effect: "changing",
    body: saveToProjectRequestSchema,
    response: json(projectFileChangeSchema),
    errors: ["NOT_FOUND", "CONFLICT", "VALIDATION_FAILED"],
    rateClass: "write"
  }),
  "conversations.draft_attachments.add_from_project": defineRegisteredOperation({
    id: "conversations.draft_attachments.add_from_project",
    method: "POST",
    path: "/api/v1/conversations/:conversationId/draft-attachments/from-project",
    summary:
      "Attach a project file to the next message; only where everyone who reads the chat reads the project",
    tag: "Projects",
    auth: "user",
    scope: "conversation:write",
    requires: [],
    effect: "changing",
    body: addFromProjectRequestSchema,
    response: json(draftAttachmentUploadResponseSchema),
    errors: ["NOT_FOUND", "CONFLICT", "VALIDATION_FAILED"],
    rateClass: "write"
  })
};
