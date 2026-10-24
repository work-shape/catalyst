import {
  OPERATION_CHANGE_CLASSES,
  OPERATION_EFFECTS,
  PERSON_POLICY_SETTINGS
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { timestampSchema } from "./shared";

// A person's own confirmation settings (OP-6): per operation Always allow, Ask me or Never,
// for the calls their agents make for them, in chat and in their scheduled runs.

export const personPolicySettingSchema = z.enum(PERSON_POLICY_SETTINGS);

/** One operation as You > Confirmations lists it, with the person's value where they set one. */
export const operationSettingSchema = z.object({
  operation: z.string(),
  title: z.string().optional(),
  effect: z.enum(OPERATION_EFFECTS),
  /** Absent on a reading operation, and on a change that declares none (`irreversible`). */
  changeClass: z.enum(OPERATION_CHANGE_CLASSES).optional(),
  /** The person's value. Absent: the policy as the admin set it. */
  value: personPolicySettingSchema.optional(),
  /**
   * Whether the person may set "Always allow": a `reversible` change that no admin locked, that
   * the policy does not hold at `approval` or `deny` and whose own floor does not ask.
   */
  mayAlwaysAllow: z.boolean(),
  /** An admin's lock names the operation: the admin decides whether the call asks. */
  alwaysAllowLocked: z.literal(true).optional(),
  updatedAt: timestampSchema.optional()
});

/** The person's settings, and the operations their agents called lately, by name. */
export const operationSettingsSchema = z.object({ items: z.array(operationSettingSchema) });

export const setOperationSettingRequestSchema = z.object({
  operation: z.string().trim().min(1).max(300),
  /** `null` removes the setting: the policy as the admin set it applies again. */
  value: personPolicySettingSchema.nullable()
});

export type OperationSetting = z.infer<typeof operationSettingSchema>;
export type PersonPolicySettingValue = z.infer<typeof personPolicySettingSchema>;
