import {
  COLLABORATION_WORKSPACE_KINDS,
  DELETION_STATES,
  WORKSPACE_ACCENT_COLORS,
  WORKSPACE_ACCESS_STATES,
  WORKSPACE_MEMBERSHIP_ROLES,
  WORKSPACE_VISIBILITIES
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { conversationVisibilitySchema } from "./conversations";
import { timestampSchema } from "./shared";

export const workspaceVisibilitySchema = z.enum(WORKSPACE_VISIBILITIES);
export const workspaceMembershipRoleSchema = z.enum(WORKSPACE_MEMBERSHIP_ROLES);
export type WorkspaceMembershipRole = z.infer<typeof workspaceMembershipRoleSchema>;
export const workspaceAccentColorSchema = z.enum(WORKSPACE_ACCENT_COLORS);

export const collaborationWorkspaceSchema = z.object({
  id: z.string(),
  clientInstanceId: z.string(),
  kind: z.enum(COLLABORATION_WORKSPACE_KINDS),
  name: z.string(),
  description: z.string().nullable(),
  visibility: workspaceVisibilitySchema,
  defaultConversationVisibility: conversationVisibilitySchema,
  emoji: z.string().nullable(),
  accentColor: workspaceAccentColorSchema.nullable(),
  personalUserId: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
});

export const collaborationWorkspaceWithRoleSchema = collaborationWorkspaceSchema.extend({
  /** What the caller may do here. A superadmin acts as Owner of every Shared Workspace. */
  role: workspaceMembershipRoleSchema,
  /** The caller's own Workspace Membership role; null when only the superadmin role gives access. */
  membershipRole: workspaceMembershipRoleSchema.nullable(),
  pendingAccessRequestCount: z.number().int().nonnegative()
});

export const collaborationWorkspaceDirectoryItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  emoji: z.string().nullable(),
  accentColor: workspaceAccentColorSchema.nullable(),
  accessState: z.enum(WORKSPACE_ACCESS_STATES),
  createdAt: timestampSchema
});

export const workspaceMembershipSchema = z.object({
  collaborationWorkspaceId: z.string(),
  clientInstanceId: z.string(),
  userId: z.string(),
  role: workspaceMembershipRoleSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
});

export const workspaceMemberSchema = z.object({
  userId: z.string(),
  displayLabel: z.string(),
  email: z.string().nullable(),
  role: workspaceMembershipRoleSchema
});

export const workspaceMemberCandidateSchema = z.object({
  userId: z.string(),
  displayLabel: z.string(),
  email: z.string(),
  hasPendingAccessRequest: z.boolean()
});

export const workspaceAccessRequestSchema = z.object({
  id: z.string(),
  collaborationWorkspaceId: z.string(),
  clientInstanceId: z.string(),
  userId: z.string(),
  createdAt: timestampSchema
});

export const workspaceAccessRequestItemSchema = z.object({
  userId: z.string(),
  displayLabel: z.string(),
  email: z.string().nullable(),
  createdAt: timestampSchema
});

const workspaceNameSchema = z.string().trim().min(1).max(120);
const workspaceDescriptionSchema = z.string().trim().max(500).nullable();
const workspaceEmojiSchema = z.string().trim().max(32).nullable();

export const createCollaborationWorkspaceRequestSchema = z.object({
  name: workspaceNameSchema,
  description: workspaceDescriptionSchema.optional(),
  visibility: workspaceVisibilitySchema.optional(),
  defaultConversationVisibility: conversationVisibilitySchema.optional(),
  emoji: workspaceEmojiSchema.optional(),
  accentColor: workspaceAccentColorSchema.nullable().optional()
});

export const updateCollaborationWorkspaceRequestSchema = z.object({
  name: workspaceNameSchema.optional(),
  description: workspaceDescriptionSchema.optional(),
  visibility: workspaceVisibilitySchema.optional(),
  defaultConversationVisibility: conversationVisibilitySchema.optional(),
  emoji: workspaceEmojiSchema.optional(),
  accentColor: workspaceAccentColorSchema.nullable().optional()
});

export const addWorkspaceMemberRequestSchema = z.object({
  email: z.string().trim().email()
});

export const updateWorkspaceMemberRoleRequestSchema = z.object({
  role: workspaceMembershipRoleSchema
});

export const deleteCollaborationWorkspaceRequestSchema = z.object({
  confirmName: z.string().min(1)
});

export const collaborationWorkspaceDeletionImpactSchema = z.object({
  conversationCount: z.number().int().nonnegative(),
  memberCount: z.number().int().nonnegative(),
  pendingAccessRequestCount: z.number().int().nonnegative()
});

/** `deleted` means the rows are gone; `deleting` means the workspace is closed and a job removes the rest. */
export const collaborationWorkspaceDeletionStateSchema = z.object({
  state: z.enum(DELETION_STATES)
});

export type CollaborationWorkspace = z.infer<typeof collaborationWorkspaceSchema>;
export type CollaborationWorkspaceWithRole = z.infer<typeof collaborationWorkspaceWithRoleSchema>;
export type CollaborationWorkspaceDeletionImpact = z.infer<
  typeof collaborationWorkspaceDeletionImpactSchema
>;
export type CollaborationWorkspaceDirectoryItem = z.infer<
  typeof collaborationWorkspaceDirectoryItemSchema
>;
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;
export type WorkspaceMemberCandidate = z.infer<typeof workspaceMemberCandidateSchema>;
export type WorkspaceAccessRequestItem = z.infer<typeof workspaceAccessRequestItemSchema>;
