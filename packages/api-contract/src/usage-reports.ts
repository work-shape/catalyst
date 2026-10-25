import {
  PERSONAL_WORKSPACES_KEY,
  USAGE_BREAKDOWN_DIMENSIONS,
  USAGE_ORIGINS
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import {
  modelUsageDailyBucketSchema,
  modelUsageWindowSummarySchema,
  usageActivitySchema,
  type ModelUsageDailyBucket,
  type UsageActivity,
  type UsageWindowSummary
} from "./governance";

// The Usage page (LU-3, limits spec 3.3 and 3.4): the Breakdown with its "group by", the Users
// view, and a shared workspace's Usage tab. Every figure is a sum of a day or a month; nothing
// here says when a person was active (3.4).

const DAY = /^\d{4}-\d{2}-\d{2}$/u;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/u;

/** A UTC day that exists: `2026-02-30` is refused here, not by the database. */
const daySchema = z
  .string()
  .regex(DAY)
  .refine(
    (day) => {
      const time = Date.parse(`${day}T00:00:00Z`);
      return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === day;
    },
    { message: "No such day" }
  );

/** The most days one Breakdown reads: a year and a day, far above a period anyone picks. */
export const USAGE_BREAKDOWN_MAX_DAYS = 366;

export const usageBreakdownDimensionSchema = z.enum(USAGE_BREAKDOWN_DIMENSIONS);
export const usageOriginSchema = z.enum(USAGE_ORIGINS);

const filterValue = z.string().max(200);

/** The period, from and to UTC days (`to` excluded), the dimension, and what it is narrowed to. */
export const usageBreakdownQuerySchema = z
  .object({
    from: daySchema,
    to: daySchema,
    groupBy: usageBreakdownDimensionSchema,
    workspace: filterValue.optional(),
    agent: filterValue.optional(),
    app: filterValue.optional(),
    workflow: filterValue.optional(),
    model: filterValue.optional(),
    origin: filterValue.optional()
  })
  .refine((query) => query.from < query.to, { message: "from must be before to", path: ["to"] })
  .refine(
    (query) =>
      (Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) / 86_400_000 <=
      USAGE_BREAKDOWN_MAX_DAYS,
    { message: `A period has at most ${USAGE_BREAKDOWN_MAX_DAYS} days`, path: ["from"] }
  );

/**
 * One row of the Breakdown. `key` is the value of the dimension: a shared workspace's id,
 * `personal` for all Personal Workspaces together, an agent, App or Workflow name, a model or an
 * origin; empty where usage has none. `name` is a shared workspace's name where it still exists.
 */
export const usageBreakdownRowSchema = modelUsageWindowSummarySchema.extend({
  key: z.string(),
  name: z.string().optional()
});

export type UsageBreakdownDimension = (typeof USAGE_BREAKDOWN_DIMENSIONS)[number];
export type UsageBreakdownRow = UsageWindowSummary & { key: string; name?: string | undefined };

export interface UsageBreakdown {
  from: string;
  to: string;
  groupBy: UsageBreakdownDimension;
  personalWorkspacesKey: typeof PERSONAL_WORKSPACES_KEY;
  total: UsageWindowSummary;
  rows: UsageBreakdownRow[];
}

export const usageBreakdownSchema: z.ZodType<UsageBreakdown> = z.object({
  from: z.string(),
  to: z.string(),
  groupBy: usageBreakdownDimensionSchema,
  /** The key every Personal Workspace shares: their usage is one row for everyone. */
  personalWorkspacesKey: z.literal(PERSONAL_WORKSPACES_KEY),
  total: modelUsageWindowSummarySchema,
  rows: z.array(usageBreakdownRowSchema)
});

export const usageMonthQuerySchema = z.object({
  /** `YYYY-MM`, a UTC month. Absent: the current one. */
  month: z.string().regex(MONTH).optional()
});

/**
 * One person's month in the Users view: what their own calls held on their spend counter, the
 * figure their limit is held against. Listed by name, never ranked (limits spec 3.4).
 */
export const usageUserMonthSchema = z.object({
  userId: z.string(),
  name: z.string(),
  /** In the currency of the Customer Rate Card. */
  spent: z.number().nonnegative(),
  modelCallCount: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative()
});

export interface UsageUserMonth {
  userId: string;
  name: string;
  spent: number;
  modelCallCount: number;
  tokens: number;
}

export interface UsageUsers {
  month: string;
  currency?: string | undefined;
  items: UsageUserMonth[];
}

export const usageUsersSchema: z.ZodType<UsageUsers> = z.object({
  month: z.string(),
  currency: z.string().optional(),
  items: z.array(usageUserMonthSchema)
});

/** A shared workspace's Usage tab: its month, its days and its Breakdown. */
export interface WorkspaceUsage {
  workspaceName: string;
  month: UsageWindowSummary;
  days: ModelUsageDailyBucket[];
  activity: UsageActivity;
  breakdown: UsageBreakdown;
  membersVisible: boolean;
}

export const workspaceUsageSchema: z.ZodType<WorkspaceUsage> = z.object({
  workspaceName: z.string(),
  month: modelUsageWindowSummarySchema,
  days: z.array(modelUsageDailyBucketSchema),
  activity: usageActivitySchema,
  breakdown: usageBreakdownSchema,
  /** Whether the caller may read the figures per member (`usage.view_users` for it). */
  membersVisible: z.boolean()
});

export const workspaceUsageQuerySchema = z
  .object({
    from: daySchema,
    to: daySchema,
    groupBy: usageBreakdownDimensionSchema.exclude(["workspace"]),
    agent: filterValue.optional(),
    app: filterValue.optional(),
    workflow: filterValue.optional(),
    model: filterValue.optional(),
    origin: filterValue.optional()
  })
  .refine((query) => query.from < query.to, { message: "from must be before to", path: ["to"] })
  .refine(
    (query) =>
      (Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) / 86_400_000 <=
      USAGE_BREAKDOWN_MAX_DAYS,
    { message: `A period has at most ${USAGE_BREAKDOWN_MAX_DAYS} days`, path: ["from"] }
  );

/** One member's month in a shared workspace: what they used there, and nowhere else. */
export const workspaceMemberUsageSchema = modelUsageWindowSummarySchema.extend({
  /** Absent for usage whose person is no longer recorded. */
  userId: z.string().optional(),
  name: z.string().optional()
});

export type WorkspaceMemberUsageItem = UsageWindowSummary & {
  userId?: string | undefined;
  name?: string | undefined;
};

export interface WorkspaceMembersUsage {
  month: string;
  items: WorkspaceMemberUsageItem[];
}

export const workspaceMembersUsageSchema: z.ZodType<WorkspaceMembersUsage> = z.object({
  month: z.string(),
  items: z.array(workspaceMemberUsageSchema)
});

export type UsageBreakdownQuery = z.infer<typeof usageBreakdownQuerySchema>;
export type WorkspaceUsageQuery = z.infer<typeof workspaceUsageQuerySchema>;
