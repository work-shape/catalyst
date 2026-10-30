import { GUARDRAIL_CHECK_KINDS, GUARDRAIL_OUTCOMES } from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { timestampSchema } from "./shared";

// What a person is shown of a guardrail where they act (GR-3), and the read-only list of the
// rules in force for them. Spec: events-workflows-and-guardrails.md, What a stopped person sees.

const guardrailScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("instance") }),
  z.object({ kind: z.literal("workspace"), workspaceId: z.string() })
]);

/** Where a guardrail comes from: the operator's floor, the release's switch, or a published asset. */
export const GUARDRAIL_ANSWER_ORIGINS = ["release", "shipped", "asset"] as const;

/**
 * One guardrail's answer as the person who acted is shown it: which guardrail, what it did and
 * why, and where it belongs. Who can change it is read from Rules in force when it is shown.
 */
export const guardrailAnswerRefSchema = z.object({
  name: z.string(),
  title: z.string(),
  outcome: z.enum(GUARDRAIL_OUTCOMES),
  reason: z.string().optional(),
  origin: z.enum(GUARDRAIL_ANSWER_ORIGINS),
  scope: guardrailScopeSchema.optional(),
  revision: z.number().int().positive().optional(),
  /** A `require_approval` answered as a block, because the action could not wait. */
  approvalCannotWait: z.literal(true).optional()
});

export type GuardrailAnswerRefView = z.infer<typeof guardrailAnswerRefSchema>;

/**
 * Why the text of an attachment was not checked on chat input (GR-4): a picture, a document
 * whose text is not extracted when it is sent, a text larger than a check reads, or a file that
 * could not be read. It is said so, never silently passed.
 */
export const CHAT_INPUT_NOT_CHECKED_CAUSES = [
  "image",
  "not_extracted",
  "too_large",
  "unreadable"
] as const;

/**
 * What the checks of a person's chat message say beside allowing or stopping it: what they
 * could not read. Never the text or what matched.
 */
export const chatInputNotCheckedSchema = z.object({
  /** The message is longer than a rule reads, so that rule did not check it. */
  textNotChecked: z.literal(true).optional(),
  attachmentsNotChecked: z
    .array(
      z.object({
        attachmentId: z.string(),
        filename: z.string(),
        cause: z.enum(CHAT_INPUT_NOT_CHECKED_CAUSES)
      })
    )
    .optional()
});

/**
 * The checks of a message that was sent: the guardrails that warned, which the person sent
 * anyway, and what was not checked.
 */
export const chatInputCheckSchema = chatInputNotCheckedSchema.extend({
  guardrails: z.array(guardrailAnswerRefSchema).optional()
});

/**
 * The details of a chat message a guardrail stopped (GR-4): `GUARDRAIL_BLOCKED` with
 * `chat_input_blocked`, nothing stored and the draft kept; or `CONFLICT` with
 * `chat_input_warning`, which the person may send anyway with `acceptGuardrailWarnings`.
 */
export const chatInputRefusalDetailsSchema = chatInputNotCheckedSchema.extend({
  reason: z.enum(["chat_input_blocked", "chat_input_warning"]),
  guardrails: z.array(guardrailAnswerRefSchema)
});

export type ChatInputCheckView = z.infer<typeof chatInputCheckSchema>;
export type ChatInputRefusalDetails = z.infer<typeof chatInputRefusalDetailsSchema>;

/**
 * One rule in force for the viewer. People are named only where the viewer may see them: their
 * co-members of a shared workspace, themselves, and everyone for a holder of the people right.
 * Hits are a count, never who was stopped or what.
 */
export const ruleInForceSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  /** The reason a person it stops is told, where the rule words one. Empty where a model words it. */
  reason: z.string(),
  /** The before-events it is bound to, such as `operation.before_call`. */
  on: z.array(z.string()),
  /** What its filter narrows by: kind, operation, origin, agent, workspace. */
  filter: z.record(z.string(), z.string()).optional(),
  checkKind: z.enum(GUARDRAIL_CHECK_KINDS).optional(),
  outcome: z.enum(GUARDRAIL_OUTCOMES),
  origin: z.enum(GUARDRAIL_ANSWER_ORIGINS),
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("instance") }),
    z.object({
      kind: z.literal("workspace"),
      workspaceId: z.string(),
      workspaceName: z.string().optional()
    })
  ]),
  /** The published revision of a guardrail written as an asset. */
  revision: z.number().int().positive().optional(),
  /** A shipped guardrail: whether it is switched on, and whether it asks on every publish. */
  enabled: z.boolean().optional(),
  alwaysAsk: z.boolean().optional(),
  /**
   * Who published the revision, or switched the shipped guardrail last, and when. The name is
   * left out where the viewer may not see it; `changedByHidden` then says somebody did.
   */
  changedBy: z.string().optional(),
  changedByHidden: z.literal(true).optional(),
  changedAt: timestampSchema.optional(),
  /**
   * Who can change it, by the names the viewer may see: holders of `guardrail.publish` at its
   * scope. Empty for the floor, which the operator sets, and where the viewer may see none.
   */
  changers: z.array(z.string()),
  /** Whether the viewer can ask who can change it from here: never for the floor. */
  askable: z.boolean(),
  /** How often it warned, held or blocked in the last 30 days. A count, never who. */
  hitsLast30Days: z.number().int().nonnegative()
});

export const rulesInForceSchema = z.object({
  items: z.array(ruleInForceSchema),
  /**
   * An admin for all workspaces the help texts of the instance name, where one is active: the
   * person to ask where no holder of a rule's scope is shown.
   */
  instanceAdmin: z.string().optional()
});

export const askGuardrailRequestSchema = z
  .object({
    /** The person's question, in their words. It goes to the Inbox of who can change the rule. */
    text: z.string().trim().min(1).max(1000)
  })
  .strict();

export const askGuardrailResponseSchema = z.object({
  /** How many people got the question in their Inbox. */
  addressees: z.number().int().positive()
});

export type RuleInForceView = z.infer<typeof ruleInForceSchema>;
export type RulesInForceView = z.infer<typeof rulesInForceSchema>;
