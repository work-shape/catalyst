import { listQuerySchema } from "../shared";
import {
  apiCredentialSchema,
  createApiCredentialRequestSchema,
  createApiCredentialResponseSchema,
  createServicePrincipalRequestSchema,
  servicePrincipalDetailSchema,
  updateServicePrincipalRequestSchema
} from "../identity";
import { defineOperation, defineRegisteredOperation, json, page } from "./define-operation";

// A service principal is administered under `service_principals.manage`, its keys under
// `api_access.manage`. Whatever a change gives a principal, or lends it by enabling it or
// issuing it a key, the caller must hold too. The rule is more than one right, so each
// changing operation checks it itself and requires none.
export const apiAccessOperations = {
  "service_principals.list": defineOperation({
    id: "service_principals.list",
    method: "GET",
    path: "/api/v1/instance/service-principals",
    summary: "List service principals with their credentials",
    tag: "API Access",
    auth: "user",
    scope: "api_access:read",
    requires: ["service_principals.manage"],
    effect: "reading",
    query: listQuerySchema,
    response: page(servicePrincipalDetailSchema, ["principal.displayLabel", "principal.id"], false),
    errors: [],
    rateClass: "read"
  }),
  "service_principals.create": defineRegisteredOperation({
    id: "service_principals.create",
    method: "POST",
    path: "/api/v1/instance/service-principals",
    summary: "Create a service principal",
    tag: "API Access",
    auth: "user",
    scope: "api_access:write",
    requires: [],
    effect: "changing",
    body: createServicePrincipalRequestSchema,
    response: json(servicePrincipalDetailSchema),
    errors: [],
    rateClass: "write"
  }),
  "service_principals.update": defineRegisteredOperation({
    id: "service_principals.update",
    method: "PATCH",
    path: "/api/v1/instance/service-principals/:servicePrincipalId",
    summary: "Change a service principal",
    tag: "API Access",
    auth: "user",
    scope: "api_access:write",
    requires: [],
    effect: "changing",
    body: updateServicePrincipalRequestSchema,
    response: json(servicePrincipalDetailSchema),
    errors: ["NOT_FOUND"],
    rateClass: "write"
  }),
  "api_credentials.create": defineRegisteredOperation({
    id: "api_credentials.create",
    method: "POST",
    path: "/api/v1/instance/service-principals/:servicePrincipalId/credentials",
    summary: "Issue an API key for a service principal",
    tag: "API Access",
    auth: "user",
    scope: "api_access:write",
    requires: [],
    effect: "changing",
    // The answer is the key, shown once.
    secret: true,
    body: createApiCredentialRequestSchema,
    response: json(createApiCredentialResponseSchema),
    errors: ["NOT_FOUND"],
    rateClass: "write"
  }),
  "api_credentials.revoke": defineRegisteredOperation({
    id: "api_credentials.revoke",
    method: "POST",
    path: "/api/v1/instance/api-credentials/:credentialId/revoke",
    summary: "Revoke an API key",
    tag: "API Access",
    auth: "user",
    scope: "api_access:write",
    requires: [],
    effect: "changing",
    response: json(apiCredentialSchema),
    errors: ["NOT_FOUND"],
    rateClass: "write"
  })
} as const;
