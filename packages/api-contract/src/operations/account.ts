import { z } from "zod";
import { userModelPreferenceSchema } from "../configuration";
import {
  apiUserSchema,
  changeCurrentUserPasswordRequestSchema,
  changeCurrentUserPasswordResponseSchema,
  completePasswordSetupRequestSchema,
  completePasswordSetupResponseSchema,
  deleteCurrentUserResponseSchema,
  requestPasswordResetRequestSchema,
  requestPasswordResetResponseSchema,
  updateCurrentUserRequestSchema
} from "../identity";
import {
  operationSettingSchema,
  operationSettingsSchema,
  setOperationSettingRequestSchema
} from "../operation-settings";
import { ownUsageQuerySchema, ownUsageSchema } from "../usage-limits";
import { defineOperation, defineRegisteredOperation, json } from "./define-operation";

export const accountOperations = {
  "me.get": defineOperation({
    id: "me.get",
    method: "GET",
    path: "/api/v1/me",
    summary: "Read the signed-in user with effective permissions",
    tag: "Account",
    auth: "user",
    scope: "me:read",
    requires: [],
    effect: "reading",
    response: json(apiUserSchema),
    errors: [],
    rateClass: "read"
  }),
  "me.update": defineOperation({
    id: "me.update",
    method: "PATCH",
    path: "/api/v1/me",
    summary: "Change the signed-in user's profile",
    tag: "Account",
    auth: "user",
    scope: "me:write",
    requires: [],
    effect: "changing",
    body: updateCurrentUserRequestSchema,
    response: json(apiUserSchema),
    errors: [],
    rateClass: "write"
  }),
  // A person's own confirmation settings (OP-6). Only the person reads and sets their own, in
  // the interface: no personal key carries them, and no agent is given them as a tool.
  "me.usage.get": defineOperation({
    id: "me.usage.get",
    method: "GET",
    path: "/api/v1/me/usage",
    summary:
      "Read the signed-in user's own spend this day and month against their limit, and whether a workspace or the instance limit stops them",
    tag: "Account",
    auth: "user",
    scope: "me:read",
    requires: [],
    effect: "reading",
    query: ownUsageQuerySchema,
    response: json(ownUsageSchema),
    errors: [],
    rateClass: "read"
  }),
  "me.operation_settings.list": defineOperation({
    id: "me.operation_settings.list",
    method: "GET",
    path: "/api/v1/me/operation-settings",
    summary:
      "List the signed-in user's own confirmation settings and the operations their agents called lately",
    tag: "Account",
    auth: "user",
    scope: "me:read",
    requires: [],
    effect: "reading",
    response: json(operationSettingsSchema),
    errors: [],
    rateClass: "read"
  }),
  "me.operation_settings.set": defineRegisteredOperation({
    id: "me.operation_settings.set",
    method: "PUT",
    path: "/api/v1/me/operation-settings",
    summary:
      "Set the signed-in user's own value for an operation: Always allow, Ask me or Never, or none",
    tag: "Account",
    auth: "user",
    scope: "me:write",
    requires: [],
    effect: "changing",
    body: setOperationSettingRequestSchema,
    response: json(operationSettingSchema),
    errors: [],
    rateClass: "write"
  }),
  "me.model_preference.get": defineOperation({
    id: "me.model_preference.get",
    method: "GET",
    path: "/api/v1/me/model-preference",
    summary: "Read the signed-in user's model preference",
    tag: "Account",
    auth: "user",
    scope: "me:read",
    requires: [],
    effect: "reading",
    response: json(userModelPreferenceSchema),
    errors: [],
    rateClass: "read"
  }),
  "me.model_preference.set": defineOperation({
    id: "me.model_preference.set",
    method: "PUT",
    path: "/api/v1/me/model-preference",
    summary: "Replace the signed-in user's model preference",
    tag: "Account",
    auth: "user",
    scope: "me:write",
    requires: [],
    effect: "changing",
    body: userModelPreferenceSchema,
    response: json(userModelPreferenceSchema),
    errors: [],
    rateClass: "write"
  }),
  "me.password.change": defineOperation({
    id: "me.password.change",
    method: "POST",
    path: "/api/v1/me/password",
    summary: "Change the signed-in user's password",
    tag: "Account",
    auth: "user",
    scope: "me:write",
    requires: [],
    effect: "changing",
    body: changeCurrentUserPasswordRequestSchema,
    response: json(changeCurrentUserPasswordResponseSchema),
    errors: [],
    rateClass: "auth"
  }),
  "me.delete": defineOperation({
    id: "me.delete",
    method: "DELETE",
    path: "/api/v1/me",
    summary:
      "Delete the signed-in user's account and data. Answers 202 when the account is closed and its data is still being removed.",
    tag: "Account",
    auth: "user",
    scope: "me:delete",
    requires: [],
    effect: "changing",
    response: json(deleteCurrentUserResponseSchema),
    deferred: true,
    errors: [],
    rateClass: "write"
  }),
  "password_reset.request": defineOperation({
    id: "password_reset.request",
    method: "POST",
    path: "/api/v1/password-reset",
    summary: "Send a password reset mail to a locked-out user",
    tag: "Account",
    auth: "public",
    effect: "changing",
    query: z.object({ locale: z.string().optional() }),
    body: requestPasswordResetRequestSchema,
    response: json(requestPasswordResetResponseSchema),
    errors: [],
    rateClass: "auth"
  }),
  "password_setup.complete": defineOperation({
    id: "password_setup.complete",
    method: "POST",
    path: "/api/v1/password-setup",
    summary: "Set a password with a setup or reset token",
    tag: "Account",
    auth: "public",
    effect: "changing",
    body: completePasswordSetupRequestSchema,
    response: json(completePasswordSetupResponseSchema),
    errors: [],
    rateClass: "auth"
  })
} as const;
