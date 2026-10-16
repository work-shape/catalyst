import {
  exchangeApiKeyResponseSchema,
  issueSessionTokenRequestSchema,
  issueSessionTokenResponseSchema
} from "../identity";
import { defineOperation, json } from "./define-operation";

export const credentialOperations = {
  "session_tokens.issue": defineOperation({
    id: "session_tokens.issue",
    method: "POST",
    path: "/api/v1/instance/session-tokens",
    summary: "Issue a session token for a user of a trusted backend",
    tag: "Credentials",
    auth: "serverCredential",
    effect: "changing",
    body: issueSessionTokenRequestSchema,
    response: json(issueSessionTokenResponseSchema),
    errors: ["NOT_FOUND"],
    // Counted per server credential: a host backend issues tokens for all of its users.
    rateClass: "read"
  }),
  "access_tokens.exchange": defineOperation({
    id: "access_tokens.exchange",
    method: "POST",
    path: "/api/v1/auth/access-token",
    summary: "Exchange an API key for a short-lived access token",
    tag: "Credentials",
    auth: "public",
    credential: "apiKey",
    effect: "changing",
    response: json(exchangeApiKeyResponseSchema),
    errors: ["NOT_FOUND"],
    rateClass: "auth"
  })
} as const;
