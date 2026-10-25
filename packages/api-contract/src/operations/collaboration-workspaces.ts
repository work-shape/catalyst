import { listQuerySchema } from "../shared";
import { z } from "zod";
import {
  addWorkspaceMemberRequestSchema,
  collaborationWorkspaceDeletionImpactSchema,
  collaborationWorkspaceDeletionStateSchema,
  collaborationWorkspaceDirectoryItemSchema,
  collaborationWorkspaceWithRoleSchema,
  createCollaborationWorkspaceRequestSchema,
  deleteCollaborationWorkspaceRequestSchema,
  updateCollaborationWorkspaceRequestSchema,
  updateWorkspaceMemberRoleRequestSchema,
  workspaceAccessRequestItemSchema,
  workspaceAccessRequestSchema,
  workspaceMemberCandidateSchema,
  workspaceMemberSchema,
  workspaceMembershipSchema
} from "../collaboration-workspaces";
import { collaborationWorkspaceAgentsSchema } from "../configuration";
import {
  usageMonthQuerySchema,
  workspaceMembersUsageSchema,
  workspaceUsageQuerySchema,
  workspaceUsageSchema
} from "../usage-reports";
import { listWorkspaceFilesQuerySchema, workspaceFileSchema } from "../workspace-files";
import { defineOperation, defineRegisteredOperation, json, page } from "./define-operation";

// The ten changing operations but `workspaces.ensure_personal` are operations of the registry.
// Their right is the caller's role in the workspace, which is no action a grant gives, so each
// checks it itself and requires none.
export const collaborationWorkspaceOperations = {
  "workspaces.ensure_personal": defineOperation({
    id: "workspaces.ensure_personal",
    method: "POST",
    path: "/api/v1/workspaces/personal",
    summary: "Create the caller's personal workspace if missing",
    tag: "Collaboration Workspaces",
    auth: "user",
    scope: "collaboration_workspace:read",
    requires: [],
    effect: "changing",
    response: json(collaborationWorkspaceWithRoleSchema),
    errors: [],
    rateClass: "write"
  }),
  "workspaces.list": defineOperation({
    id: "workspaces.list",
    method: "GET",
    path: "/api/v1/workspaces",
    summary: "List the workspaces the caller belongs to",
    tag: "Collaboration Workspaces",
    auth: "user",
    scope: "collaboration_workspace:read",
    requires: [],
    effect: "reading",
    query: listQuerySchema,
    response: page(collaborationWorkspaceWithRoleSchema, ["createdAt", "id"], false),
    errors: [],
    rateClass: "read"
  }),
  "workspaces.create": defineRegisteredOperation({
    id: "workspaces.create",
    method: "POST",
    path: "/api/v1/workspaces",
    summary: "Create a Shared Workspace. Every signed-in user may; the caller becomes its Owner.",
    tag: "Collaboration Workspaces",
    auth: "user",
    scope: "collaboration_workspace:manage",
    requires: [],
    effect: "changing",
    body: createCollaborationWorkspaceRequestSchema,
    response: json(collaborationWorkspaceWithRoleSchema),
    errors: ["CONFLICT"],
    rateClass: "write"
  }),
  "workspaces.directory.list": defineOperation({
    id: "workspaces.directory.list",
    method: "GET",
    path: "/api/v1/workspaces/directory",
    summary: "List the Shared Workspaces a member can find",
    tag: "Collaboration Workspaces",
    auth: "user",
    scope: "collaboration_workspace:read",
    requires: [],
    effect: "reading",
    query: listQuerySchema,
    response: page(collaborationWorkspaceDirectoryItemSchema, ["createdAt", "id"], false),
    errors: [],
    rateClass: "read"
  }),
  "workspaces.get": defineOperation({
    id: "workspaces.get",
    method: "GET",
    path: "/api/v1/workspaces/:collaborationWorkspaceId",
    summary: "Read one workspace with the caller's role",
    tag: "Collaboration Workspaces",
    auth: "user",
    scope: "collaboration_workspace:read",
    requires: [],
    effect: "reading",
    response: json(collaborationWorkspaceWithRoleSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "workspaces.agents.list": defineOperation({
    id: "workspaces.agents.list",
    method: "GET",
    path: "/api/v1/workspaces/:collaborationWorkspaceId/agents",
    summary: "List the agents available in a workspace",
    tag: "Collaboration Workspaces",
    auth: "user",
    scope: "config:read",
    requires: [],
    effect: "reading",
    query: listQuerySchema.extend({ locale: z.string().optional() }),
    response: json(collaborationWorkspaceAgentsSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  // A read of the registry, so the agent's tool that projects it is checked and recorded as
  // a call of the API is. Who may read a conversation may find its files: a member, of the
  // conversations that are not another member's private ones.
  "workspaces.files.list": defineRegisteredOperation({
    id: "workspaces.files.list",
    method: "GET",
    path: "/api/v1/workspaces/:collaborationWorkspaceId/files",
    summary:
      "Find the Pages and files in the conversations of a workspace the caller may read, newest first, without their contents",
    tag: "Collaboration Workspaces",
    auth: "user",
    scope: "conversation:read",
    requires: [],
    effect: "reading",
    query: listWorkspaceFilesQuerySchema,
    response: page(workspaceFileSchema, ["updatedAt", "id"], true),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "workspaces.update": defineRegisteredOperation({
    id: "workspaces.update",
    method: "PATCH",
    path: "/api/v1/workspaces/:collaborationWorkspaceId",
    summary: "Change a workspace's settings. Needs the role Owner or Admin.",
    tag: "Collaboration Workspaces",
    auth: "user",
    scope: "collaboration_workspace:manage",
    requires: [],
    effect: "changing",
    body: updateCollaborationWorkspaceRequestSchema,
    response: json(collaborationWorkspaceWithRoleSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "workspaces.deletion_impact.get": defineOperation({
    id: "workspaces.deletion_impact.get",
    method: "GET",
    path: "/api/v1/workspaces/:collaborationWorkspaceId/deletion-impact",
    summary: "Read what deleting a Shared Workspace would remove",
    tag: "Collaboration Workspaces",
    auth: "user",
    scope: "collaboration_workspace:manage",
    requires: [],
    effect: "reading",
    response: json(collaborationWorkspaceDeletionImpactSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "workspaces.delete": defineRegisteredOperation({
    id: "workspaces.delete",
    method: "DELETE",
    path: "/api/v1/workspaces/:collaborationWorkspaceId",
    summary:
      "Delete a Shared Workspace and its conversations. Answers `deleted`, or `deleting` while the data is still being removed. Needs the role Owner.",
    tag: "Collaboration Workspaces",
    auth: "user",
    scope: "collaboration_workspace:manage",
    requires: [],
    effect: "changing",
    body: deleteCollaborationWorkspaceRequestSchema,
    response: json(collaborationWorkspaceDeletionStateSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "workspaces.members.list": defineOperation({
    id: "workspaces.members.list",
    method: "GET",
    path: "/api/v1/workspaces/:collaborationWorkspaceId/members",
    summary: "List the members of a workspace",
    tag: "Collaboration Workspaces",
    auth: "user",
    scope: "collaboration_workspace:read",
    requires: [],
    effect: "reading",
    query: listQuerySchema,
    response: page(workspaceMemberSchema, ["displayLabel", "userId"], false),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  // A shared workspace's Usage tab (LU-3): for its Owners and Admins. The figures per member
  // also need `usage.view_users` for the workspace, and every read of them is audited.
  "workspaces.usage.get": defineOperation({
    id: "workspaces.usage.get",
    method: "GET",
    path: "/api/v1/workspaces/:collaborationWorkspaceId/usage",
    summary:
      "Read a shared workspace's usage: this month, its days and a period grouped by one dimension. Needs the role Owner or Admin.",
    tag: "Collaboration Workspaces",
    auth: "user",
    scope: "collaboration_workspace:read",
    requires: [],
    effect: "reading",
    query: workspaceUsageQuerySchema,
    response: json(workspaceUsageSchema),
    errors: ["NOT_FOUND", "FORBIDDEN"],
    rateClass: "read"
  }),
  "workspaces.member_usage.list": defineOperation({
    id: "workspaces.member_usage.list",
    method: "GET",
    path: "/api/v1/workspaces/:collaborationWorkspaceId/usage/members",
    summary:
      "Read what each member used in a shared workspace in one month. Needs the role Owner or Admin and the right to view usage by person; every read is an audit event.",
    tag: "Collaboration Workspaces",
    auth: "user",
    scope: "collaboration_workspace:read",
    requires: [],
    effect: "reading",
    query: usageMonthQuerySchema,
    response: json(workspaceMembersUsageSchema),
    errors: ["NOT_FOUND", "FORBIDDEN"],
    rateClass: "read"
  }),
  "workspaces.member_candidates.list": defineOperation({
    id: "workspaces.member_candidates.list",
    method: "GET",
    path: "/api/v1/workspaces/:collaborationWorkspaceId/member-candidates",
    summary: "Search users who can be added to a workspace",
    tag: "Collaboration Workspaces",
    auth: "user",
    scope: "collaboration_workspace:manage",
    requires: [],
    effect: "reading",
    query: listQuerySchema.extend({ q: z.string().optional() }),
    response: page(workspaceMemberCandidateSchema, ["displayLabel", "email", "userId"], false),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "workspaces.members.add": defineRegisteredOperation({
    id: "workspaces.members.add",
    method: "POST",
    path: "/api/v1/workspaces/:collaborationWorkspaceId/members",
    summary: "Add a user to a workspace by email. Needs the role Owner or Admin.",
    tag: "Collaboration Workspaces",
    auth: "user",
    scope: "collaboration_workspace:manage",
    requires: [],
    effect: "changing",
    body: addWorkspaceMemberRequestSchema,
    response: json(workspaceMemberSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "workspaces.members.update_role": defineRegisteredOperation({
    id: "workspaces.members.update_role",
    method: "PATCH",
    path: "/api/v1/workspaces/:collaborationWorkspaceId/members/:userId",
    summary:
      "Change a member's role in a workspace. Needs the role Owner or Admin. An Admin changes regular Members only.",
    tag: "Collaboration Workspaces",
    auth: "user",
    scope: "collaboration_workspace:manage",
    requires: [],
    effect: "changing",
    body: updateWorkspaceMemberRoleRequestSchema,
    response: json(workspaceMembershipSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "workspaces.members.remove": defineRegisteredOperation({
    id: "workspaces.members.remove",
    method: "DELETE",
    path: "/api/v1/workspaces/:collaborationWorkspaceId/members/:userId",
    summary:
      "Remove a member from a workspace. Needs the role Owner or Admin. An Admin removes regular Members only.",
    tag: "Collaboration Workspaces",
    auth: "user",
    scope: "collaboration_workspace:manage",
    requires: [],
    effect: "changing",
    response: json(workspaceMembershipSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "workspaces.members.leave": defineRegisteredOperation({
    id: "workspaces.members.leave",
    method: "DELETE",
    path: "/api/v1/workspaces/:collaborationWorkspaceId/members/me",
    summary: "Leave a workspace. Every member may, but its last active Owner.",
    tag: "Collaboration Workspaces",
    auth: "user",
    scope: "collaboration_workspace:manage",
    requires: [],
    effect: "changing",
    response: json(workspaceMembershipSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "workspaces.access_requests.create": defineRegisteredOperation({
    id: "workspaces.access_requests.create",
    method: "POST",
    path: "/api/v1/workspaces/:collaborationWorkspaceId/access-requests",
    summary: "Ask to join a Shared Workspace that can be found. Every signed-in user may.",
    tag: "Collaboration Workspaces",
    auth: "user",
    scope: "collaboration_workspace:manage",
    requires: [],
    effect: "changing",
    response: json(workspaceAccessRequestSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "workspaces.access_requests.list": defineOperation({
    id: "workspaces.access_requests.list",
    method: "GET",
    path: "/api/v1/workspaces/:collaborationWorkspaceId/access-requests",
    summary: "List the open requests to join a workspace",
    tag: "Collaboration Workspaces",
    auth: "user",
    scope: "collaboration_workspace:read",
    requires: [],
    effect: "reading",
    query: listQuerySchema,
    response: page(workspaceAccessRequestItemSchema, ["createdAt", "userId"], false),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "workspaces.access_requests.approve": defineRegisteredOperation({
    id: "workspaces.access_requests.approve",
    method: "POST",
    path: "/api/v1/workspaces/:collaborationWorkspaceId/access-requests/:userId/approve",
    summary: "Approve a request to join a workspace. Needs the role Owner or Admin.",
    tag: "Collaboration Workspaces",
    auth: "user",
    scope: "collaboration_workspace:manage",
    requires: [],
    effect: "changing",
    response: json(workspaceMembershipSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "workspaces.access_requests.decline": defineRegisteredOperation({
    id: "workspaces.access_requests.decline",
    method: "DELETE",
    path: "/api/v1/workspaces/:collaborationWorkspaceId/access-requests/:userId",
    summary: "Decline a request to join a workspace. Needs the role Owner or Admin.",
    tag: "Collaboration Workspaces",
    auth: "user",
    scope: "collaboration_workspace:manage",
    requires: [],
    effect: "changing",
    response: json(workspaceAccessRequestSchema),
    errors: ["NOT_FOUND"],
    rateClass: "write"
  })
} as const;
