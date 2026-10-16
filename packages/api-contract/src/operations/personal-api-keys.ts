import { z } from "zod";
import { listQuerySchema } from "../shared";
import {
  confirmConnectCodeRequestSchema,
  connectCodeSchema,
  createPersonalApiKeyRequestSchema,
  createPersonalApiKeyResponseSchema,
  personalApiKeySchema,
  redeemConnectCodeRequestSchema,
  redeemConnectCodeResponseSchema,
  startConnectCodeRequestSchema,
  startConnectCodeResponseSchema
} from "../personal-api-keys";
import { defineOperation, defineRegisteredOperation, json, page } from "./define-operation";

const confirmedConnectCodeSchema = z.object({ confirmed: z.literal(true) });

/**
 * Personal API keys, of the module `personalApiKeys`. A person issues and revokes their own in
 * Settings, or confirms the code the CLI shows; the CLI starts the code and collects the key
 * without being signed in. A key acts as its owner, narrowed to its scopes. Its calls carry no
 * `me:write`, so no key issues another key or confirms a code. Whoever holds
 * `api_access.manage` sees and revokes every person's keys.
 */
export const personalApiKeyOperations = {
  "me.api_keys.list": defineOperation({
    id: "me.api_keys.list",
    method: "GET",
    path: "/api/v1/me/api-keys",
    summary: "List the signed-in user's personal API keys, newest first",
    tag: "Personal API Keys",
    auth: "user",
    scope: "me:read",
    requires: [],
    effect: "reading",
    query: listQuerySchema,
    response: page(personalApiKeySchema, ["createdAt", "id"], true),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "me.api_keys.create": defineRegisteredOperation({
    id: "me.api_keys.create",
    method: "POST",
    path: "/api/v1/me/api-keys",
    summary: "Issue a personal API key that acts as the signed-in user, narrowed to its scopes",
    tag: "Personal API Keys",
    auth: "user",
    scope: "me:write",
    requires: [],
    effect: "changing",
    // The answer is the key, shown once.
    secret: true,
    body: createPersonalApiKeyRequestSchema,
    response: json(createPersonalApiKeyResponseSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "me.api_keys.revoke": defineRegisteredOperation({
    id: "me.api_keys.revoke",
    method: "POST",
    path: "/api/v1/me/api-keys/:keyId/revoke",
    summary: "Revoke one of the signed-in user's personal API keys; its next call is refused",
    tag: "Personal API Keys",
    auth: "user",
    scope: "me:write",
    requires: [],
    effect: "changing",
    response: json(personalApiKeySchema),
    errors: ["NOT_FOUND"],
    rateClass: "write"
  }),
  "me.connect_codes.get": defineOperation({
    id: "me.connect_codes.get",
    method: "GET",
    path: "/api/v1/me/connect-codes/:userCode",
    summary: "Read the connect code a CLI shows, before confirming it",
    tag: "Personal API Keys",
    auth: "user",
    scope: "me:read",
    requires: [],
    effect: "reading",
    response: json(connectCodeSchema),
    errors: ["NOT_FOUND"],
    // Counted per person like a sign-in: a code is short, and guessing one is the attack.
    rateClass: "auth"
  }),
  "me.connect_codes.confirm": defineRegisteredOperation({
    id: "me.connect_codes.confirm",
    method: "POST",
    path: "/api/v1/me/connect-codes/:userCode/confirm",
    summary: "Confirm a CLI's connect code: the CLI collects a personal API key of these scopes",
    tag: "Personal API Keys",
    auth: "user",
    scope: "me:write",
    requires: [],
    effect: "changing",
    body: confirmConnectCodeRequestSchema,
    response: json(confirmedConnectCodeSchema),
    errors: ["NOT_FOUND"],
    rateClass: "auth"
  }),
  "connect_codes.start": defineOperation({
    id: "connect_codes.start",
    method: "POST",
    path: "/api/v1/auth/connect-codes",
    summary: "Start a connect code for the CLI; a person confirms it in Settings",
    tag: "Personal API Keys",
    auth: "public",
    effect: "changing",
    body: startConnectCodeRequestSchema,
    response: json(startConnectCodeResponseSchema),
    errors: ["NOT_FOUND"],
    rateClass: "auth"
  }),
  "connect_codes.redeem": defineOperation({
    id: "connect_codes.redeem",
    method: "POST",
    path: "/api/v1/auth/connect-codes/redeem",
    summary: "Collect the personal API key of a confirmed connect code, once",
    tag: "Personal API Keys",
    auth: "public",
    effect: "changing",
    body: redeemConnectCodeRequestSchema,
    response: json(redeemConnectCodeResponseSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "auth"
  }),
  "personal_api_keys.list": defineOperation({
    id: "personal_api_keys.list",
    method: "GET",
    path: "/api/v1/instance/personal-api-keys",
    summary: "List every person's personal API keys, newest first",
    tag: "Personal API Keys",
    auth: "user",
    scope: "api_access:read",
    requires: ["api_access.manage"],
    effect: "reading",
    query: listQuerySchema,
    response: page(personalApiKeySchema, ["createdAt", "id"], true),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "personal_api_keys.revoke": defineRegisteredOperation({
    id: "personal_api_keys.revoke",
    method: "POST",
    path: "/api/v1/instance/personal-api-keys/:keyId/revoke",
    summary: "Revoke any person's personal API key; its next call is refused",
    tag: "Personal API Keys",
    auth: "user",
    scope: "api_access:write",
    requires: ["api_access.manage"],
    effect: "changing",
    response: json(personalApiKeySchema),
    errors: ["NOT_FOUND"],
    rateClass: "write"
  })
} as const;
