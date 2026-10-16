import {
  AUDIT_ACTOR_KINDS,
  AUDIT_OUTCOMES,
  AUDIT_TIERS,
  MODEL_USAGE_EVENT_STATUSES,
  MODEL_USAGE_SOURCES,
  USAGE_COST_STATUSES
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { usageSafeguardsSchema } from "./configuration";
import { auditActorSchema } from "./identity";
import { timestampSchema } from "./shared";

export const auditEventSchema = z.object({
  id: z.string(),
  clientInstanceId: z.string(),
  type: z.string(),
  status: z.string(),
  actor: auditActorSchema.optional(),
  subject: z.string().optional(),
  reason: z.string().optional(),
  correlationId: z.string(),
  createdAt: timestampSchema,
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const auditActivityActorSchema = z.object({
  kind: z.enum(AUDIT_ACTOR_KINDS),
  label: z.string(),
  onBehalfOf: z.string().optional(),
  roles: z.array(z.string()).optional()
});

export const auditActivityTargetSchema = z.object({
  kind: z.string(),
  id: z.string(),
  label: z.string().optional()
});

export const auditActivitySchema = z.object({
  correlationId: z.string(),
  at: timestampSchema,
  label: z.string(),
  tier: z.enum(AUDIT_TIERS),
  outcome: z.enum(AUDIT_OUTCOMES),
  actor: auditActivityActorSchema,
  target: auditActivityTargetSchema.optional(),
  reason: z.string().optional(),
  eventCount: z.number().int().nonnegative(),
  repeatCount: z.number().int().nonnegative(),
  evidence: z.array(auditEventSchema)
});

export const modelUsageVolumeEventSchema = z.object({
  id: z.string(),
  /**
   * Where the call stands. `pending`: it has not ended and its amounts are not known yet.
   * `settled`: it ended with the usage its provider reported. `failed`: it ended without an
   * answer. `abandoned`: it never ended as far as the instance knows.
   */
  status: z.enum(MODEL_USAGE_EVENT_STATUSES),
  clientInstanceId: z.string(),
  conversationId: z.string().optional(),
  agentRunId: z.string().optional(),
  /** The agent of the run. A call the product made for itself carries its purpose here too. */
  agentName: z.string(),
  /** What a call the product made for itself was for, such as `conversation_title`. */
  purpose: z.string().optional(),
  providerId: z.string(),
  model: z.string(),
  /** Where the provider processed the call. Absent for a provider inside the instance. */
  region: z.string().optional(),
  inputTokens: z.number(),
  cachedInputTokens: z.number().optional(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  webSearchCallCount: z.number().int().nonnegative(),
  billedAsFast: z.boolean(),
  source: z.enum(MODEL_USAGE_SOURCES),
  correlationId: z.string(),
  createdAt: timestampSchema
});

export const modelUsageVolumeWindowSummarySchema = z.object({
  start: timestampSchema.optional(),
  end: timestampSchema.optional(),
  modelCallCount: z.number(),
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  webSearchCallCount: z.number().int().nonnegative()
});

export const modelUsageBillableCostSchema = z.object({
  status: z.enum(USAGE_COST_STATUSES),
  currency: z.string().optional(),
  uncachedInputBillableCostMicros: z.number().int().nonnegative().optional(),
  cachedInputBillableCostMicros: z.number().int().nonnegative().optional(),
  outputBillableCostMicros: z.number().int().nonnegative().optional(),
  webSearchBillableCostMicros: z.number().int().nonnegative().optional(),
  billableCostMicros: z.number().int().nonnegative().optional(),
  complete: z.boolean(),
  webSearchCostVisible: z.boolean()
});

export const modelUsageBillableCostSummarySchema = modelUsageBillableCostSchema.extend({
  settledModelCallCount: z.number().int().nonnegative(),
  incompleteModelCallCount: z.number().int().nonnegative(),
  settledWebSearchCallCount: z.number().int().nonnegative(),
  incompleteWebSearchCallCount: z.number().int().nonnegative()
});

export const modelUsageEventSchema = modelUsageVolumeEventSchema.extend({
  cost: modelUsageBillableCostSchema
});

export const modelUsageWindowSummarySchema = modelUsageVolumeWindowSummarySchema.extend({
  cost: modelUsageBillableCostSummarySchema
});

export const modelUsageDailyBucketSchema = modelUsageWindowSummarySchema.extend({
  date: z.string()
});

export const modelUsageMonthlyBucketSchema = modelUsageWindowSummarySchema.extend({
  month: z.string()
});

/** What one purpose or one agent used of one model on one day. */
export const modelUsageAttributionGroupSchema = modelUsageWindowSummarySchema.extend({
  date: z.string(),
  model: z.string(),
  providerId: z.string(),
  region: z.string().optional(),
  purpose: z.string().optional(),
  agentName: z.string().optional()
});

export const usageSpendBudgetSchema = z.object({
  currency: z.string().optional(),
  dailyLimitMicros: z.number().int().nonnegative().optional(),
  monthlyLimitMicros: z.number().int().nonnegative().optional()
});

export const usageSummarySchema = z.object({
  generatedAt: timestampSchema,
  spendBudget: usageSpendBudgetSchema,
  safeguards: usageSafeguardsSchema,
  today: modelUsageWindowSummarySchema,
  currentMonth: modelUsageWindowSummarySchema,
  allTime: modelUsageWindowSummarySchema,
  dailyUsage: z.array(modelUsageDailyBucketSchema),
  monthlyUsage: z.array(modelUsageMonthlyBucketSchema),
  /** The days of `dailyUsage`, split by model, provider, region and purpose or agent. */
  attributedUsage: z.array(modelUsageAttributionGroupSchema).optional(),
  recentEvents: z.array(modelUsageEventSchema)
});

export type AuditEvent = z.infer<typeof auditEventSchema>;
export type AuditActivity = z.infer<typeof auditActivitySchema>;
export type AuditActivityActor = z.infer<typeof auditActivityActorSchema>;
export type AuditActivityTarget = z.infer<typeof auditActivityTargetSchema>;
export type ModelUsageVolumeEvent = z.infer<typeof modelUsageVolumeEventSchema>;
export type ModelUsageBillableCost = z.infer<typeof modelUsageBillableCostSchema>;
export type ModelUsageBillableCostSummary = z.infer<typeof modelUsageBillableCostSummarySchema>;
export type ModelUsageEvent = z.infer<typeof modelUsageEventSchema>;
export type ModelUsageDailyBucket = z.infer<typeof modelUsageDailyBucketSchema>;
export type ModelUsageMonthlyBucket = z.infer<typeof modelUsageMonthlyBucketSchema>;
export type UsageSummary = z.infer<typeof usageSummarySchema>;
