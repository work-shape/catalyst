import {
  APP_ERROR_STATUS_CODES,
  IDEMPOTENCY_KEY_MAX_LENGTH
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import packageManifest from "../package.json" with { type: "json" };
import { API_ERROR_MEANINGS, appErrorCodeSchema, type ApiErrorCode } from "./errors";
import type {
  OpenApiDocument,
  OpenApiJsonSchema,
  OpenApiOperation,
  OpenApiResponse
} from "./openapi-document";
import { apiOperations } from "./operations";
import {
  API_VERSION_PREFIX,
  COMMON_OPERATION_ERRORS,
  OPERATION_HEADERS,
  operationPathParamNames,
  type Operation,
  type OperationResponseHeader
} from "./operations/define-operation";
import * as contractSchemas from "./schemas";

/** The release this build is part of: every platform package carries the same version. */
export const RELEASE_VERSION = packageManifest.version;
const releaseVersion = RELEASE_VERSION;

export type ApiOperationCatalog = Record<string, Operation>;

/** The document of the release: every versioned operation of the catalog, and `/ready`. */
export function createOpenApiDocument(): OpenApiDocument {
  return createOpenApiDocumentFromOperations(apiOperations);
}

/**
 * The document of the given operations. An instance passes the operations it registered, so
 * what it runs without is absent. Of the unversioned operations the document lists the one in
 * `DOCUMENTED_UNVERSIONED_OPERATIONS`; the others and the operations of development instances
 * are registered without being part of any document.
 */
export function createOpenApiDocumentFromOperations(
  operations: ApiOperationCatalog
): OpenApiDocument {
  const documented = Object.values(operations)
    .filter(
      (operation) =>
        !operation.devOnly &&
        (operation.path.startsWith(`${API_VERSION_PREFIX}/`) ||
          DOCUMENTED_UNVERSIONED_OPERATIONS.includes(operation.id))
    )
    .sort(
      (left, right) =>
        compareText(toOpenApiPath(left.path), toOpenApiPath(right.path)) ||
        METHOD_ORDER.indexOf(left.method) - METHOD_ORDER.indexOf(right.method)
    );

  const paths: OpenApiDocument["paths"] = {};
  const errorAnswers = new Map<string, readonly ApiErrorCode[]>();
  const responseHeaders = new Set<OperationResponseHeader>();
  for (const operation of documented) {
    const answers = errorAnswersByStatus(operationErrorCodes(operation));
    answers.forEach((codes) => errorAnswers.set(errorResponseName(codes), codes));
    operation.headers?.response?.forEach((header) => responseHeaders.add(header));
    (paths[toOpenApiPath(operation.path)] ??= {})[operation.method.toLowerCase()] =
      createOpenApiOperation(operation, answers);
  }

  const responses = Object.fromEntries(
    [...errorAnswers.values()]
      .sort(
        (left, right) =>
          left.length - right.length ||
          API_ERROR_CODE_ORDER.indexOf(required(left[0])) -
            API_ERROR_CODE_ORDER.indexOf(required(right[0])) ||
          compareText(errorResponseName(left), errorResponseName(right))
      )
      .map((codes) => [
        errorResponseName(codes),
        {
          description: codes.map((code) => `\`${code}\`: ${API_ERROR_MEANINGS[code]}`).join(" "),
          content: { "application/json": { schema: schemaFor(errorResponseSchema, "output") } }
        }
      ])
  );
  const headers = Object.fromEntries(
    RESPONSE_HEADER_ORDER.filter((header) => responseHeaders.has(header)).map((header) => [
      headerComponentName(header),
      {
        description: `\`${header}\`: ${OPERATION_HEADERS.response[header]}`,
        schema: { type: "string" }
      }
    ])
  );

  return {
    openapi: "3.1.0",
    info: {
      title: "Workshape Catalyst API",
      version: releaseVersion,
      description: `Every operation under \`${API_VERSION_PREFIX}\` of release ${releaseVersion}, and the unversioned readiness probe \`/ready\`. Every error answers with the envelope \`ApiErrorResponse\`; its \`code\` is the stable part, its \`correlationId\` names the request in the instance's log.`
    },
    servers: [{ url: "/", description: "The instance that serves this document" }],
    tags: [...new Set(documented.map((operation) => operation.tag))]
      .sort(compareText)
      .map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: SECURITY_SCHEMES,
      responses,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      schemas: usedComponents({ paths, responses })
    }
  };
}

/** What a proxy or a deploy step is configured against, so its two answers are documented. */
const DOCUMENTED_UNVERSIONED_OPERATIONS: readonly string[] = ["ready.get"];
const METHOD_ORDER: readonly Operation["method"][] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const API_ERROR_CODE_ORDER: readonly ApiErrorCode[] = appErrorCodeSchema.options;
const errorResponseSchema = contractSchemas.apiErrorResponseSchema;
const RESPONSE_HEADER_ORDER: readonly OperationResponseHeader[] = [
  "Operation-Run-Id",
  "Location",
  "Idempotent-Replayed"
];

/** One answer per status: the codes that share a status share its answer. */
function errorAnswersByStatus(codes: readonly ApiErrorCode[]): Map<string, ApiErrorCode[]> {
  const answers = new Map<string, ApiErrorCode[]>();
  for (const code of codes) {
    const status = String(APP_ERROR_STATUS_CODES[code]);
    answers.set(status, [...(answers.get(status) ?? []), code]);
  }
  return answers;
}

function headerComponentName(header: string): string {
  return header.replaceAll("-", "");
}

function required<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error("Expected a value");
  return value;
}

const SECURITY_SCHEMES = {
  sessionCookie: {
    type: "apiKey",
    in: "cookie",
    name: "better-auth.session_token",
    description:
      "The session of a person signed in through `/api/auth`, the mount owned by the sign-in library. Over HTTPS the browser carries the cookie as `__Secure-better-auth.session_token`. A changing request with this cookie must come from the instance's own origin or an allowed one."
  },
  sessionToken: {
    type: "http",
    scheme: "bearer",
    description:
      "A session token a trusted backend obtained for one of its users from `session_tokens.issue`."
  },
  accessToken: {
    type: "http",
    scheme: "bearer",
    description:
      "A short-lived access token of a service principal, obtained from `access_tokens.exchange` with an API key."
  },
  apiKey: {
    type: "http",
    scheme: "bearer",
    description:
      "An API key of a service principal. It is presented only to `access_tokens.exchange`."
  },
  serverCredential: {
    type: "apiKey",
    in: "header",
    name: "x-server-credential",
    description: "The instance's server credential, held by a trusted backend."
  }
} as const satisfies OpenApiDocument["components"]["securitySchemes"];

type SecuritySchemeName = keyof typeof SECURITY_SCHEMES;

/** The credentials an operation accepts, each with the scope it must carry. */
function createSecurity(operation: Operation): OpenApiOperation["security"] {
  const schemes: readonly SecuritySchemeName[] =
    operation.auth === "user"
      ? ["sessionCookie", "sessionToken"]
      : operation.auth === "principal"
        ? ["sessionCookie", "sessionToken", "accessToken"]
        : operation.auth === "serverCredential"
          ? ["serverCredential"]
          : operation.credential
            ? [operation.credential]
            : [];
  const security = schemes.map((scheme) => ({
    [scheme]: operation.scope ? [operation.scope] : []
  }));
  if (operation.personalKeyScope) {
    // This alternative is an access token of a personal key, subject to ownership checks.
    security.push({ accessToken: [operation.personalKeyScope] });
  }
  return security;
}

/**
 * The common errors and the declared ones. An operation that authenticates nobody answers
 * neither UNAUTHENTICATED nor FORBIDDEN unless it declares them.
 */
function operationErrorCodes(operation: Operation): ApiErrorCode[] {
  const anonymous = createSecurity(operation).length === 0;
  const codes = new Set<ApiErrorCode>([
    ...COMMON_OPERATION_ERRORS.filter(
      (code) => !anonymous || (code !== "UNAUTHENTICATED" && code !== "FORBIDDEN")
    ),
    ...operation.errors
  ]);
  return API_ERROR_CODE_ORDER.filter((code) => codes.has(code));
}

function createOpenApiOperation(
  operation: Operation,
  errorAnswers: ReadonlyMap<string, readonly ApiErrorCode[]>
): OpenApiOperation {
  const requestBody = createRequestBody(operation);
  return {
    operationId: operation.id,
    summary: operation.summary,
    tags: [operation.tag],
    security: createSecurity(operation),
    parameters: createParameters(operation),
    ...(requestBody ? { requestBody } : {}),
    responses: Object.fromEntries(
      [
        ...Object.entries(createSuccessResponses(operation)),
        ...[...errorAnswers].map(([status, codes]): [string, { $ref: string }] => [
          status,
          { $ref: `#/components/responses/${errorResponseName(codes)}` }
        ])
      ].sort(([left], [right]) => compareText(left, right))
    ),
    "x-catalyst-effect": operation.effect,
    ...(operation.requires?.length ? { "x-catalyst-requires": [...operation.requires] } : {}),
    "x-catalyst-rate-class": operation.rateClass
  };
}

// Query constraints include the list limit default and maximum from the sole schema.
function createParameters(operation: Operation): OpenApiOperation["parameters"] {
  return [
    ...operationPathParamNames(operation.path).map((name) => ({
      name,
      in: "path" as const,
      required: true,
      schema: { type: "string" }
    })),
    ...Object.entries(operation.query?.shape ?? {}).map(([name, schema]) => ({
      name,
      in: "query" as const,
      required: !schema.safeParse(undefined).success,
      schema: schemaFor(schema, "input")
    })),
    ...(operation.headers?.request ?? []).map((name) => ({
      name,
      in: "header" as const,
      description: OPERATION_HEADERS.request[name],
      required: false,
      schema: { type: "string", minLength: 1, maxLength: IDEMPOTENCY_KEY_MAX_LENGTH }
    }))
  ];
}

function createRequestBody(operation: Operation): OpenApiOperation["requestBody"] {
  if (operation.body) {
    return {
      required: true,
      content: { "application/json": { schema: schemaFor(operation.body, "input") } }
    };
  }
  if (operation.multipart) {
    return {
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            properties: { file: { type: "string", format: "binary" } },
            required: ["file"]
          }
        }
      }
    };
  }
  return undefined;
}

/** The success answers, each naming the headers the operation sets on it. */
function createSuccessResponses(operation: Operation): Record<string, OpenApiResponse> {
  const declared = operation.headers?.response ?? [];
  const headersOf = (status: string) => {
    // `Location` leads to the run of a call that waits; a replay answers what was recorded.
    const set = declared.filter((header) => header !== "Location" || status === "202");
    return set.length > 0
      ? {
          headers: Object.fromEntries(
            set.map((header) => [
              header,
              { $ref: `#/components/headers/${headerComponentName(header)}` }
            ])
          )
        }
      : {};
  };
  const answers: Record<string, OpenApiResponse> = {
    ...createResultResponses(operation),
    ...(operation.accepted
      ? {
          "202": {
            description:
              "The call waits for somebody else to approve it. This is its Operation Run; read it again at `Location`.",
            content: { "application/json": { schema: schemaFor(operation.accepted, "output") } }
          }
        }
      : {}),
    ...(operation.deferred
      ? {
          "202": {
            description:
              "The call was accepted and its work finishes by itself. The answer has no body."
          }
        }
      : {})
  };
  return Object.fromEntries(
    Object.entries(answers).map(([status, answer]) => [status, { ...answer, ...headersOf(status) }])
  );
}

function createResultResponses(operation: Operation): Record<string, OpenApiResponse> {
  const { response } = operation;
  switch (response.kind) {
    case "json":
    case "page":
      return {
        "200": {
          description: response.kind === "page" ? "One page of the list" : "The result",
          content: { "application/json": { schema: schemaFor(response.schema, "output") } }
        },
        ...(response.kind === "json" && response.unavailable
          ? {
              "503": {
                description: "The instance cannot serve; the body says why",
                content: {
                  "application/json": { schema: schemaFor(response.unavailable, "output") }
                }
              }
            }
          : {})
      };
    case "sse":
      // OpenAPI 3.1 has no notation for an event stream, so the schema is that of one event.
      return {
        "200": {
          description:
            "A stream of server-sent events. The `data` of every event is one JSON value of the schema; `id` is the position to resume from.",
          content: { "text/event-stream": { schema: schemaFor(response.schema, "output") } }
        },
        "204": {
          description: "The stream has ended and holds no event after the position asked for"
        }
      };
    case "blob":
      return {
        "200": {
          description: "The content itself",
          content: {
            [response.contentType]: {
              schema: response.contentType.startsWith("text/")
                ? { type: "string" }
                : { type: "string", format: "binary" }
            }
          }
        }
      };
  }
}

// --- Named schemas ---------------------------------------------------------------------------

type SchemaDirection = "input" | "output";

const COMPONENT_PREFIX = "#/components/schemas/";

interface NamedSchemas {
  registry: ReturnType<typeof z.registry<{ id: string }>>;
  components: Record<string, OpenApiJsonSchema>;
}

let namedSchemas: NamedSchemas | undefined;

/** Built on first use: a caller that never asks for a document pays nothing for it. */
function named(): NamedSchemas {
  return (namedSchemas ??= createNamedSchemas());
}

/**
 * A component describes a value as the instance answers it. Where a request accepts a wider
 * form of the same schema, because a field has a default, that form is the component
 * `<Name>Input`.
 */
function createNamedSchemas(): NamedSchemas {
  const registry = z.registry<{ id: string }>();
  for (const [exportName, schema] of Object.entries(contractSchemas).sort(([left], [right]) =>
    compareText(left, right)
  )) {
    if (schema instanceof z.ZodType && exportName.endsWith("Schema") && !registry.has(schema)) {
      const name = exportName.slice(0, -"Schema".length);
      registry.add(schema, { id: `${name.charAt(0).toUpperCase()}${name.slice(1)}` });
    }
  }

  const convert = (io: SchemaDirection) =>
    Object.entries(
      z.toJSONSchema(registry, { io, uri: (id) => `${COMPONENT_PREFIX}${id}` }).schemas
    ).map(([name, schema]): [string, OpenApiJsonSchema] => {
      const { $schema: _dialect, $id: _id, ...component } = schema;
      return [name, io === "output" ? openObjects(component) : component];
    });
  const output = new Map(convert("output"));
  const input = new Map(convert("input"));

  // A schema is wider on input when it differs itself or refers to one that does.
  const wider = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, schema] of input) {
      if (wider.has(name)) continue;
      const differs = JSON.stringify(openObjects(schema)) !== JSON.stringify(output.get(name));
      if (differs || referencedNames(schema).some((referenced) => wider.has(referenced))) {
        wider.add(name);
        grew = true;
      }
    }
  }
  const inputName = (name: string) => (wider.has(name) ? `${name}Input` : name);
  return {
    registry,
    components: Object.fromEntries([
      ...output,
      ...[...wider].map((name): [string, OpenApiJsonSchema] => [
        inputName(name),
        renameReferences(input.get(name) ?? {}, inputName)
      ])
    ])
  };
}

/** The schema as an operation states it: a reference where it is named, inline otherwise. */
function schemaFor(schema: z.ZodType, io: SchemaDirection): OpenApiJsonSchema {
  const { registry, components } = named();
  const inputName = (name: string) =>
    io === "input" && `${name}Input` in components ? `${name}Input` : name;
  const name = registry.get(schema)?.id;
  if (name) {
    return { $ref: `${COMPONENT_PREFIX}${inputName(name)}` };
  }
  const {
    $schema: _dialect,
    $defs: definitions = {},
    ...inline
  } = z.toJSONSchema(schema, { io, metadata: registry });
  const unnamed = Object.keys(definitions).filter((name) => !(name in components));
  if (unnamed.length > 0) {
    throw new Error(
      `A schema that refers to itself needs a name: export it as "<name>Schema" (${unnamed.join(", ")})`
    );
  }
  const renamed = renameReferences(inline, inputName);
  return io === "output" ? openObjects(renamed) : renamed;
}

/** The components the given part of a document refers to, directly or through one another. */
function usedComponents(root: unknown): Record<string, OpenApiJsonSchema> {
  const { components } = named();
  const used = new Set<string>();
  const pending = referencedNames(root);
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (used.has(name)) continue;
    used.add(name);
    pending.push(...referencedNames(components[name]));
  }
  return Object.fromEntries(
    [...used].sort(compareText).map((name) => [name, components[name] ?? {}])
  );
}

function referencedNames(node: unknown): string[] {
  const names: string[] = [];
  visit(node, (key, value) => {
    if (key === "$ref" && typeof value === "string" && value.startsWith(COMPONENT_PREFIX)) {
      names.push(value.slice(COMPONENT_PREFIX.length));
    }
    return value;
  });
  return names;
}

function renameReferences(
  schema: OpenApiJsonSchema,
  rename: (name: string) => string
): OpenApiJsonSchema {
  return jsonObject(
    visit(schema, (key, value) =>
      key === "$ref" && typeof value === "string"
        ? `${COMPONENT_PREFIX}${rename(value.slice(value.lastIndexOf("/") + 1))}`
        : value
    )
  );
}

/**
 * An answer may gain fields in a later release without breaking its readers, so the document
 * does not call an answered object closed.
 */
function openObjects(schema: OpenApiJsonSchema): OpenApiJsonSchema {
  return jsonObject(
    visit(schema, (key, value) =>
      key === "additionalProperties" && value === false ? undefined : value
    )
  );
}

/** Copies a JSON value, passing every object entry through `map`; `undefined` drops the entry. */
function visit(node: unknown, map: (key: string, value: unknown) => unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => visit(item, map));
  }
  if (typeof node !== "object" || node === null) {
    return node;
  }
  return Object.fromEntries(
    Object.entries(node).flatMap(([key, value]) => {
      const mapped = map(key, value);
      return mapped === undefined ? [] : [[key, visit(mapped, map)]];
    })
  );
}

function jsonObject(value: unknown): OpenApiJsonSchema {
  return z.record(z.string(), z.unknown()).parse(value);
}

function errorResponseName(codes: ApiErrorCode | readonly ApiErrorCode[]): string {
  return [codes]
    .flat()
    .map((code) =>
      code
        .toLowerCase()
        .split("_")
        .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
        .join("")
    )
    .join("Or");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toOpenApiPath(path: string): string {
  return path.replaceAll(/:([A-Za-z][A-Za-z0-9_]*)/gu, "{$1}");
}
