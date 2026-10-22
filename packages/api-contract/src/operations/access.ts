import { dataScopesSchema, scopeAssignmentInputSchema } from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { listQuerySchema } from "../shared";
import {
  assetRightsCheckQuerySchema,
  assetRightsCheckSchema,
  createPermissionGrantRequestSchema,
  effectivePermissionsQuerySchema,
  effectivePermissionsSchema,
  holderRightsSchema,
  listPermissionGrantsQuerySchema,
  permissionGrantSchema,
  scopeAssignmentsOverviewSchema,
  updateWorkspaceBuildLimitsRequestSchema,
  workspaceBuildLimitsSchema
} from "../access";
import { defineOperation, defineRegisteredOperation, json, page } from "./define-operation";

// The five changing operations are operations of the registry: a call is an Operation Run.
// The reads are plain.

export const accessOperations = {
  "scope_assignments.list": defineOperation({
    id: "scope_assignments.list",
    method: "GET",
    path: "/api/v1/instance/access/scope-assignments",
    summary: "Read the declared data scope and one holder's assignments",
    tag: "Access",
    auth: "user",
    scope: "user_admin:read",
    requires: ["users.manage"],
    effect: "reading",
    query: scopeAssignmentInputSchema.pick({ holderKind: true, holderId: true }),
    response: json(
      z.object({
        dimensions: dataScopesSchema,
        assignments: z.array(scopeAssignmentInputSchema),
        effective: z.record(z.string(), z.union([z.literal("all"), z.array(z.string())])).optional()
      })
    ),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "scope_assignments.overview": defineOperation({
    id: "scope_assignments.overview",
    method: "GET",
    path: "/api/v1/instance/access/scope-assignments/overview",
    summary:
      "Read the declared data scope, every assignment the reader may see, and each active person's groups and effective values",
    tag: "Access",
    auth: "user",
    scope: "user_admin:read",
    requires: ["users.manage"],
    effect: "reading",
    response: json(scopeAssignmentsOverviewSchema),
    errors: [],
    rateClass: "read"
  }),
  "scope_assignments.set": defineRegisteredOperation({
    id: "scope_assignments.set",
    method: "PUT",
    path: "/api/v1/instance/access/scope-assignments",
    summary: "Replace one holder's data scope values or revocations; never grants a right",
    tag: "Access",
    auth: "user",
    scope: "user_admin:write",
    requires: ["users.manage"],
    effect: "changing",
    body: scopeAssignmentInputSchema,
    response: json(scopeAssignmentInputSchema),
    errors: ["NOT_FOUND"],
    rateClass: "write"
  }),
  "permissions.grant": defineRegisteredOperation({
    id: "permissions.grant",
    method: "POST",
    path: "/api/v1/instance/access/grants",
    summary:
      "Allow or deny a user an action in a workspace, on one asset or on the instance, or allow a service principal a use right on one asset",
    tag: "Access",
    // A person's operation. A service principal is let in to be refused by the operation
    // itself, by name and on the Operation Run, and not by the route with a general answer.
    auth: "principal",
    scope: "user_admin:write",
    // The rule is more than one right: `users.manage`, a superadmin's rows are a superadmin's
    // alone, and a service principal's rows are written by who administers service
    // principals. The operation checks all of it itself, before the policy is asked.
    requires: [],
    effect: "changing",
    body: createPermissionGrantRequestSchema,
    response: json(permissionGrantSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "permissions.revoke": defineRegisteredOperation({
    id: "permissions.revoke",
    method: "DELETE",
    path: "/api/v1/instance/access/grants/:grantId",
    summary: "Remove a grant row",
    tag: "Access",
    // A person's operation. A service principal is let in to be refused by the operation
    // itself, by name and on the Operation Run, and not by the route with a general answer.
    auth: "principal",
    scope: "user_admin:write",
    // The rule is more than one right: `users.manage`, a superadmin's rows are a superadmin's
    // alone, and a service principal's rows are removed by who administers service
    // principals. The operation checks all of it itself, before the policy is asked.
    requires: [],
    effect: "changing",
    response: json(permissionGrantSchema),
    errors: ["NOT_FOUND"],
    rateClass: "write"
  }),
  "permissions.list": defineOperation({
    id: "permissions.list",
    method: "GET",
    path: "/api/v1/instance/access/grants",
    summary: "List grant rows",
    tag: "Access",
    auth: "user",
    scope: "user_admin:read",
    // Holder-specific authorization is checked by the handler.
    requires: [],
    effect: "reading",
    query: listPermissionGrantsQuerySchema,
    response: page(permissionGrantSchema, ["holderId", "id"], false),
    errors: [],
    rateClass: "read"
  }),
  "permissions.effective": defineOperation({
    id: "permissions.effective",
    method: "GET",
    path: "/api/v1/instance/access/effective",
    summary: "List what one holder is allowed and denied, with the source of each entry",
    tag: "Access",
    auth: "user",
    scope: "user_admin:read",
    // Holder-specific authorization is checked by the handler.
    requires: [],
    effect: "reading",
    query: effectivePermissionsQuerySchema,
    response: json(effectivePermissionsSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "permissions.rights": defineOperation({
    id: "permissions.rights",
    method: "GET",
    path: "/api/v1/instance/access/rights",
    summary:
      "List what one holder holds and is refused, each right decided with where it comes from",
    tag: "Access",
    auth: "user",
    scope: "user_admin:read",
    // The read of `permissions.effective`: one's own, or another holder's behind the right
    // to administer them. The handler checks it.
    requires: [],
    effect: "reading",
    query: effectivePermissionsQuerySchema,
    response: json(holderRightsSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "permissions.check": defineOperation({
    id: "permissions.check",
    method: "GET",
    path: "/api/v1/instance/access/check",
    summary: "Decide what one holder may do with one asset, with the entry that decides each right",
    tag: "Access",
    auth: "user",
    scope: "user_admin:read",
    // The read of `permissions.effective`: one's own, or another holder's behind the right
    // to administer them. The handler checks it.
    requires: [],
    effect: "reading",
    query: assetRightsCheckQuerySchema,
    response: json(assetRightsCheckSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "workspaces.limits.list": defineOperation({
    id: "workspaces.limits.list",
    method: "GET",
    path: "/api/v1/instance/access/workspaces",
    summary: "List the Shared Workspaces with the tools and model bindings their agents may use",
    tag: "Access",
    auth: "user",
    scope: "user_admin:read",
    requires: ["users.manage"],
    effect: "reading",
    query: listQuerySchema,
    response: page(workspaceBuildLimitsSchema, ["id"], false),
    errors: [],
    rateClass: "read"
  }),
  "workspaces.limits.update": defineRegisteredOperation({
    id: "workspaces.limits.update",
    method: "PATCH",
    path: "/api/v1/instance/access/workspaces/:collaborationWorkspaceId",
    summary: "Change the tools and model bindings the agents of a Shared Workspace may use",
    tag: "Access",
    auth: "user",
    scope: "user_admin:write",
    requires: ["users.manage"],
    effect: "changing",
    body: updateWorkspaceBuildLimitsRequestSchema,
    response: json(workspaceBuildLimitsSchema),
    errors: ["NOT_FOUND"],
    rateClass: "write"
  })
} as const;
