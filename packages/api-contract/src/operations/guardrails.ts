import { GUARDRAIL_HIT_OUTCOMES, GUARDRAIL_OUTCOMES } from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { timestampSchema } from "../shared";
import { defineRegisteredOperation, json } from "./define-operation";

// What a Guardrail's page reads beyond the asset itself: the times it warned, held or blocked,
// and how often. The asset, with its event, check and outcome, is read through `assets.get`. A hit names
// no person: hits are counted by rule and period, never listed by person (works-council
// co-determination, §87(1) no. 6 BetrVG). Who made a request is in the audit log.

/** How many hits one read answers: the newest ones. The page says that older ones exist. */
export const GUARDRAIL_HITS_LIMIT = 50;

export const guardrailHitSchema = z.object({
  id: z.string(),
  /** The before-event the guardrail answered at, such as `asset.before_write`. */
  event: z.string(),
  outcome: z.enum(GUARDRAIL_HIT_OUTCOMES),
  /** The guardrail's reason, one sentence. Empty where the check could not run and it warned. */
  message: z.string(),
  /**
   * What was checked: the kind of an asset, such as `skill`, `operation` for a call, or the
   * kind of an approval request, such as `skill_change`.
   */
  subjectKind: z.string(),
  /** The asset's id, where the hit was on an asset that existed. */
  subjectId: z.string().optional(),
  /** The asset's name, or the operation's for a call. Absent on hits before they were named. */
  subjectName: z.string().optional(),
  /**
   * `require_approval` on a `block` where the guardrail asked for an approval the action could
   * not wait for, such as the App draft an agent's save of a Page writes.
   */
  convertedFrom: z.literal("require_approval").optional(),
  createdAt: timestampSchema
});

/** How often the guardrail warned or blocked, by the instance's clock. */
export const guardrailHitCountsSchema = z.object({
  last7Days: z.number().int().nonnegative(),
  last30Days: z.number().int().nonnegative()
});

export const guardrailHitsSchema = z.object({
  items: z.array(guardrailHitSchema),
  /** More hits exist than this answer holds. */
  hasMore: z.boolean(),
  counts: guardrailHitCountsSchema
});

export type GuardrailHitView = z.infer<typeof guardrailHitSchema>;
export type GuardrailHits = z.infer<typeof guardrailHitsSchema>;

/** How many days back a dry run looks: the recent events of the guardrail's event. */
export const GUARDRAIL_DRY_RUN_DAYS = 14;
/** The most subjects a dry run of a `model_judge` evaluates: each is a model call. */
export const GUARDRAIL_DRY_RUN_JUDGE_MAX = 200;
/** The most subjects a dry run of a `pattern` evaluates, the newest first. */
export const GUARDRAIL_DRY_RUN_PATTERN_MAX = 5_000;

const guardrailOutcomeSchema = z.enum(GUARDRAIL_OUTCOMES);

/** A revision of the Guardrail: the draft where none is named. */
const guardrailRevisionSchema = z.number().int().positive().optional();

export const testGuardrailRequestSchema = z
  .object({
    revision: guardrailRevisionSchema,
    /**
     * The content to check, by the fields the guardrail's event declares checkable, such as
     * `name` and `content` of an asset write or `input` of a call.
     */
    sample: z.record(z.string(), z.string().max(2 * 1024 * 1024)).optional(),
    /** An asset whose revision is checked as its write would be: the live one unless named. */
    asset: z
      .object({
        kind: z.string().min(1),
        name: z.string().min(1),
        revision: z.number().int().positive().optional()
      })
      .strict()
      .optional()
  })
  .strict();

/** What the draft would answer. Nothing is kept: no hit, no content. */
export const testGuardrailResponseSchema = z.object({
  revision: z.number().int().positive(),
  event: z.string(),
  outcome: guardrailOutcomeSchema,
  /** The reason in plain language. Empty where it allowed. */
  reason: z.string(),
  /**
   * Whether the guardrail's filter takes the asset named: one it would not apply to answers
   * as it would were it applied, so the check itself is tried.
   */
  appliesToAsset: z.boolean().optional()
});

export const dryRunGuardrailRequestSchema = z
  .object({ revision: guardrailRevisionSchema })
  .strict();

const dryRunCountSchema = z.object({
  /** The actions it would have answered so. */
  actions: z.number().int().nonnegative(),
  /** The people who took them, counted and never named. */
  people: z.number().int().nonnegative()
});

/**
 * What the guardrail would have answered over the recent events of its event, counted and
 * never named. Nothing is kept: no hit, no list of subjects.
 */
export const dryRunGuardrailResponseSchema = z.object({
  revision: z.number().int().positive(),
  event: z.string(),
  /** What a hit of this revision does: a `block` or a `require_approval` stops the action. */
  outcome: guardrailOutcomeSchema,
  days: z.number().int().positive(),
  since: timestampSchema,
  /** The actions of the period its filter and scope take. */
  matched: z.number().int().nonnegative(),
  /** Those checked again; fewer where the period held more than a dry run evaluates. */
  evaluated: z.number().int().nonnegative(),
  /**
   * Those whose content or whose origin and agent are not kept, so the check could not be
   * tried again: the calls of an operation, whose input is never stored, and the requests for
   * an approval.
   */
  notEvaluable: z.number().int().nonnegative(),
  /** The most a dry run of this check evaluates, where the period held more. */
  limitedTo: z.number().int().positive().optional(),
  wouldBlock: dryRunCountSchema,
  wouldRequireApproval: dryRunCountSchema,
  wouldWarn: dryRunCountSchema,
  /** Whether a revision of it was ever published. A first publish that would block asks to confirm the number. */
  published: z.boolean()
});

export const unpublishGuardrailResponseSchema = z.object({
  draftRevision: z.number().int().positive(),
  unpublishedRevision: z.number().int().positive()
});

/**
 * A guardrail the release ships, such as "Publishing needs an instance admin's approval": on
 * until an instance admin switches it off, with who switched it last.
 */
export const shippedGuardrailSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  /** What a person it stops or holds is told. */
  reason: z.string(),
  /** The before-events it is bound to, such as `app.before_publish`. */
  on: z.array(z.string()),
  outcome: guardrailOutcomeSchema,
  enabled: z.boolean(),
  /** Who switched it last and when. Absent while nobody has: it is on as the release ships it. */
  switchedBy: z.object({ id: z.string(), label: z.string() }).optional(),
  switchedAt: timestampSchema.optional(),
  /** The caller holds `guardrail.publish` at instance scope and may switch it. */
  canSwitch: z.boolean()
});

export const shippedGuardrailsSchema = z.object({ items: z.array(shippedGuardrailSchema) });

export const switchShippedGuardrailRequestSchema = z.object({ enabled: z.boolean() }).strict();

export type ShippedGuardrailView = z.infer<typeof shippedGuardrailSchema>;

export type TestGuardrailRequest = z.infer<typeof testGuardrailRequestSchema>;
export type TestGuardrailResponse = z.infer<typeof testGuardrailResponseSchema>;
export type DryRunGuardrailResponse = z.infer<typeof dryRunGuardrailResponseSchema>;

// The right is the Guardrail's own and is decided on the Guardrail the call names, so
// `requires` names none: reading its hits takes `guardrail.read`, testing and the dry run of
// its draft `guardrail.write`, taking it back `guardrail.publish` at its scope. A guardrail the
// release ships is the instance's: it is read with `guardrail.read` and switched with
// `guardrail.publish`, both at instance scope.
export const guardrailOperations = {
  "guardrails.list_hits": defineRegisteredOperation({
    id: "guardrails.list_hits",
    method: "GET",
    path: "/api/v1/guardrails/:name/hits",
    summary: "List the newest times one Guardrail warned or blocked, and count them by period",
    tag: "Guardrails",
    auth: "principal",
    scope: "config_assets:read",
    requires: [],
    effect: "reading",
    response: json(guardrailHitsSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "guardrails.test": defineRegisteredOperation({
    id: "guardrails.test",
    method: "POST",
    path: "/api/v1/guardrails/:name/test",
    summary:
      "Check a revision of one Guardrail, its draft unless named, on sample content or on an asset, and keep no hit",
    tag: "Guardrails",
    auth: "principal",
    scope: "config_assets:write",
    requires: [],
    effect: "reading",
    body: testGuardrailRequestSchema,
    response: json(testGuardrailResponseSchema),
    errors: ["NOT_FOUND", "VALIDATION_FAILED"],
    rateClass: "write"
  }),
  "guardrails.dry_run": defineRegisteredOperation({
    id: "guardrails.dry_run",
    method: "POST",
    path: "/api/v1/guardrails/:name/dry-run",
    summary:
      "Count what a revision of one Guardrail, its draft unless named, would have answered in the last 14 days, without names and without keeping a hit",
    tag: "Guardrails",
    auth: "principal",
    scope: "config_assets:write",
    requires: [],
    effect: "reading",
    body: dryRunGuardrailRequestSchema,
    response: json(dryRunGuardrailResponseSchema),
    errors: ["NOT_FOUND", "VALIDATION_FAILED"],
    rateClass: "write"
  }),
  "guardrails.list_shipped": defineRegisteredOperation({
    id: "guardrails.list_shipped",
    method: "GET",
    path: "/api/v1/guardrails/shipped",
    summary:
      "List the guardrails the release ships, whether each is switched on, and who switched it last",
    tag: "Guardrails",
    auth: "principal",
    scope: "config_assets:read",
    requires: [],
    effect: "reading",
    response: json(shippedGuardrailsSchema),
    errors: [],
    rateClass: "read"
  }),
  "guardrails.switch_shipped": defineRegisteredOperation({
    id: "guardrails.switch_shipped",
    method: "POST",
    path: "/api/v1/guardrails/shipped/:name/switch",
    summary:
      "Switch a guardrail the release ships off or on again, for the whole instance. A release never switches it back on",
    tag: "Guardrails",
    auth: "user",
    scope: "config_assets:publish",
    requires: [],
    effect: "changing",
    body: switchShippedGuardrailRequestSchema,
    response: json(shippedGuardrailSchema),
    errors: ["NOT_FOUND"],
    rateClass: "write"
  }),
  "guardrails.unpublish": defineRegisteredOperation({
    id: "guardrails.unpublish",
    method: "POST",
    path: "/api/v1/guardrails/:name/unpublish",
    summary: "Stop one published Guardrail from enforcing. Its draft stays",
    tag: "Guardrails",
    auth: "principal",
    scope: "config_assets:publish",
    requires: [],
    effect: "changing",
    response: json(unpublishGuardrailResponseSchema),
    errors: ["NOT_FOUND", "VALIDATION_FAILED"],
    rateClass: "write"
  })
} as const;
