import { z } from "zod";
import {
  createRoleRequestSchema,
  decideRolePendingActionRequestSchema,
  roleSchema,
  updateRoleRequestSchema
} from "../access";
import { defineOperation, defineRegisteredOperation, json } from "./define-operation";

// Roles as data (ADR-0028). The five changing operations are operations of the registry. The
// rule is more than one right: `users.manage`, and only a superadmin edits, resets or decides
// for a built-in role or hands out a right only a superadmin gives. Each checks it itself.

export const roleOperations = {
  "roles.list": defineOperation({
    id: "roles.list",
    method: "GET",
    path: "/api/v1/instance/access/roles",
    summary:
      "List the roles of the instance: the three built-in ones, then the custom roles by name, each with its grants",
    tag: "Access",
    auth: "user",
    scope: "user_admin:read",
    requires: ["users.manage"],
    effect: "reading",
    response: json(z.object({ items: z.array(roleSchema) })),
    errors: [],
    rateClass: "read"
  }),
  "roles.get": defineOperation({
    id: "roles.get",
    method: "GET",
    path: "/api/v1/instance/access/roles/:roleId",
    summary:
      "Read one role with its grants; a built-in one with the release's default and the actions waiting for a decision",
    tag: "Access",
    auth: "user",
    scope: "user_admin:read",
    requires: ["users.manage"],
    effect: "reading",
    response: json(roleSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "roles.create": defineRegisteredOperation({
    id: "roles.create",
    method: "POST",
    path: "/api/v1/instance/access/roles",
    summary:
      "Create a custom role with its grants. Needs `users.manage` and every right it gives; only a superadmin gives a right only a superadmin hands out.",
    tag: "Access",
    auth: "user",
    scope: "user_admin:write",
    requires: [],
    effect: "changing",
    body: createRoleRequestSchema,
    response: json(roleSchema),
    errors: ["CONFLICT"],
    rateClass: "write"
  }),
  "roles.update": defineRegisteredOperation({
    id: "roles.update",
    method: "PATCH",
    path: "/api/v1/instance/access/roles/:roleId",
    summary:
      "Change a role's name, description or grants. Only a superadmin edits `user` and `admin`; `superadmin` is never edited.",
    tag: "Access",
    auth: "user",
    scope: "user_admin:write",
    requires: [],
    effect: "changing",
    body: updateRoleRequestSchema,
    response: json(roleSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "roles.delete": defineRegisteredOperation({
    id: "roles.delete",
    method: "DELETE",
    path: "/api/v1/instance/access/roles/:roleId",
    summary:
      "Delete a custom role that nobody holds. Built-in roles are never deleted; `user` and `admin` are reset instead.",
    tag: "Access",
    auth: "user",
    scope: "user_admin:write",
    requires: [],
    effect: "changing",
    response: json(roleSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "roles.reset": defineRegisteredOperation({
    id: "roles.reset",
    method: "POST",
    path: "/api/v1/instance/access/roles/:roleId/reset",
    summary:
      "Reset `user` or `admin` to the release's default, which also settles every pending action. Only a superadmin resets.",
    tag: "Access",
    auth: "user",
    scope: "user_admin:write",
    requires: [],
    effect: "changing",
    response: json(roleSchema),
    errors: ["NOT_FOUND"],
    rateClass: "write"
  }),
  "roles.pending.decide": defineRegisteredOperation({
    id: "roles.pending.decide",
    method: "POST",
    path: "/api/v1/instance/access/roles/:roleId/pending",
    summary:
      "Decide one action a release changed in the default of an edited `user` or `admin`: apply it or dismiss it. Only a superadmin decides.",
    tag: "Access",
    auth: "user",
    scope: "user_admin:write",
    requires: [],
    effect: "changing",
    body: decideRolePendingActionRequestSchema,
    response: json(roleSchema),
    errors: ["NOT_FOUND"],
    rateClass: "write"
  })
} as const;
