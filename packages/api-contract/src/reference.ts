import { z } from "zod";
import {
  openApiDocumentSchema,
  type OpenApiDocument,
  type OpenApiJsonSchema,
  type OpenApiOperation
} from "./openapi-document";

/**
 * The reference a person reads, written from an OpenAPI document of this product. Every part
 * is finished HTML with all text of the document escaped, and holds no script, so a page that
 * shows it needs nothing from another host.
 */
export interface ApiReference {
  title: string;
  version: string;
  /** Introduction, credentials and errors. */
  overview: string;
  groups: {
    tag: string;
    operations: { id: string; summary: string; method: string; path: string; html: string }[];
  }[];
  schemas: { name: string; html: string }[];
}

export interface ApiReferenceOptions {
  /** Where a named schema is found. An anchor on the same page unless the schemas live elsewhere. */
  schemaHref?: (name: string) => string;
}

export function describeApiReference(
  source: unknown,
  { schemaHref = (name) => `#${schemaAnchor(name)}` }: ApiReferenceOptions = {}
): ApiReference {
  const document = openApiDocumentSchema.parse(source);
  const writer: Writer = { document, schemaHref };
  return {
    title: document.info.title,
    version: document.info.version,
    overview: overview(document),
    groups: document.tags.map(({ name: tag }) => ({
      tag,
      operations: Object.entries(document.paths).flatMap(([path, methods]) =>
        Object.entries(methods)
          .filter(([, operation]) => operation.tags.includes(tag))
          .map(([method, operation]) => ({
            id: operation.operationId,
            summary: operation.summary,
            method: method.toUpperCase(),
            path,
            html: operationHtml(writer, method.toUpperCase(), path, operation)
          }))
      )
    })),
    schemas: Object.entries(document.components.schemas).map(([name, schema]) => ({
      name,
      html: `<p>${typeHtml(writer, schema)}</p>${fieldsHtml(writer, schema)}`
    }))
  };
}

/** The seven colours of an instance theme that the page uses. */
export interface ApiReferenceColors {
  surfaceColor: string;
  backgroundColor: string;
  textColor: string;
  mutedTextColor: string;
  borderColor: string;
  accentColor: string;
}

export interface ApiReferencePageOptions {
  /** Where the page's download link finds the document it shows. */
  documentHref: string;
  /** The colours of the page; `dark` applies where the reader's system asks for a dark page. */
  theme: { light: ApiReferenceColors; dark?: ApiReferenceColors };
}

/**
 * The reference as one page. `styleSheet` is the content of the page's only style element, for
 * a content policy that names it by hash.
 */
export function renderApiReferencePage(
  source: unknown,
  { documentHref, theme }: ApiReferencePageOptions
): { html: string; styleSheet: string } {
  const reference = describeApiReference(source);
  const styleSheet = [
    colorRule(theme.light),
    theme.dark ? `@media (prefers-color-scheme:dark){${colorRule(theme.dark)}}` : "",
    PAGE_STYLE
  ].join("");
  const navigation = reference.groups
    .map(
      (group) =>
        `<li><a href="#${tagAnchor(group.tag)}">${text(group.tag)}</a><ul>${group.operations
          .map(
            (operation) =>
              `<li><a href="#${operationAnchor(operation.id)}">${text(operation.summary)}</a></li>`
          )
          .join("")}</ul></li>`
    )
    .join("");
  const groups = reference.groups
    .map(
      (group) =>
        `<section><h2 id="${tagAnchor(group.tag)}">${text(group.tag)}</h2>${group.operations
          .map(
            (operation) =>
              `<article><h3 id="${operationAnchor(operation.id)}">${text(operation.summary)}</h3>${operation.html}</article>`
          )
          .join("")}</section>`
    )
    .join("");
  const schemas = reference.schemas
    .map(
      (schema) =>
        `<article><h3 id="${schemaAnchor(schema.name)}">${text(schema.name)}</h3>${schema.html}</article>`
    )
    .join("");
  const title = `${text(reference.title)} ${text(reference.version)}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${styleSheet}</style></head><body><header><h1>${title}</h1><a href="${text(documentHref)}" download>Download the OpenAPI document</a></header><div class="layout"><nav aria-label="Operations"><ul><li><a href="#overview">Overview</a></li>${navigation}<li><a href="#schemas">Schemas</a></li></ul></nav><main><section id="overview">${reference.overview}</section>${groups}<section><h2 id="schemas">Schemas</h2>${schemas}</section></main></div></body></html>`;
  return { html, styleSheet };
}

interface Writer {
  document: OpenApiDocument;
  schemaHref: (name: string) => string;
}

function overview(document: OpenApiDocument): string {
  const schemes = Object.entries(document.components.securitySchemes)
    .map(([name, scheme]) => {
      const carried =
        scheme.type === "http"
          ? "<code>Authorization: Bearer …</code>"
          : `${text(scheme.in ?? "")} <code>${text(scheme.name ?? "")}</code>`;
      return `<li><code>${text(name)}</code> (${carried}): ${prose(scheme.description)}</li>`;
    })
    .join("");
  const errors = Object.entries(document.components.responses)
    .map(([, response]) => `<li>${prose(response.description)}</li>`)
    .join("");
  const headers = Object.entries(document.components.headers ?? {})
    .map(([, header]) => `<li>${prose(header.description)}</li>`)
    .join("");
  const headerSection = headers
    ? `<h2 id="headers">Answer headers</h2><ul class="api-fields">${headers}</ul>`
    : "";
  return `<p>${prose(document.info.description)}</p><h2 id="credentials">Credentials</h2><ul class="api-fields">${schemes}</ul><h2 id="errors">Errors</h2><ul class="api-fields">${errors}</ul>${headerSection}`;
}

function operationHtml(
  writer: Writer,
  method: string,
  path: string,
  operation: OpenApiOperation
): string {
  const credentials = new Map<string, Set<string>>();
  for (const requirement of operation.security) {
    for (const [scheme, scopes] of Object.entries(requirement)) {
      const alternatives = credentials.get(scheme) ?? new Set<string>();
      alternatives.add(scopes.length > 0 ? codeList([...new Set(scopes)].sort()) : "no scopes");
      credentials.set(scheme, alternatives);
    }
  }
  const accepts =
    credentials.size === 0
      ? "No credential"
      : [...credentials]
          .map(
            ([scheme, alternatives]) =>
              `<code>${text(scheme)}</code> (${[...alternatives].join(" or ")})`
          )
          .join(", ");
  const scopes = [...new Set(operation.security.flatMap((item) => Object.values(item).flat()))];
  const facts: [string, string][] = [
    ["Operation", `<code>${text(operation.operationId)}</code>`],
    ["Accepts", accepts],
    ...(scopes.length > 0 ? [["Scope", codeList(scopes)] satisfies [string, string]] : []),
    ...(operation["x-catalyst-requires"]?.length
      ? [["Rights", codeList(operation["x-catalyst-requires"])] satisfies [string, string]]
      : []),
    ["Effect", text(operation["x-catalyst-effect"])],
    ["Rate class", text(operation["x-catalyst-rate-class"])]
  ];
  const parameters = operation.parameters
    .map((parameter) =>
      fieldHtml(writer, `${parameter.name}`, parameter.schema, parameter.required, parameter.in)
    )
    .join("");
  const body = Object.entries(operation.requestBody?.content ?? {})
    .map(([mediaType, media]) => contentHtml(writer, mediaType, media.schema))
    .join("");
  const answers = Object.entries(operation.responses)
    .map(([status, answer]) => {
      const response =
        "$ref" in answer ? writer.document.components.responses[lastSegment(answer.$ref)] : answer;
      // An error is one line: its envelope is described once, in the overview.
      const content =
        "$ref" in answer
          ? ""
          : Object.entries(response?.content ?? {})
              .map(([mediaType, media]) => contentHtml(writer, mediaType, media.schema))
              .join("");
      const headers = "$ref" in answer ? [] : Object.keys(answer.headers ?? {});
      const sets = headers.length > 0 ? ` Sets ${codeList(headers)}.` : "";
      return `<li><code>${text(status)}</code> ${prose(response?.description ?? "")}${sets}${content}</li>`;
    })
    .join("");
  return [
    `<p class="api-route"><strong>${text(method)}</strong> <code>${text(path)}</code></p>`,
    `<dl class="api-facts">${facts.map(([term, value]) => `<dt>${term}</dt><dd>${value}</dd>`).join("")}</dl>`,
    parameters ? `<h4>Parameters</h4><ul class="api-fields">${parameters}</ul>` : "",
    body ? `<h4>Request body</h4>${body}` : "",
    `<h4>Answers</h4><ul class="api-fields">${answers}</ul>`
  ].join("");
}

function contentHtml(writer: Writer, mediaType: string, schema: OpenApiJsonSchema): string {
  return `<p><code>${text(mediaType)}</code>: ${typeHtml(writer, schema)}</p>${fieldsHtml(writer, schema)}`;
}

const schemaNodeSchema = z.looseObject({
  $ref: z.string().optional(),
  type: z.union([z.string(), z.array(z.string())]).optional(),
  format: z.string().optional(),
  enum: z.array(z.unknown()).optional(),
  properties: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  required: z.array(z.string()).optional(),
  additionalProperties: z.unknown().optional(),
  items: z.record(z.string(), z.unknown()).optional(),
  anyOf: z.array(z.record(z.string(), z.unknown())).optional(),
  oneOf: z.array(z.record(z.string(), z.unknown())).optional(),
  description: z.string().optional()
});

/** Limits a reader should know, in the words of JSON Schema. */
const CONSTRAINTS = [
  "default",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern"
];

/** The type of a value in one line, with a link wherever it is a named schema. */
function typeHtml(writer: Writer, schema: OpenApiJsonSchema): string {
  const node = schemaNodeSchema.parse(schema);
  if (node.$ref) {
    const name = lastSegment(node.$ref);
    return `<a href="${text(writer.schemaHref(name))}">${text(name)}</a>`;
  }
  const alternatives = node.anyOf ?? node.oneOf;
  if (alternatives) {
    return alternatives.map((alternative) => typeHtml(writer, alternative)).join(" | ");
  }
  if (node.enum) {
    return node.enum.map((value) => `<code>${text(JSON.stringify(value))}</code>`).join(" | ");
  }
  if ("const" in node) {
    return `<code>${text(JSON.stringify(node.const))}</code>`;
  }
  const types = node.type === undefined ? ["any"] : [node.type].flat();
  return types
    .map((type) => {
      if (type === "array") {
        return `array of ${node.items ? typeHtml(writer, node.items) : "any"}`;
      }
      const values = z.record(z.string(), z.unknown()).safeParse(node.additionalProperties);
      if (type === "object" && !node.properties && values.success) {
        return `map of ${typeHtml(writer, values.data)}`;
      }
      return node.format ? `${text(type)} (${text(node.format)})` : text(type);
    })
    .join(" | ");
}

/** The fields of an object, and of the objects inside it, as a nested list. */
function fieldsHtml(writer: Writer, schema: OpenApiJsonSchema): string {
  const node = schemaNodeSchema.parse(schema);
  if (node.properties) {
    const fields = Object.entries(node.properties)
      .map(([name, property]) =>
        fieldHtml(writer, name, property, node.required?.includes(name) ?? false)
      )
      .join("");
    return `<ul class="api-fields">${fields}</ul>`;
  }
  if (node.items) {
    return fieldsHtml(writer, node.items);
  }
  const alternatives = (node.anyOf ?? node.oneOf ?? [])
    .map((alternative) => {
      const fields = fieldsHtml(writer, alternative);
      return fields ? `<li>${typeHtml(writer, alternative)}${fields}</li>` : "";
    })
    .join("");
  if (alternatives) {
    return `<ul class="api-fields">${alternatives}</ul>`;
  }
  const values = z.record(z.string(), z.unknown()).safeParse(node.additionalProperties);
  return values.success ? fieldsHtml(writer, values.data) : "";
}

function fieldHtml(
  writer: Writer,
  name: string,
  schema: OpenApiJsonSchema,
  required: boolean,
  place?: string
): string {
  const node = schemaNodeSchema.parse(schema);
  const constraints = CONSTRAINTS.filter((keyword) => keyword in node).map(
    (keyword) => `${keyword} <code>${text(JSON.stringify(node[keyword]))}</code>`
  );
  const notes = [
    ...(place ? [`in ${text(place)}`] : []),
    required ? "required" : "optional",
    ...constraints
  ].join(", ");
  const description = node.description ? ` ${prose(node.description)}` : "";
  return `<li><code>${text(name)}</code> ${typeHtml(writer, schema)} <small>${notes}</small>${description}${fieldsHtml(writer, schema)}</li>`;
}

function codeList(values: readonly string[]): string {
  return values.map((value) => `<code>${text(value)}</code>`).join(", ");
}

function lastSegment(reference: string): string {
  return reference.slice(reference.lastIndexOf("/") + 1);
}

function schemaAnchor(name: string): string {
  return `schema-${anchor(name)}`;
}

function operationAnchor(id: string): string {
  return `operation-${anchor(id)}`;
}

function tagAnchor(tag: string): string {
  return `tag-${anchor(tag)}`;
}

function anchor(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-");
}

/** Escapes text for HTML content and for a quoted attribute. */
function text(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Escaped text in which a span between backticks is code. */
function prose(value: string): string {
  return text(value).replaceAll(/`([^`]+)`/gu, "<code>$1</code>");
}

function colorRule(colors: ApiReferenceColors): string {
  const declarations = Object.entries({
    "--reference-surface": colors.surfaceColor,
    "--reference-background": colors.backgroundColor,
    "--reference-text": colors.textColor,
    "--reference-muted": colors.mutedTextColor,
    "--reference-border": colors.borderColor,
    "--reference-accent": colors.accentColor
  }).map(([name, value]) => {
    // Theme colours are free text of the instance's configuration: nothing that could close
    // the declaration, the rule or the style element may pass.
    if (!/^[#a-zA-Z0-9\s.,()%+/-]+$/u.test(value)) {
      throw new Error(`Unsupported CSS value for ${name}`);
    }
    return `${name}:${value.trim()};`;
  });
  return `:root{${declarations.join("")}}`;
}

const PAGE_STYLE = [
  "*{box-sizing:border-box}",
  "body{margin:0;font-family:system-ui,sans-serif;line-height:1.5;color:var(--reference-text);background:var(--reference-background)}",
  "a{color:var(--reference-accent)}",
  "header{display:flex;flex-wrap:wrap;gap:1rem;align-items:baseline;justify-content:space-between;padding:1rem 1.5rem;background:var(--reference-surface);border-bottom:1px solid var(--reference-border)}",
  "h1{margin:0;font-size:1.25rem}",
  "h2{margin:2.5rem 0 1rem;font-size:1.25rem}",
  "h3{margin:0 0 .5rem;font-size:1rem}",
  "h4{margin:1rem 0 .25rem;font-size:.875rem;color:var(--reference-muted)}",
  ".layout{display:grid;grid-template-columns:18rem minmax(0,1fr)}",
  "nav{position:sticky;top:0;align-self:start;max-height:100vh;overflow:auto;padding:1rem 1.5rem;font-size:.875rem;border-right:1px solid var(--reference-border)}",
  "nav ul{margin:0;padding:0;list-style:none}",
  "nav ul ul{margin:.25rem 0 .75rem;padding-left:.75rem}",
  "nav li{margin:.25rem 0}",
  "nav a{text-decoration:none}",
  "nav>ul>li>a{font-weight:600;color:var(--reference-text)}",
  "nav ul ul a{color:var(--reference-muted)}",
  "nav a:hover,nav a:focus-visible{text-decoration:underline}",
  "main{min-width:0;max-width:60rem;padding:0 1.5rem 4rem}",
  "article{margin:1rem 0;padding:1rem 1.25rem;background:var(--reference-surface);border:1px solid var(--reference-border);border-radius:.5rem}",
  "code{font-family:ui-monospace,monospace;font-size:.875em;overflow-wrap:anywhere}",
  "small{color:var(--reference-muted)}",
  ".api-route{margin:0 0 .75rem}",
  ".api-facts{display:grid;grid-template-columns:max-content 1fr;gap:.125rem 1rem;margin:0;font-size:.875rem}",
  ".api-facts dt{color:var(--reference-muted)}",
  ".api-facts dd{margin:0}",
  ".api-fields{margin:.25rem 0;padding-left:1.25rem;font-size:.875rem}",
  ".api-fields .api-fields{border-left:1px solid var(--reference-border)}",
  "article p{margin:.25rem 0;font-size:.875rem}",
  ":target{scroll-margin-top:1rem;outline:2px solid var(--reference-accent);outline-offset:.25rem}",
  "@media (max-width:48rem){.layout{grid-template-columns:minmax(0,1fr)}nav{position:static;max-height:none;border-right:0;border-bottom:1px solid var(--reference-border)}}"
].join("");
