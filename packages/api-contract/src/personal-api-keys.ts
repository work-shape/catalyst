import { z } from "zod";
import { timestampSchema } from "./shared";

/**
 * A scope of a personal API key: an action such as `agent.write`, optionally limited to what
 * one workspace owns, `agent.write:<workspace id>`, or to one asset in it,
 * `agent.write:<workspace id>/<name>`. The instance refuses any other text when a key is
 * issued, and a workspace it does not have.
 */
export const personalApiKeyScopeSchema = z.string().min(1).max(200);

export const personalApiKeySchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  /** The owner's name, in the instance's list of every person's keys. */
  ownerDisplayLabel: z.string().optional(),
  name: z.string(),
  /** The start of the key, which a person compares with the key they hold. Never the key. */
  keyPrefix: z.string(),
  scopes: z.array(personalApiKeyScopeSchema),
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
  revokedAt: timestampSchema.optional(),
  lastUsedAt: timestampSchema.optional()
});

const keyFieldsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(personalApiKeyScopeSchema).min(1).max(64),
  /** At most a year ahead. */
  expiresAt: timestampSchema
});

export const createPersonalApiKeyRequestSchema = keyFieldsSchema;

export const createPersonalApiKeyResponseSchema = z.object({
  key: personalApiKeySchema,
  /** The key, shown this once. Only its hash is stored. */
  secret: z.string()
});

export const startConnectCodeRequestSchema = z.object({
  /** What the CLI calls itself, shown to the person who confirms. Attribution, never authority. */
  clientLabel: z.string().trim().min(1).max(100).optional()
});

export const startConnectCodeResponseSchema = z.object({
  /** The code the person confirms in Settings, as `ABCD-EFGH`. */
  userCode: z.string(),
  /** The CLI's own code to collect the key with. It never leaves the CLI. */
  deviceCode: z.string(),
  expiresAt: timestampSchema,
  /** How long the CLI waits between two collection tries. */
  intervalSeconds: z.number().int().positive(),
  /** Where the person confirms the code, relative to the interface's address. */
  confirmPath: z.string()
});

export const redeemConnectCodeRequestSchema = z.object({
  deviceCode: z.string().min(1).max(200)
});

export const redeemConnectCodeResponseSchema = z.discriminatedUnion("status", [
  /** Not yet confirmed: try again after the interval. */
  z.object({ status: z.literal("pending") }),
  z.object({
    status: z.literal("issued"),
    key: personalApiKeySchema,
    /** The key, answered this once. Only its hash is stored. */
    secret: z.string()
  })
]);

export const connectCodeSchema = z.object({
  clientLabel: z.string().optional(),
  createdAt: timestampSchema,
  expiresAt: timestampSchema
});

export const confirmConnectCodeRequestSchema = keyFieldsSchema;

export type PersonalApiKey = z.infer<typeof personalApiKeySchema>;
export type CreatePersonalApiKeyRequest = z.infer<typeof createPersonalApiKeyRequestSchema>;
export type CreatePersonalApiKeyResponse = z.infer<typeof createPersonalApiKeyResponseSchema>;
export type StartConnectCodeResponse = z.infer<typeof startConnectCodeResponseSchema>;
export type RedeemConnectCodeResponse = z.infer<typeof redeemConnectCodeResponseSchema>;
export type ConnectCode = z.infer<typeof connectCodeSchema>;
export type ConfirmConnectCodeRequest = z.infer<typeof confirmConnectCodeRequestSchema>;
