import {
  CATALOGUE_CATEGORIES,
  CATALOGUE_PARTS,
  PUBLISHED_DATA_CONSUMER_KINDS,
  CONNECTION_BINDING_STATES,
  GRANT_HOLDER_KINDS,
  CONNECTION_EXPOSURES,
  CONNECTION_HEALTH_STATES,
  CONNECTION_NAME_MAX_LENGTH,
  CONNECTION_NAME_PATTERN,
  CONNECTION_OAUTH_REGISTRATIONS,
  CONNECTION_OPERATION_STATUSES,
  CONNECTION_PROVIDER_REVOCATIONS,
  CONNECTION_SECRET_STATES,
  CONNECTOR_TEST_STATUSES,
  operationPagingSchema,
  OPERATION_EFFECTS
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { timestampSchema } from "../shared";
import { defineRegisteredOperation, json, redirect } from "./define-operation";

// What a Connection's page and an agent's editor read beyond the asset itself, and the test
// of a Connection. The asset, with name, settings and accepted operations, is read through
// `assets.get`. Nothing here answers a secret, a handle of one, or data of the outside system.

/** The longest secret a write takes. The Secret Store counts its bytes again. */
const SECRET_VALUE_MAX_CHARS = 16 * 1024;

/** How long the description of an operation is at most as these answers carry it. */
export const CONNECTION_OPERATION_DESCRIPTION_MAX_CHARS = 4_000;

const connectionNameSchema = z
  .string()
  .max(CONNECTION_NAME_MAX_LENGTH)
  .regex(CONNECTION_NAME_PATTERN);

const connectionOperationEffectSchema = z.enum(OPERATION_EFFECTS);

export const connectionOperationStatusSchema = z.enum(CONNECTION_OPERATION_STATUSES);

/** What anybody may learn of a Connection's secret: whether there is one, and its version. */
export const connectionSecretStateSchema = z.object({
  state: z.enum(CONNECTION_SECRET_STATES),
  version: z.number().int().optional()
});

export const connectionOperationDetailSchema = z.object({
  paging: operationPagingSchema.optional(),
  name: z.string(),
  /** The name an agent, an App and a Workflow hold: `connection.<name>.<operation>`. */
  toolName: z.string(),
  effect: connectionOperationEffectSchema,
  exposure: z.array(z.enum(CONNECTION_EXPOSURES)),
  enabled: z.boolean(),
  status: connectionOperationStatusSchema,
  /** As the outside system or the release describes it. Untrusted text, shown as text. */
  description: z.string().max(CONNECTION_OPERATION_DESCRIPTION_MAX_CHARS).optional(),
  /**
   * The bounded declaration read from the catalog; untrusted data, never instructions. With
   * `needs_review` it is the newly read one, which no call runs on until it is accepted.
   */
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  /** Only with status `needs_review`: the fingerprint to accept in the Connection's config. */
  discoveredFingerprint: z.string().optional(),
  /**
   * Only with status `unknown`: the stored schema of the operation is over a bound of the
   * platform, named by its code, such as `schema_too_many_patterns`.
   */
  schemaRefusal: z.string().optional()
});

/**
 * A tool the last discovery read that the Connection does not accept. It is callable by
 * nobody until a write of the Connection accepts it, with the fingerprint shown here.
 */
const connectionDiscoveredToolSchema = z.object({
  name: z.string(),
  /** As the outside system describes it. Untrusted text, shown as text. */
  description: z.string().max(CONNECTION_OPERATION_DESCRIPTION_MAX_CHARS).optional(),
  /** What the outside system's hint proposes. The accepted list decides. */
  proposedEffect: connectionOperationEffectSchema,
  fingerprint: z.string()
});

/**
 * The shared sign-in of a Connection that signs in with OAuth, where one was made for its
 * address. It holds no token: those stay in the Secret Store.
 */
const connectionBindingSchema = z.object({
  state: z.enum(CONNECTION_BINDING_STATES),
  /** The account as the provider reports it, where it reports one. */
  account: z.string().optional(),
  /** The scopes the provider granted. */
  scopes: z.array(z.string()),
  connectedAt: timestampSchema,
  /** The id of the person who signed in. */
  connectedBy: z.string().optional(),
  /** The day of the last call that used the sign-in, `YYYY-MM-DD`. */
  lastUsedOn: z.string().optional(),
  accessExpiresAt: timestampSchema.optional(),
  /** Why the sign-in left `connected`, as a reason code. */
  reason: z.string().optional()
});

/** How a Connection that signs in with OAuth is registered at its provider. */
const connectionOAuthSchema = z.object({
  /** `preregistered` where the settings name the client id the provider issued. */
  registration: z.enum(CONNECTION_OAUTH_REGISTRATIONS),
  /**
   * The address the provider sends the browser back to. A pre-registered client needs it
   * entered at the provider. Missing while release config sets no `instance.publicUrl`.
   */
  redirectUri: z.string().optional(),
  /** The host of the authorization server a registration was made at. */
  providerHost: z.string().optional()
});

export const connectionDetailSchema = z.object({
  name: z.string(),
  health: z.enum(CONNECTION_HEALTH_STATES),
  lastTestedAt: timestampSchema.optional(),
  lastErrorCode: z.string().optional(),
  secret: connectionSecretStateSchema,
  /** One credential for everyone who may use the Connection. The page says so. */
  sharedCredential: z.boolean(),
  operations: z.array(connectionOperationDetailSchema),
  /** The tools the last discovery read and the Connection does not accept, by name. */
  discovered: z.array(connectionDiscoveredToolSchema),
  /** The agents that carry a tool of this Connection, each one the caller may read. */
  usedBy: z.array(
    z.object({ agentName: z.string(), title: z.string(), toolNames: z.array(z.string()) })
  ),
  /** Published consumers the caller may read or use. No draft content or hidden names. */
  usedByAssets: z
    .array(
      z.object({
        kind: z.enum(PUBLISHED_DATA_CONSUMER_KINDS),
        workspaceId: z.string().optional(),
        name: z.string(),
        title: z.string()
      })
    )
    .optional(),
  /** The published-asset scan reached its bound, so the list may be incomplete. */
  usedByAssetsTruncated: z.boolean().optional(),
  discoveredAt: timestampSchema.optional(),
  /** The shared sign-in, where one was made for the Connection's address. */
  binding: connectionBindingSchema.optional(),
  /** Only for a Connection whose auth scheme is `oauth`. */
  oauth: connectionOAuthSchema.optional()
});

/**
 * The start of a shared sign-in. `authorizationUrl` is opened in the person's browser; it is
 * kept nowhere. `providerHost` is the host the browser goes to and `scopes` what is asked for.
 */
export const connectionOAuthStartSchema = z.object({
  /** The sign-in, for `connections.oauth_sign_in`. It proves nothing and opens nothing. */
  signInId: z.string(),
  authorizationUrl: z.string().url(),
  providerHost: z.string(),
  scopes: z.array(z.string()),
  expiresAt: timestampSchema
});

/**
 * Whether a sign-in the caller started still waits for its callback. `ended` once a browser
 * came back with it, whatever the outcome, once it expired, and for a sign-in of someone else:
 * a sign-in that ended without connecting cannot be completed any more.
 */
export const connectionOAuthSignInSchema = z.object({
  state: z.enum(["waiting", "ended"])
});

/**
 * What Disconnect answers: the sign-in ended on the instance, and what the provider said to
 * the revocation of its grant.
 */
export const connectionDisconnectSchema = z.object({
  state: z.literal("revoked"),
  providerRevocation: z.enum(CONNECTION_PROVIDER_REVOCATIONS)
});

/**
 * What a provider sends the browser back with. Every field is the provider's and untrusted;
 * the call keeps none of them.
 */
const connectionOAuthCallbackQuerySchema = z.object({
  state: z.string().max(512).optional(),
  code: z.string().max(4096).optional(),
  error: z.string().max(256).optional(),
  error_description: z.string().max(2048).optional(),
  error_uri: z.string().max(2048).optional(),
  iss: z.string().max(2048).optional()
});

export const connectionTestResultSchema = z.object({
  status: z.enum(CONNECTOR_TEST_STATUSES),
  testedAt: timestampSchema
});

export const connectionToolSchema = z.object({
  toolName: z.string(),
  operation: z.string(),
  description: z.string().max(CONNECTION_OPERATION_DESCRIPTION_MAX_CHARS).optional(),
  effect: connectionOperationEffectSchema
});

/** The tools an agent may carry: agent-exposed, enabled and ready, by Connection. */
export const connectionToolsSchema = z.object({
  connections: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      /** The system behind the Connection, where it names one. It only picks an icon. */
      service: z.string().optional(),
      /** The Connector type. The interface shows the icon of its category without a `service`. */
      connectorType: z.string().optional(),
      tools: z.array(connectionToolSchema)
    })
  )
});

/** A text in the reader's language: one for every language, or one per language. */
const localizedTextSchema = z.union([
  z.string(),
  z.strictObject({ en: z.string().optional(), de: z.string().optional() })
]);

/**
 * The Connector types the New connection dialog offers beside an MCP server and a REST API,
 * each with its card and its form. A field fills a setting by its dotted path, or the secret.
 * `documentSource` says that a Knowledge Base can sync documents through such a Connection.
 */
export const connectorTypeOffersSchema = z.object({
  types: z.array(
    z.object({
      type: z.string(),
      title: localizedTextSchema,
      description: localizedTextSchema,
      service: z.string().optional(),
      documentSource: z.boolean(),
      authScheme: z.string(),
      settings: z.record(z.string(), z.unknown()),
      fields: z.array(
        z.object({
          label: localizedTextSchema,
          help: localizedTextSchema.optional(),
          optional: z.boolean(),
          setting: z.string().optional(),
          secret: z.boolean()
        })
      )
    })
  ),
  /**
   * The catalogue's entries (CAT-1): one card each in "Dienste". `offered` is false for one
   * the operator has not named, which is shown greyed and cannot be installed. A part lists the
   * operations it proposes; none of them is enabled before the admin confirms the review step.
   */
  entries: z
    .array(
      z.object({
        id: z.string(),
        version: z.number().int(),
        service: z.string(),
        title: localizedTextSchema,
        description: localizedTextSchema,
        category: z.enum(CATALOGUE_CATEGORIES),
        examplePrompts: z.array(localizedTextSchema),
        mark: z.object({ color: z.string().optional(), logo: z.string().optional() }),
        offered: z.boolean(),
        parts: z.array(
          z.object({
            part: z.enum(CATALOGUE_PARTS),
            connectorType: z.string(),
            name: z.string(),
            title: localizedTextSchema.optional(),
            description: localizedTextSchema,
            authScheme: z.string(),
            settings: z.record(z.string(), z.unknown()),
            fields: z.array(
              z.object({
                label: localizedTextSchema,
                help: localizedTextSchema.optional(),
                optional: z.boolean(),
                setting: z.string().optional(),
                secret: z.boolean(),
                default: z.string().optional()
              })
            ),
            prerequisites: z.array(
              z.object({ text: localizedTextSchema, value: z.string().optional() })
            ),
            hosts: z.array(z.string()),
            operations: z.array(
              z.object({
                name: z.string(),
                title: z.string().optional(),
                description: z.string().optional(),
                effect: z.enum(OPERATION_EFFECTS),
                recommended: z.boolean(),
                declaration: z.record(z.string(), z.unknown()).optional()
              })
            ),
            sharedAccountNote: localizedTextSchema,
            documentSource: z.boolean()
          })
        )
      })
    )
    .default([])
});

export type ConnectorTypeOffers = z.infer<typeof connectorTypeOffersSchema>;

/**
 * A secret entered once. It is never answered, logged or kept with the run of its call.
 * `expectedVersion` is the version the writer saw, `null` where none was set: a write over a
 * version somebody else set meanwhile is refused. `expectedRevision` is the revision of the
 * Connection the writer read: a secret is entered for the addresses that revision names, so a
 * Connection changed since is refused with `connection_changed` and stores nothing.
 */
const connectionSecretWriteSchema = z.object({
  value: z.string().min(1).max(SECRET_VALUE_MAX_CHARS),
  expectedVersion: z.number().int().positive().nullable(),
  expectedRevision: z.number().int().positive()
});

const connectionDiscoveryRequestSchema = z.object({ status: z.literal("queued") });

const personContextSubjectSchema = z.object({
  subjectKind: z.enum(GRANT_HOLDER_KINDS).extract(["user", "service_principal"]),
  subjectId: z.string().min(1).max(256)
});
export const connectionPersonContextSchema = personContextSubjectSchema.extend({
  value: z.string().optional(),
  rowVersion: z.number().int().positive().nullable()
});
export type ConnectionPersonContext = z.infer<typeof connectionPersonContextSchema>;

export type ConnectionDetail = z.infer<typeof connectionDetailSchema>;
export type ConnectionSecretState = z.infer<typeof connectionSecretStateSchema>;
export type ConnectionDiscoveredTool = z.infer<typeof connectionDiscoveredToolSchema>;
export type ConnectionOperationDetail = z.infer<typeof connectionOperationDetailSchema>;
export type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>;
export type ConnectionTools = z.infer<typeof connectionToolsSchema>;
export type ConnectionOAuthStart = z.infer<typeof connectionOAuthStartSchema>;
export type ConnectionOAuthSignIn = z.infer<typeof connectionOAuthSignInSchema>;

/** The one field these operations take: the Connection's name, from the path. */
export const connectionNameParamsSchema = z.object({ name: connectionNameSchema });

// Each is an operation of the registry. None names its right in `requires`: the right is the
// Connection's own (`connection.read`, `connection.write`) and is decided on the Connection
// the call names, where a grant on the instance or on the asset can answer it.
export const connectionOperations = {
  "connections.person_context": defineRegisteredOperation({
    id: "connections.person_context",
    method: "GET",
    path: "/api/v1/connections/:name/person-context",
    summary:
      "Read one person's or service principal's context mapping; requires Connection write access",
    tag: "Connections",
    auth: "principal",
    scope: "config_assets:write",
    requires: [],
    effect: "reading",
    query: personContextSubjectSchema,
    response: json(connectionPersonContextSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "read"
  }),
  "connections.set_person_context": defineRegisteredOperation({
    id: "connections.set_person_context",
    method: "PUT",
    path: "/api/v1/connections/:name/person-context",
    summary:
      "Map a person or service principal to the outside context value, or clear their mapping",
    tag: "Connections",
    auth: "principal",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    // Context values are admin data, excluded from Operation Run inputs and outputs.
    secret: true,
    body: personContextSubjectSchema.extend({
      value: z
        .string()
        .min(1)
        .max(1024)
        .regex(/^[\x20-\x7e]+$/u)
        .refine((value) => value.trim().length > 0, "must contain non-space text")
        .nullable(),
      expectedRowVersion: z.number().int().positive().nullable()
    }),
    response: json(connectionPersonContextSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "connections.get": defineRegisteredOperation({
    id: "connections.get",
    method: "GET",
    path: "/api/v1/connections/:name",
    summary: "Read the health, the secret state, the operations and the users of one Connection",
    tag: "Connections",
    auth: "principal",
    scope: "config_assets:read",
    requires: [],
    effect: "reading",
    response: json(connectionDetailSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "connections.test": defineRegisteredOperation({
    id: "connections.test",
    method: "POST",
    path: "/api/v1/connections/:name/test",
    summary: "Check that one Connection reaches its system and is let in",
    tag: "Connections",
    auth: "principal",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    response: json(connectionTestResultSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "connections.set_secret": defineRegisteredOperation({
    id: "connections.set_secret",
    method: "PUT",
    path: "/api/v1/connections/:name/secret",
    summary:
      "Enter the secret of one Connection made on the instance, or replace it. The value is never answered",
    tag: "Connections",
    auth: "principal",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    // The call carries a secret. The run keeps no answer and the call never waits.
    secret: true,
    body: connectionSecretWriteSchema,
    response: json(connectionSecretStateSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "connections.discover": defineRegisteredOperation({
    id: "connections.discover",
    method: "POST",
    path: "/api/v1/connections/:name/discover",
    summary: "Read again which tools the system behind one Connection offers",
    tag: "Connections",
    auth: "principal",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    response: json(connectionDiscoveryRequestSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "connections.oauth_start": defineRegisteredOperation({
    id: "connections.oauth_start",
    method: "POST",
    path: "/api/v1/connections/:name/oauth/start",
    summary:
      "Start the shared OAuth sign-in of one Connection. The answer is the address to open in the person's browser",
    tag: "Connections",
    // A person: the callback must prove that the person who started signs in.
    auth: "user",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    // The address holds the sign-in's state. The run keeps no answer.
    secret: true,
    response: json(connectionOAuthStartSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "connections.oauth_sign_in": defineRegisteredOperation({
    id: "connections.oauth_sign_in",
    method: "GET",
    path: "/api/v1/connections/:name/oauth/sign-ins/:signInId",
    summary:
      "Read whether a shared OAuth sign-in the caller started still waits for the browser to come back",
    tag: "Connections",
    auth: "user",
    scope: "config_assets:read",
    requires: [],
    effect: "reading",
    response: json(connectionOAuthSignInSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  // One callback per Connection: a code sent back for one Connection is never taken for
  // another's sign-in.
  "connections.oauth_complete": defineRegisteredOperation({
    id: "connections.oauth_complete",
    method: "GET",
    path: "/api/v1/connections/:name/oauth/callback",
    summary:
      "Where the provider sends the browser back after a sign-in. Answers a redirect to the instance's page, never the code or a token",
    tag: "Connections",
    auth: "user",
    // No scope: who may complete is decided by the state and the person's first-party session,
    // and a token without a browser session is refused there with its own reason.
    scope: null,
    requires: [],
    effect: "changing",
    // The query holds a code and a state. The run keeps neither, and no answer.
    secret: true,
    query: connectionOAuthCallbackQuerySchema,
    response: redirect(),
    errors: ["CONFLICT"],
    rateClass: "write"
  }),
  "connections.disconnect": defineRegisteredOperation({
    id: "connections.disconnect",
    method: "POST",
    path: "/api/v1/connections/:name/disconnect",
    summary:
      "End the shared OAuth sign-in of one Connection. Its tokens are deleted, then the provider is asked to revoke the grant",
    tag: "Connections",
    auth: "principal",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    response: json(connectionDisconnectSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  // A path of its own: `agent-tools` would be a valid Connection name under `/connections/`.
  "connections.connector_types": defineRegisteredOperation({
    id: "connections.connector_types",
    method: "GET",
    path: "/api/v1/connector-types",
    summary: "List the Connector types a person who may make a Connection can connect from a form",
    tag: "Connections",
    auth: "principal",
    scope: "config_assets:read",
    requires: [],
    effect: "reading",
    response: json(connectorTypeOffersSchema),
    errors: [],
    rateClass: "read"
  }),
  "connections.list_tools": defineRegisteredOperation({
    id: "connections.list_tools",
    method: "GET",
    path: "/api/v1/connection-tools",
    summary: "List the tools of the Connections the caller may read that an agent can carry",
    tag: "Connections",
    auth: "principal",
    scope: "config_assets:read",
    requires: [],
    effect: "reading",
    response: json(connectionToolsSchema),
    errors: [],
    rateClass: "read"
  })
} as const;
