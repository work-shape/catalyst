import {
  OPERATION_CHANGE_CLASSES,
  OPERATION_EFFECTS,
  POLICY_VALUES,
  ALWAYS_ALLOW_LOCK_SOURCES,
  READING_POLICY_VALUES
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { timestampSchema } from "./shared";

// Instance > Policies (OP-2): every operation with its effect, change class and policy value,
// the admin's central settings by operation or name pattern, narrowed to a workspace and an
// asset kind, and the locks of "Always allow". The release's own defaults are read-only here.

export const policyValueSchema = z.enum(POLICY_VALUES);

/** Where the operations of a row come from, as the screen groups them. */
export const POLICY_OPERATION_KINDS = [
  "tool",
  "connection",
  "app",
  "workflow",
  "data_store",
  "knowledge_base",
  "platform"
] as const;

/** Where the value of a row comes from. */
export const POLICY_VALUE_SOURCES = [
  "instance_default",
  "declared_default",
  "central_setting",
  "policy_floor"
] as const;

/** For the screen: the values a setting takes, the two of a reading operation, and who locked. */
export { ALWAYS_ALLOW_LOCK_SOURCES, POLICY_VALUES, READING_POLICY_VALUES };

/**
 * An operation or every operation under a prefix: `connection.crm.send`, `connection.crm.*`. A
 * bare `*` or a part cut off, `connection.cr*`, names no operation.
 */
export const policyOperationPatternSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_][A-Za-z0-9_-]*)*(?:\.\*)?$/u, {
    message:
      "Name an operation exactly, or every operation under a prefix such as 'connection.crm.*'"
  });

/** One operation as the Policies screen lists it. */
export const policyOperationSchema = z.object({
  operation: z.string(),
  title: z.string().optional(),
  kind: z.enum(POLICY_OPERATION_KINDS),
  effect: z.enum(OPERATION_EFFECTS),
  /** Of a change alone; a change that declares none counts as `irreversible`. */
  changeClass: z.enum(OPERATION_CHANGE_CLASSES).optional(),
  /**
   * What a call of the operation resolves to before anyone's own setting and any guardrail,
   * where no setting narrowed to a workspace or an asset kind matches it.
   */
  value: policyValueSchema,
  source: z.enum(POLICY_VALUE_SOURCES),
  /** The release's own value for the operation, where it declares one. */
  declaredDefault: policyValueSchema.optional(),
  /** A value no call is looser than, whatever a setting says. */
  floor: policyValueSchema.optional(),
  /** Whether people may set "Always allow" for it: its class permits it and no lock names it. */
  mayAlwaysAllow: z.boolean(),
  /** The lock that names it, by name or by pattern. The release's wins over an admin's here. */
  alwaysAllowLock: z.enum(ALWAYS_ALLOW_LOCK_SOURCES).optional()
});

/** One central setting of an admin. */
export const policySettingSchema = z.object({
  operation: z.string(),
  value: policyValueSchema,
  workspaceId: z.string().optional(),
  /** The workspace's name, absent where it cannot be read. */
  workspaceName: z.string().optional(),
  assetKind: z.string().optional(),
  updatedAt: timestampSchema
});

/** One lock of "Always allow", by name or pattern. */
export const alwaysAllowLockSchema = z.object({
  operation: z.string(),
  source: z.enum(ALWAYS_ALLOW_LOCK_SOURCES),
  updatedAt: timestampSchema.optional()
});

export const policiesSchema = z.object({
  /** The release config's instance defaults by effect. */
  defaults: z.object({
    reading: z.enum(READING_POLICY_VALUES),
    changing: policyValueSchema
  }),
  /** Whether people may always allow a change of each class where no lock names it. */
  alwaysAllowByClass: z.object({
    reversible: z.boolean(),
    irreversible: z.boolean(),
    outward: z.boolean()
  }),
  operations: z.array(policyOperationSchema),
  settings: z.array(policySettingSchema),
  locks: z.array(alwaysAllowLockSchema),
  /** The shared workspaces a setting can be narrowed to. */
  workspaces: z.array(z.object({ id: z.string(), name: z.string() })),
  /** The asset kinds a setting can be narrowed to. */
  assetKinds: z.array(z.string()),
  /** Prefixes of which the listing leaves operations out, because a source read its limit. */
  truncated: z.array(z.object({ prefix: z.string(), limit: z.number().int() }))
});

export const setPolicySettingRequestSchema = z.object({
  operation: policyOperationPatternSchema,
  workspaceId: z.string().min(1).optional(),
  assetKind: z.string().min(1).max(100).optional(),
  /** `null` removes the setting: the default of the operation applies again. */
  value: policyValueSchema.nullable()
});

export const policySettingChangeSchema = z.object({
  /** The setting as it is now; absent where it was removed. */
  setting: policySettingSchema.optional(),
  previous: policyValueSchema.optional()
});

export const setAlwaysAllowLockRequestSchema = z.object({
  operation: policyOperationPatternSchema,
  locked: z.boolean()
});

export const alwaysAllowLockChangeSchema = z.object({
  operation: z.string(),
  locked: z.boolean(),
  wasLocked: z.boolean()
});

export type Policies = z.infer<typeof policiesSchema>;
export type PolicyOperation = z.infer<typeof policyOperationSchema>;
export type PolicySetting = z.infer<typeof policySettingSchema>;
export type AlwaysAllowLock = z.infer<typeof alwaysAllowLockSchema>;
export type PolicyOperationKind = (typeof POLICY_OPERATION_KINDS)[number];
export type SetPolicySettingRequest = z.infer<typeof setPolicySettingRequestSchema>;
