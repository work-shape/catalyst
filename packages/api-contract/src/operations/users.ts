import { listQuerySchema } from "../shared";
import {
  administeredUserSchema,
  createAdministeredUserRequestSchema,
  resetAdministeredUserPasswordRequestSchema,
  resetAdministeredUserPasswordResponseSchema,
  resetAdministeredUserTwoFactorResponseSchema,
  sendAdministeredUserInvitationResponseSchema,
  updateAdministeredUserRequestSchema,
  userDeletionStateSchema,
  upsertAdministeredUserIdentityRequestSchema
} from "../identity";
import { defineOperation, defineRegisteredOperation, json, page } from "./define-operation";

// The seven changing operations ask for `users.manage` and for the superadmin rules; deleting a
// user asks for `users.delete` as well.
// The rule is more than one right, so each operation checks it itself and requires none.
export const userOperations = {
  "users.list": defineOperation({
    id: "users.list",
    method: "GET",
    path: "/api/v1/instance/users",
    summary: "List the users of the instance",
    tag: "Users",
    auth: "user",
    scope: "user_admin:read",
    requires: ["users.manage"],
    effect: "reading",
    query: listQuerySchema,
    response: page(administeredUserSchema, ["displayLabel", "id"], false),
    errors: [],
    rateClass: "read"
  }),
  "users.create": defineRegisteredOperation({
    id: "users.create",
    method: "POST",
    path: "/api/v1/instance/users",
    summary:
      "Create a user. Needs the right `users.manage`. Only a superadmin gives the superadmin role or a right only a superadmin assigns.",
    tag: "Users",
    auth: "user",
    scope: "user_admin:write",
    requires: [],
    effect: "changing",
    body: createAdministeredUserRequestSchema,
    response: json(administeredUserSchema),
    errors: ["CONFLICT"],
    rateClass: "write"
  }),
  "users.update": defineRegisteredOperation({
    id: "users.update",
    method: "PATCH",
    path: "/api/v1/instance/users/:userId",
    summary:
      "Change a user's profile, roles or status. Needs the right `users.manage`. Only a superadmin changes a superadmin, gives the superadmin role or gives or takes a right only a superadmin assigns.",
    tag: "Users",
    auth: "user",
    scope: "user_admin:write",
    requires: [],
    effect: "changing",
    body: updateAdministeredUserRequestSchema,
    response: json(administeredUserSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "users.delete": defineRegisteredOperation({
    id: "users.delete",
    method: "DELETE",
    path: "/api/v1/instance/users/:userId",
    summary:
      "Delete a user and their data. Answers `deleted`, or `deleting` while the data is still being removed. Needs the rights `users.manage` and `users.delete`, and every right the user holds. Only a superadmin deletes a superadmin.",
    tag: "Users",
    auth: "user",
    scope: "user_admin:write",
    requires: [],
    effect: "changing",
    response: json(userDeletionStateSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "users.identities.upsert": defineRegisteredOperation({
    id: "users.identities.upsert",
    method: "PUT",
    path: "/api/v1/instance/users/:userId/identities",
    summary:
      "Link a sign-in identity to a user. Needs the right `users.manage`. Only a superadmin changes a superadmin.",
    tag: "Users",
    auth: "user",
    scope: "user_admin:write",
    requires: [],
    effect: "changing",
    body: upsertAdministeredUserIdentityRequestSchema,
    response: json(administeredUserSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "users.password.reset": defineRegisteredOperation({
    id: "users.password.reset",
    method: "POST",
    path: "/api/v1/instance/users/:userId/password",
    summary:
      "Set a user's password. Needs the right `users.manage`. Only a superadmin changes a superadmin.",
    tag: "Users",
    auth: "user",
    scope: "user_admin:write",
    requires: [],
    effect: "changing",
    // The call sets a password. The run keeps no answer and the call never waits.
    secret: true,
    body: resetAdministeredUserPasswordRequestSchema,
    response: json(resetAdministeredUserPasswordResponseSchema),
    errors: ["NOT_FOUND"],
    rateClass: "write"
  }),
  "users.two_factor.reset": defineRegisteredOperation({
    id: "users.two_factor.reset",
    method: "POST",
    path: "/api/v1/instance/users/:userId/two-factor/reset",
    summary:
      "Reset a user's two-factor sign-in: delete their second factor and trusted browsers and end their sessions. Needs the right `users.manage`. Only a superadmin resets a superadmin; nobody resets their own.",
    tag: "Users",
    auth: "user",
    scope: "user_admin:write",
    requires: [],
    effect: "changing",
    response: json(resetAdministeredUserTwoFactorResponseSchema),
    errors: ["NOT_FOUND"],
    rateClass: "write"
  }),
  "users.invitation.send": defineRegisteredOperation({
    id: "users.invitation.send",
    method: "POST",
    path: "/api/v1/instance/users/:userId/invitation",
    summary:
      "Mail a user a link to set their password. Needs the right `users.manage`. Only a superadmin invites a superadmin.",
    tag: "Users",
    auth: "user",
    scope: "user_admin:write",
    requires: [],
    effect: "changing",
    response: json(sendAdministeredUserInvitationResponseSchema),
    errors: ["NOT_FOUND"],
    rateClass: "write"
  }),
  "users.identities.delete": defineRegisteredOperation({
    id: "users.identities.delete",
    method: "DELETE",
    path: "/api/v1/instance/users/:userId/identities/:authSource/:externalUserId",
    summary:
      "Unlink a sign-in identity from a user. Needs the right `users.manage`. Only a superadmin changes a superadmin.",
    tag: "Users",
    auth: "user",
    scope: "user_admin:write",
    requires: [],
    effect: "changing",
    response: json(administeredUserSchema),
    errors: ["NOT_FOUND"],
    rateClass: "write"
  })
} as const;
