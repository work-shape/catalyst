import {
  ACCESS_SOURCES,
  GRANT_EFFECTS,
  GRANT_HOLDER_KINDS,
  GRANT_SCOPE_KINDS,
  NAMESPACE_PREFIX_MAX_LENGTH,
  NAMESPACE_PREFIX_MIN_LENGTH,
  NAMESPACE_PREFIX_PATTERN,
  PRINCIPAL_HOLDER_KINDS
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { listQuerySchema, timestampSchema } from "./shared";

export const grantHolderKindSchema = z.enum(GRANT_HOLDER_KINDS);
export const grantScopeKindSchema = z.enum(GRANT_SCOPE_KINDS);
export const grantEffectSchema = z.enum(GRANT_EFFECTS);

/**
 * Text a grant row holds or is looked up by. No store holds a NUL byte, and a refusal that
 * repeats one cannot be recorded, so none is accepted.
 */
const storedText = z
  .string()
  .min(1)
  .refine((value) => !value.includes("\u0000"), "The text must not contain a NUL byte");

/** One row of who may do an action on a scope. A matching deny wins over every allow. */
export const permissionGrantSchema = z.object({
  id: z.string(),
  holderKind: grantHolderKindSchema,
  holderId: z.string(),
  action: z.string(),
  effect: grantEffectSchema,
  scopeKind: grantScopeKindSchema,
  /** The asset id for asset scope, the workspace id for workspace scope. */
  scopeId: z.string().optional(),
  /** The registered prefix, for Namespace scope. */
  namespace: z.string().optional(),
  /**
   * The asset behind `scopeId`, for asset scope. A deny stays when its asset is deleted and
   * applies again when the name is created again; `active` is false in between. `name` is
   * left out for a caller who may not read every asset of that kind.
   */
  scopeAsset: z
    .object({ kind: z.string(), name: z.string().optional(), active: z.boolean() })
    .optional(),
  /** Left out when the user who wrote the row is hidden from the caller. */
  grantedBy: z.string().optional(),
  createdAt: timestampSchema
});

/**
 * The row shape takes every holder and scope kind. Which of them can be written is the
 * server's answer: `details.reason` is `invalid_scope`, `action_not_grantable`,
 * `unknown_action`, `unknown_holder`, `unknown_namespace` or `duplicate_grant`. A service
 * principal is allowed a use right on one named asset and nothing else:
 * `action_not_grantable_to_principal`, `effect_not_grantable_to_principal` and
 * `invalid_scope`; a caller who may not write a row for the holder is refused with
 * `holder_not_administrable`.
 */
export const createPermissionGrantRequestSchema = z.object({
  holderKind: grantHolderKindSchema,
  holderId: storedText,
  action: storedText,
  scopeKind: grantScopeKindSchema,
  scopeId: storedText.optional(),
  namespace: storedText.optional(),
  effect: grantEffectSchema.default("allow")
});

export const listPermissionGrantsQuerySchema = listQuerySchema.extend({
  holderKind: grantHolderKindSchema.optional(),
  holderId: storedText.optional(),
  action: storedText.optional(),
  scopeKind: grantScopeKindSchema.optional(),
  /**
   * The asset or the workspace the rows name: with `scopeKind: "asset"`, who holds a right on
   * that one asset. A service principal's rows are among them only for a caller who is shown
   * service principals; for anyone else the answer is the same as if there were none.
   */
  scopeId: storedText.optional()
});

export const effectivePermissionsQuerySchema = z.object({
  holderKind: z.enum(PRINCIPAL_HOLDER_KINDS),
  holderId: storedText
});

/** Everything that allows or denies a holder something, each with the source that says so. */
export const effectivePermissionsSchema = z.object({
  /** A holder that is not active holds nothing, whatever the entries say. */
  holderActive: z.boolean(),
  items: z.array(
    z.object({
      action: z.string(),
      effect: grantEffectSchema,
      scopeKind: grantScopeKindSchema,
      scopeId: z.string().optional(),
      namespace: z.string().optional(),
      /**
       * `membership`: held by being a member of the workspace the entry names, such as opening
       * the published Apps of that workspace. A legacy permission list is grant rows since AP-4
       * and reads as `grant`.
       */
      source: z.enum(ACCESS_SOURCES)
    })
  )
});

export const namespacePrefixSchema = z
  .string()
  .min(NAMESPACE_PREFIX_MIN_LENGTH)
  .max(NAMESPACE_PREFIX_MAX_LENGTH)
  .regex(NAMESPACE_PREFIX_PATTERN);

/**
 * Keeps one Namespace record small. An instance registers tens of tools and model bindings; a
 * longer list is refused as a validation error that names this limit.
 */
export const NAMESPACE_ALLOWLIST_MAX_ENTRIES = 500;

/** `null` does not restrict; an empty list allows nothing. */
const namespaceAllowlistSchema = z
  .array(z.string().min(1))
  .max(NAMESPACE_ALLOWLIST_MAX_ENTRIES, {
    message: `A Namespace allowlist holds at most ${NAMESPACE_ALLOWLIST_MAX_ENTRIES} entries`
  })
  .nullable();

export const namespaceSchema = z.object({
  prefix: z.string(),
  displayName: z.string(),
  allowedToolNames: namespaceAllowlistSchema,
  allowedModelBindingIds: namespaceAllowlistSchema,
  /** Left out when the user who registered it is hidden from the caller. */
  createdBy: z.string().optional(),
  createdAt: timestampSchema
});

export const namespaceUsageSchema = namespaceSchema.extend({
  /** Grant rows that name the prefix. While there is one, the Namespace cannot be deleted. */
  grantCount: z.number().int().nonnegative(),
  /** Active agents and skills whose names start with the prefix. */
  assetCount: z.number().int().nonnegative()
});

export const createNamespaceRequestSchema = z.object({
  prefix: namespacePrefixSchema,
  displayName: z.string().trim().min(1).max(120),
  allowedToolNames: namespaceAllowlistSchema.optional(),
  allowedModelBindingIds: namespaceAllowlistSchema.optional()
});

/** The prefix is fixed. A list left out is kept as it is. */
export const updateNamespaceRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  allowedToolNames: namespaceAllowlistSchema.optional(),
  allowedModelBindingIds: namespaceAllowlistSchema.optional()
});

export type PermissionGrantRow = z.infer<typeof permissionGrantSchema>;
export type CreatePermissionGrantRequest = z.input<typeof createPermissionGrantRequestSchema>;
export type EffectivePermissions = z.infer<typeof effectivePermissionsSchema>;
export type NamespaceWithUsage = z.infer<typeof namespaceUsageSchema>;
export type CreateNamespaceRequest = z.input<typeof createNamespaceRequestSchema>;
export type UpdateNamespaceRequest = z.input<typeof updateNamespaceRequestSchema>;
