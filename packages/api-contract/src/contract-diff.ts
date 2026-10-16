import {
  openApiDocumentSchema,
  type OpenApiDocument,
  type OpenApiJsonSchema,
  type OpenApiOperation
} from "./openapi-document";
import { API_VERSION_PREFIX } from "./operations/define-operation";
import { z } from "zod";

export interface ReleasedDocument {
  tag: string;
  /** The parsed `openapi.json` of that release, of whatever shape that release wrote. */
  document: unknown;
}

/**
 * The document a change is held against: that of the newest release whose document has paths
 * under the version prefix. `releases` are ordered newest first. A release from before the
 * prefix existed is no baseline, because every path of it moved.
 */
export function selectContractBaseline(
  releases: readonly ReleasedDocument[]
): ReleasedDocument | undefined {
  return releases.find((release) => {
    const parsed = z
      .object({ paths: z.record(z.string(), z.unknown()) })
      .safeParse(release.document);
    return (
      parsed.success &&
      Object.keys(parsed.data.paths).some((path) => path.startsWith(`${API_VERSION_PREFIX}/`))
    );
  });
}

/**
 * What a caller written against `released` can no longer rely on in `current`, one sentence
 * per finding; empty when the change is compatible. A request must still be accepted as it
 * was sent, and an answer must still hold what was read from it. What the comparison does not
 * understand counts as breaking.
 */
export function findBreakingChanges(released: unknown, current: unknown): string[] {
  const before = openApiDocumentSchema.parse(released);
  const after = openApiDocumentSchema.parse(current);
  const findings: string[] = [];

  for (const [path, methods] of Object.entries(before.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const where = `${method.toUpperCase()} ${path}`;
      const next = after.paths[path]?.[method];
      if (!next) {
        findings.push(`${where}: the operation was removed`);
        continue;
      }
      const report = (message: string) => findings.push(`${where}: ${message}`);
      if (next.operationId !== operation.operationId) {
        report(`the operation id changed from ${operation.operationId} to ${next.operationId}`);
      }
      compareSecurity(operation, next, report);
      compareRequest({ before, after }, operation, next, report);
      compareResponses({ before, after }, operation, next, report);
    }
  }
  return findings;
}

interface Documents {
  before: OpenApiDocument;
  after: OpenApiDocument;
}
type Report = (message: string) => void;
/** A request schema may only grow in what it accepts; an answer may only grow in what it holds. */
type Direction = "request" | "response";

function compareSecurity(before: OpenApiOperation, after: OpenApiOperation, report: Report) {
  if (before.security.length === 0 && after.security.length > 0) {
    report("the operation now asks for a credential");
  }
  const compared = new Set<string>();
  for (const requirement of before.security) {
    for (const [scheme, scopes] of Object.entries(requirement)) {
      const alternative = JSON.stringify([scheme, [...new Set(scopes)].sort()]);
      if (compared.has(alternative)) continue;
      compared.add(alternative);
      const alternatives = after.security.flatMap((candidate) =>
        candidate[scheme] === undefined ? [] : [candidate[scheme]]
      );
      if (alternatives.length === 0) {
        report(`the credential ${scheme} is no longer accepted`);
      } else if (!alternatives.some((kept) => kept.every((scope) => scopes.includes(scope)))) {
        report(
          `the credential ${scheme} no longer accepts the scope alternative ${scopes.join(", ") || "without scopes"}`
        );
      }
    }
  }
}

function compareRequest(
  documents: Documents,
  before: OpenApiOperation,
  after: OpenApiOperation,
  report: Report
) {
  const key = (parameter: { in: string; name: string }) =>
    `${parameter.in} parameter ${parameter.name}`;
  for (const parameter of before.parameters) {
    const kept = after.parameters.find((candidate) => key(candidate) === key(parameter));
    if (!kept) {
      report(`the ${key(parameter)} was removed`);
      continue;
    }
    compareSchemas(documents, parameter.schema, kept.schema, "request", key(parameter), report);
  }
  for (const parameter of after.parameters) {
    const known = before.parameters.find((candidate) => key(candidate) === key(parameter));
    if (parameter.required && !known?.required) {
      report(`the ${key(parameter)} is now required`);
    }
  }

  if (!before.requestBody && after.requestBody?.required) {
    report("a request body is now required");
  }
  for (const [mediaType, media] of Object.entries(before.requestBody?.content ?? {})) {
    const kept = after.requestBody?.content[mediaType];
    if (!kept) {
      report(`a request body of ${mediaType} is no longer accepted`);
      continue;
    }
    compareSchemas(documents, media.schema, kept.schema, "request", "request body", report);
  }
}

function compareResponses(
  documents: Documents,
  before: OpenApiOperation,
  after: OpenApiOperation,
  report: Report
) {
  for (const [status, response] of Object.entries(before.responses)) {
    // A caller reads the body of a success. Every error has the one envelope.
    if (!status.startsWith("2") || "$ref" in response) continue;
    const kept = after.responses[status];
    if (!kept || "$ref" in kept) {
      report(`the answer ${status} was removed`);
      continue;
    }
    for (const [mediaType, media] of Object.entries(response.content ?? {})) {
      const keptMedia = kept.content?.[mediaType];
      if (!keptMedia) {
        report(`the answer ${status} no longer has a body of ${mediaType}`);
        continue;
      }
      compareSchemas(
        documents,
        media.schema,
        keptMedia.schema,
        "response",
        `answer ${status}`,
        report
      );
    }
  }
}

function compareSchemas(
  documents: Documents,
  before: OpenApiJsonSchema,
  after: OpenApiJsonSchema,
  direction: Direction,
  where: string,
  report: Report
): void {
  compareNodes({ documents, direction, report, compared: new Set() }, before, after, where);
}

interface Comparison {
  documents: Documents;
  direction: Direction;
  report: Report;
  /** Pairs of named schemas already compared, which also ends a schema that refers to itself. */
  compared: Set<string>;
}

const nodeSchema = z.looseObject({
  $ref: z.string().optional(),
  type: z.union([z.string(), z.array(z.string())]).optional(),
  enum: z.array(z.unknown()).optional(),
  const: z.unknown().optional(),
  properties: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  required: z.array(z.string()).optional(),
  additionalProperties: z.unknown().optional(),
  items: z.record(z.string(), z.unknown()).optional(),
  anyOf: z.array(z.record(z.string(), z.unknown())).optional(),
  oneOf: z.array(z.record(z.string(), z.unknown())).optional()
});
type SchemaNode = z.infer<typeof nodeSchema>;

/** Keywords the comparison reads itself. Any other keyword must be equal on both sides. */
const UNDERSTOOD = new Set([
  "$ref",
  "type",
  "enum",
  "const",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "anyOf",
  "oneOf",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  // Says nothing about which values are valid.
  "default",
  "description",
  "title"
]);
const LOWER_BOUNDS = ["minimum", "exclusiveMinimum", "minLength", "minItems"];
const UPPER_BOUNDS = ["maximum", "exclusiveMaximum", "maxLength", "maxItems"];

function compareNodes(
  comparison: Comparison,
  beforeSchema: OpenApiJsonSchema,
  afterSchema: OpenApiJsonSchema,
  where: string
): void {
  const { documents, direction, report } = comparison;
  const beforeRef = nodeSchema.parse(beforeSchema).$ref;
  const afterRef = nodeSchema.parse(afterSchema).$ref;
  if (beforeRef && afterRef) {
    const pair = `${beforeRef} ${afterRef}`;
    if (comparison.compared.has(pair)) return;
    comparison.compared.add(pair);
  }
  const before = resolve(documents.before, beforeSchema);
  const after = resolve(documents.after, afterSchema);
  // The side whose every value the other side must still cover.
  const [narrow, wide] = direction === "request" ? [before, after] : [after, before];
  const narrowed =
    direction === "request" ? "accepts less than before" : "may hold more than before";

  const alternatives = (node: SchemaNode) => node.anyOf ?? node.oneOf;
  const narrowAlternatives = alternatives(narrow);
  const wideAlternatives = alternatives(wide);
  if (narrowAlternatives || wideAlternatives) {
    const narrowOptions = narrowAlternatives ?? [narrow];
    const wideOptions = wideAlternatives ?? [wide];
    for (const [index, option] of narrowOptions.entries()) {
      const covered = wideOptions.some((candidate) => {
        const trial: string[] = [];
        const [optionBefore, optionAfter] =
          direction === "request" ? [option, candidate] : [candidate, option];
        compareNodes(
          {
            ...comparison,
            report: (message) => trial.push(message),
            compared: new Set(comparison.compared)
          },
          optionBefore,
          optionAfter,
          where
        );
        return trial.length === 0;
      });
      if (!covered) report(`${where}: alternative ${index + 1} ${narrowed}`);
    }
    return;
  }

  const types = (node: SchemaNode) => (node.type === undefined ? undefined : [node.type].flat());
  const narrowTypes = types(narrow);
  const wideTypes = types(wide);
  if (wideTypes && (!narrowTypes || narrowTypes.some((type) => !wideTypes.includes(type)))) {
    report(
      `${where}: the type changed from ${describe(types(before))} to ${describe(types(after))}`
    );
    return;
  }

  const values = (node: SchemaNode) => node.enum ?? ("const" in node ? [node.const] : undefined);
  const narrowValues = values(narrow);
  const wideValues = values(wide);
  if (wideValues && (!narrowValues || narrowValues.some((value) => !wideValues.includes(value)))) {
    report(`${where}: the set of values ${narrowed}`);
  }

  for (const [bounds, tighter] of [
    [LOWER_BOUNDS, (wideBound: number, narrowBound: number) => wideBound > narrowBound],
    [UPPER_BOUNDS, (wideBound: number, narrowBound: number) => wideBound < narrowBound]
  ] as const) {
    for (const bound of bounds) {
      const wideBound = wide[bound];
      const narrowBound = narrow[bound];
      if (typeof wideBound !== "number") continue;
      if (typeof narrowBound !== "number" || tighter(wideBound, narrowBound)) {
        report(`${where}: ${bound} ${narrowed}`);
      }
    }
  }

  for (const keyword of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (
      !UNDERSTOOD.has(keyword) &&
      JSON.stringify(before[keyword]) !== JSON.stringify(after[keyword])
    ) {
      report(`${where}: ${keyword} changed`);
    }
  }

  const beforeRequired = before.required ?? [];
  const afterRequired = after.required ?? [];
  for (const [name, property] of Object.entries(before.properties ?? {})) {
    const kept = after.properties?.[name];
    if (!kept) {
      report(`${where}: the field ${name} was removed`);
      continue;
    }
    compareNodes(comparison, property, kept, `${where}.${name}`);
    if (
      direction === "response" &&
      beforeRequired.includes(name) &&
      !afterRequired.includes(name)
    ) {
      report(`${where}: the field ${name} may now be absent`);
    }
  }
  if (direction === "request") {
    for (const name of afterRequired) {
      if (!beforeRequired.includes(name)) report(`${where}: the field ${name} is now required`);
    }
    if (after.additionalProperties === false && before.additionalProperties !== false) {
      report(`${where}: unknown fields are now refused`);
    }
  }

  if (before.items && after.items) {
    compareNodes(comparison, before.items, after.items, `${where}[]`);
  }
  const beforeValues = z.record(z.string(), z.unknown()).safeParse(before.additionalProperties);
  const afterValues = z.record(z.string(), z.unknown()).safeParse(after.additionalProperties);
  if (beforeValues.success && afterValues.success) {
    compareNodes(comparison, beforeValues.data, afterValues.data, `${where}.*`);
  }
}

function resolve(document: OpenApiDocument, schema: OpenApiJsonSchema): SchemaNode {
  const node = nodeSchema.parse(schema);
  if (!node.$ref) return node;
  const name = node.$ref.slice(node.$ref.lastIndexOf("/") + 1);
  const component = document.components.schemas[name];
  if (!component) throw new Error(`The document refers to ${node.$ref}, which it does not define`);
  return resolve(document, component);
}

function describe(types: string[] | undefined): string {
  return types?.join(" or ") ?? "any";
}
