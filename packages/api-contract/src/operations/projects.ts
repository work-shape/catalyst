import {
  createProjectRequestSchema,
  projectSchema,
  projectsSchema,
  setConversationProjectRequestSchema
} from "../projects";
import { conversationSchema } from "../conversations";
import { defineOperation, defineRegisteredOperation, json } from "./define-operation";

/**
 * Projects, of the module `projects` (PRJ-1): a named folder of chat work in one workspace,
 * shared with its members or private to its creator. Only membership reaches a project; no
 * grant and no bundle opens one, and a project outside the caller's audience answers as one
 * that does not exist. Spec: projects.md, sections 3 and 8.
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
  })
};
