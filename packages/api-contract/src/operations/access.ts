import { listQuerySchema } from "../shared";
import {
  createNamespaceRequestSchema,
  createPermissionGrantRequestSchema,
  effectivePermissionsQuerySchema,
  effectivePermissionsSchema,
  listPermissionGrantsQuerySchema,
  namespaceSchema,
  namespaceUsageSchema,
  permissionGrantSchema,
  updateNamespaceRequestSchema
} from "../access";
import { defineOperation, defineRegisteredOperation, json, page } from "./define-operation";

// The five changing operations are operations of the registry: a call is an Operation Run.
// The three reads are plain.

export const accessOperations = {
  "permissions.grant": defineRegisteredOperation({
    id: "permissions.grant",
    method: "POST",
    path: "/api/v1/instance/access/grants",
    summary:
      "Allow or deny a user an action in a Namespace or on one asset, or allow a service principal a use right on one asset",
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
  "namespaces.create": defineRegisteredOperation({
    id: "namespaces.create",
    method: "POST",
    path: "/api/v1/instance/access/namespaces",
    summary: "Register a name prefix as a Namespace",
    tag: "Access",
    auth: "user",
    scope: "user_admin:write",
    requires: ["users.manage"],
    effect: "changing",
    body: createNamespaceRequestSchema,
    response: json(namespaceSchema),
    errors: ["CONFLICT"],
    rateClass: "write"
  }),
  "namespaces.update": defineRegisteredOperation({
    id: "namespaces.update",
    method: "PATCH",
    path: "/api/v1/instance/access/namespaces/:prefix",
    summary: "Change a Namespace's display name and its tool and model lists",
    tag: "Access",
    auth: "user",
    scope: "user_admin:write",
    requires: ["users.manage"],
    effect: "changing",
    body: updateNamespaceRequestSchema,
    response: json(namespaceSchema),
    errors: ["NOT_FOUND"],
    rateClass: "write"
  }),
  "namespaces.list": defineOperation({
    id: "namespaces.list",
    method: "GET",
    path: "/api/v1/instance/access/namespaces",
    summary: "List Namespaces with the grants and assets each one covers",
    tag: "Access",
    auth: "user",
    scope: "user_admin:read",
    requires: ["users.manage"],
    effect: "reading",
    query: listQuerySchema,
    response: page(namespaceUsageSchema, ["prefix"], false),
    errors: [],
    rateClass: "read"
  }),
  "namespaces.delete": defineRegisteredOperation({
    id: "namespaces.delete",
    method: "DELETE",
    path: "/api/v1/instance/access/namespaces/:prefix",
    summary: "Delete a Namespace that no grant row names",
    tag: "Access",
    auth: "user",
    scope: "user_admin:write",
    requires: ["users.manage"],
    effect: "changing",
    response: json(namespaceSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  })
} as const;
