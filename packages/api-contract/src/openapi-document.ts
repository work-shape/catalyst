import { z } from "zod";

const jsonSchemaSchema = z.record(z.string(), z.unknown());
const mediaTypesSchema = z.record(z.string(), z.object({ schema: jsonSchemaSchema }));
const referenceSchema = z.object({ $ref: z.string() });
const headerSchema = z.object({ description: z.string(), schema: jsonSchemaSchema });
const responseSchema = z.object({
  description: z.string(),
  headers: z.record(z.string(), referenceSchema).optional(),
  content: mediaTypesSchema.optional()
});
const parameterSchema = z.object({
  name: z.string(),
  in: z.enum(["path", "query", "header"]),
  description: z.string().optional(),
  required: z.boolean(),
  schema: jsonSchemaSchema
});
const securityRequirementSchema = z.record(z.string(), z.array(z.string()));
const operationSchema = z.object({
  operationId: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
  security: z.array(securityRequirementSchema),
  parameters: z.array(parameterSchema),
  requestBody: z.object({ required: z.boolean(), content: mediaTypesSchema }).optional(),
  responses: z.record(z.string(), z.union([referenceSchema, responseSchema])),
  "x-catalyst-effect": z.string(),
  "x-catalyst-requires": z.array(z.string()).optional(),
  "x-catalyst-rate-class": z.string()
});
const securitySchemeSchema = z.object({
  type: z.enum(["apiKey", "http"]),
  description: z.string(),
  in: z.enum(["cookie", "header"]).optional(),
  name: z.string().optional(),
  scheme: z.string().optional()
});

/** The OpenAPI 3.1 document as this product writes it: the subset its generator emits. */
export const openApiDocumentSchema = z.object({
  openapi: z.literal("3.1.0"),
  info: z.object({ title: z.string(), version: z.string(), description: z.string() }),
  servers: z.array(z.object({ url: z.string(), description: z.string() })),
  tags: z.array(z.object({ name: z.string() })),
  paths: z.record(z.string(), z.record(z.string(), operationSchema)),
  components: z.object({
    securitySchemes: z.record(z.string(), securitySchemeSchema),
    responses: z.record(z.string(), responseSchema),
    headers: z.record(z.string(), headerSchema).optional(),
    schemas: z.record(z.string(), jsonSchemaSchema)
  })
});

export type OpenApiDocument = z.infer<typeof openApiDocumentSchema>;
export type OpenApiOperation = z.infer<typeof operationSchema>;
export type OpenApiResponse = z.infer<typeof responseSchema>;
export type OpenApiJsonSchema = z.infer<typeof jsonSchemaSchema>;
