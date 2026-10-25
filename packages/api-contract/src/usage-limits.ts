import {
  MODEL_USAGE_LIMIT_PERIODS,
  USAGE_SPEND_LIMIT_LEVELS
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { timestampSchema } from "./shared";

// Spend limits at three levels (LU-2, limits spec 3.1): money per UTC day and per UTC month, in
// the currency of the Customer Rate Card, for the instance, for shared workspaces and for
// users. Every amount here is in that currency, not in micros.

/** The most one limit may be: far above any real budget, and safe as micros. */
const MAX_SPEND_LIMIT = 1_000_000_000;

const amountSchema = z.number().nonnegative().max(MAX_SPEND_LIMIT);

export const usageSpendLimitLevelSchema = z.enum(USAGE_SPEND_LIMIT_LEVELS);

/** A limit per day and per month. An absent amount is no limit. */
export const usageSpendAmountsSchema = z.object({
  daily: amountSchema.optional(),
  monthly: amountSchema.optional()
});

/** A limit that is set, with when. */
export const usageSpendLimitSchema = usageSpendAmountsSchema.extend({
  updatedAt: timestampSchema.optional()
});

/** A value of one workspace or one user that replaces the default. */
export const usageSpendLimitOverrideSchema = usageSpendLimitSchema.extend({
  id: z.string(),
  /** The workspace's or the person's name, absent where it cannot be read. */
  name: z.string().optional()
});

/** A workspace or a user at or above 80 percent of its limit: the limit and the share, no amount. */
export const usageNearLimitSchema = z.object({
  kind: usageSpendLimitLevelSchema.extract(["workspace", "user"]),
  id: z.string(),
  name: z.string().optional(),
  period: z.enum(MODEL_USAGE_LIMIT_PERIODS),
  limit: z.number(),
  /** Of the limit, rounded down; 100 and above is reached. */
  percent: z.number().int().nonnegative()
});

/** A workspace or a user a limit can name. */
export const usageLimitTargetSchema = z.object({ id: z.string(), name: z.string() });

/** Settings > Instance > Limits. */
export const usageLimitsSchema = z.object({
  /** The currency of every amount; absent while the instance has no Customer Rate Card. */
  currency: z.string().optional(),
  /** The release config's values: an instance limit may not be set above them. */
  ceiling: usageSpendAmountsSchema,
  /** What an admin set for the instance. Absent: the ceiling applies. */
  instance: usageSpendLimitSchema.optional(),
  /** The instance limits as they hold: what was set, never above the ceiling. */
  effectiveInstance: usageSpendAmountsSchema,
  workspaceDefault: usageSpendLimitSchema.optional(),
  userDefault: usageSpendLimitSchema.optional(),
  workspaces: z.array(usageSpendLimitOverrideSchema),
  users: z.array(usageSpendLimitOverrideSchema),
  nearLimit: z.array(usageNearLimitSchema),
  /** The shared workspaces and the active users a value of their own can be set for. */
  workspaceOptions: z.array(usageLimitTargetSchema),
  userOptions: z.array(usageLimitTargetSchema)
});

export const setUsageSpendLimitRequestSchema = z
  .object({
    level: usageSpendLimitLevelSchema,
    /** The workspace of `workspace`, the user of `user`; nothing for the other levels. */
    target: z.string().trim().min(1).max(200).optional(),
    /**
     * The new limit; an absent amount is no limit. `null` removes what the level holds: the
     * default applies again to one workspace or user, no limit to a default, and the release
     * config's ceiling to the instance.
     */
    limits: usageSpendAmountsSchema.nullable()
  })
  .refine((input) => (input.level === "workspace" || input.level === "user") === !!input.target, {
    message: "A target is named for the levels workspace and user, and for no other",
    path: ["target"]
  });

/** The level as it is after the change. */
export const usageSpendLimitChangeSchema = z.object({
  level: usageSpendLimitLevelSchema,
  target: z.string().optional(),
  /** Absent once removed. */
  limits: usageSpendAmountsSchema.optional()
});

/** One period of a limit as a person reads it. Amounts only where they may see them. */
export const usageSpendPeriodSchema = z.object({
  spent: z.number().optional(),
  limit: z.number().optional(),
  /**
   * What is left before the limit stops calls, where amounts are shown. The 80 percent note and
   * `reached` are both measured against `spent + left`, which a private safety margin may set
   * below `limit`.
   */
  left: z.number().optional(),
  /** Set where a limit is set: whether it is reached. */
  reached: z.boolean().optional(),
  /** When the period ends: midnight UTC, or the first of next month UTC. */
  resetsAt: timestampSchema
});

export const usageSpendLevelSchema = z.object({
  day: usageSpendPeriodSchema,
  month: usageSpendPeriodSchema
});

/** The caller's own consumption and the limits in their way (LU-2). */
export const ownUsageSchema = z.object({
  currency: z.string().optional(),
  /** Their own calls against their own limit, amounts always shown. */
  own: usageSpendLevelSchema,
  /** The shared workspace asked about; amounts only for its owners and for admins. */
  workspace: usageSpendLevelSchema.extend({ id: z.string() }).optional(),
  /** The instance; amounts only for admins. */
  instance: usageSpendLevelSchema
});

export const ownUsageQuerySchema = z.object({
  workspaceId: z.string().trim().min(1).max(200).optional()
});

export type UsageSpendAmountsInput = z.infer<typeof usageSpendAmountsSchema>;
export type UsageLimits = z.infer<typeof usageLimitsSchema>;
export type UsageSpendLimitOverride = z.infer<typeof usageSpendLimitOverrideSchema>;
export type UsageNearLimit = z.infer<typeof usageNearLimitSchema>;
export type SetUsageSpendLimitRequest = z.infer<typeof setUsageSpendLimitRequestSchema>;
export type OwnUsage = z.infer<typeof ownUsageSchema>;
export type UsageSpendPeriod = z.infer<typeof usageSpendPeriodSchema>;
