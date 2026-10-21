import {
  ACCESS_SOURCES,
  GRANT_EFFECTS,
  GRANT_HOLDER_KINDS,
  GRANT_SCOPE_KINDS,
  PRINCIPAL_HOLDER_KINDS,
  ROLE_GRANT_SCOPE_KINDS,
  ROLE_PENDING_CHANGES,
  ROLE_PENDING_DECISIONS
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
 * `unknown_action`, `unknown_holder` or `duplicate_grant`. A service
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
      /**
       * `membership`: held by being a member of the workspace the entry names, such as opening
       * the published Apps of that workspace. A legacy permission list is grant rows since AP-4
       * and reads as `grant`.
       */
      source: z.enum(ACCESS_SOURCES),
      /** The role the entry is held through, for the source `role`. */
      roleId: z.string().optional()
    })
  )
});

/**
 * Keeps one role small. The default of `admin` has about fifty grants and a custom role is a
 * short list; a longer one is refused as a validation error that names this limit.
 */
export const ROLE_GRANTS_MAX = 500;

/** One right a role holds, at its scope: the instance, one workspace or one asset. */
export const roleGrantSchema = z.object({
  action: storedText,
  effect: grantEffectSchema.default("allow"),
  scopeKind: z.enum(ROLE_GRANT_SCOPE_KINDS),
  /** The workspace id for workspace scope, the asset id for asset scope. */
  scopeId: storedText.optional()
});

const roleGrantsSchema = z.array(roleGrantSchema).max(ROLE_GRANTS_MAX, {
  message: `A role holds at most ${ROLE_GRANTS_MAX} grants`
});

/**
 * An action a release added to (`added`) or took out of (`removed`) the default of a built-in
 * role that a superadmin had edited. It waits for a superadmin's decision.
 */
export const rolePendingActionSchema = z.object({
  action: z.string(),
  change: z.enum(ROLE_PENDING_CHANGES)
});

/**
 * A role of the instance. `user` and `admin` are built in: a superadmin edits and resets them,
 * and nobody renames or deletes them. `superadmin` is built in and read-only: it holds every
 * action of the release except `assets.release`. A custom role is written by a holder of
 * `users.manage`.
 */
export const roleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  builtIn: z.boolean(),
  /** False for `superadmin` only. */
  editable: z.boolean(),
  grants: z.array(roleGrantSchema),
  /** For a built-in role: the release's default, what "Reset to default" restores. */
  defaultGrants: z.array(roleGrantSchema).optional(),
  /** For a built-in role: whether its grants are the release's default. */
  equalsDefault: z.boolean().optional(),
  pendingActions: z.array(rolePendingActionSchema)
});

const roleNameSchema = z.string().trim().min(1).max(80);
const roleDescriptionSchema = z.string().trim().max(500);

export const createRoleRequestSchema = z.object({
  name: roleNameSchema,
  description: roleDescriptionSchema.optional(),
  grants: roleGrantsSchema
});

/**
 * What is left out stays as it is; `grants` replaces every grant of the role. A built-in role
 * takes `grants` only, and its first edit stores it.
 */
export const updateRoleRequestSchema = z.object({
  name: roleNameSchema.optional(),
  description: roleDescriptionSchema.nullable().optional(),
  grants: roleGrantsSchema.optional()
});

/**
 * The decision on one pending action. `apply` adds an `added` action at instance scope, or
 * takes a `removed` one away; `dismiss` leaves the role as it is. Either way it is no longer
 * pending.
 */
export const decideRolePendingActionRequestSchema = z.object({
  action: storedText,
  decision: z.enum(ROLE_PENDING_DECISIONS)
});

/**
 * Keeps one workspace record small. An instance registers tens of tools and model
 * bindings; a longer list is refused as a validation error that names this limit.
 */
export const BUILD_LIMIT_LIST_MAX_ENTRIES = 500;

/** A build limit: `null` does not restrict; an empty list allows nothing. */
const buildLimitListSchema = z
  .array(z.string().min(1))
  .max(BUILD_LIMIT_LIST_MAX_ENTRIES, {
    message: `A list of tools or model bindings holds at most ${BUILD_LIMIT_LIST_MAX_ENTRIES} entries`
  })
  .nullable();

/**
 * A Shared Workspace with its build limits: the tools and model bindings the agents it owns may
 * use (WS-BUILD-1). An instance admin sets them; a workspace owner cannot.
 */
export const workspaceBuildLimitsSchema = z.object({
  id: z.string(),
  name: z.string(),
  allowedToolNames: buildLimitListSchema,
  allowedModelBindingIds: buildLimitListSchema
});

/** A list left out is kept as it is; `null` lifts it. */
export const updateWorkspaceBuildLimitsRequestSchema = z.object({
  allowedToolNames: buildLimitListSchema.optional(),
  allowedModelBindingIds: buildLimitListSchema.optional()
});

export type PermissionGrantRow = z.infer<typeof permissionGrantSchema>;
export type Role = z.infer<typeof roleSchema>;
export type RoleGrantInput = z.input<typeof roleGrantSchema>;
export type CreatePermissionGrantRequest = z.input<typeof createPermissionGrantRequestSchema>;
export type EffectivePermissions = z.infer<typeof effectivePermissionsSchema>;
export type WorkspaceBuildLimits = z.infer<typeof workspaceBuildLimitsSchema>;
export type UpdateWorkspaceBuildLimitsRequest = z.input<
  typeof updateWorkspaceBuildLimitsRequestSchema
>;
