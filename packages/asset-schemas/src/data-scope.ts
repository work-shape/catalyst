import { GRANT_EFFECTS } from "./contract-values";
import { z } from "zod";

/** One instance's data separation dimension. SCOPE-1 serves one dimension. */
export const dataScopeNameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/u);
export const dataScopesSchema = z
  .record(
    dataScopeNameSchema,
    z.strictObject({
      label: z.string().trim().min(1).max(120),
      valueType: z.literal("text")
    })
  )
  .refine(
    (dimensions) => Object.keys(dimensions).length <= 1,
    "One data scope dimension is supported"
  );
export type DataScopes = z.infer<typeof dataScopesSchema>;
export const scopeAssignmentInputSchema = z.strictObject({
  dimension: dataScopeNameSchema,
  holderKind: z.enum(["user", "group", "service_principal"]),
  holderId: z
    .string()
    .min(1)
    .max(200)
    .refine((value) => !value.includes("\u0000"), "NUL is not allowed"),
  effect: z.enum(GRANT_EFFECTS),
  values: z.union([
    z.literal("all"),
    z
      .array(
        z
          .string()
          .min(1)
          .max(200)
          .refine((value) => !value.includes("\u0000"), "NUL is not allowed")
      )
      .max(10000)
  ])
});
export type ScopeAssignmentInput = z.infer<typeof scopeAssignmentInputSchema>;

const identifier = z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/u);
export const scopedTablesSchema = z.record(
  identifier,
  z.strictObject({
    scope: z
      .record(dataScopeNameSchema, identifier)
      .refine((scope) => Object.keys(scope).length === 1, "A scoped table names one dimension")
  })
);
export type ScopedTables = z.infer<typeof scopedTablesSchema>;
