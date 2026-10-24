import { APP_ERROR_CODES } from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";

export const appErrorCodeSchema = z.enum(APP_ERROR_CODES);

/** What each error code tells a caller, as the reference states it. */
export const API_ERROR_MEANINGS: Record<z.infer<typeof appErrorCodeSchema>, string> = {
  BAD_REQUEST: "The request cannot be read.",
  UNAUTHENTICATED: "No credential was presented, or the credential is not valid.",
  FORBIDDEN: "The caller lacks the scope or the right this operation requires.",
  NOT_FOUND:
    "The resource does not exist, is not visible to the caller, or the instance runs without this operation.",
  CONFLICT: "The request conflicts with the current state of the resource.",
  REVISION_CONFLICT:
    "An asset the call writes is at another revision than the one the call names, or the name it creates is taken or was deleted. Nothing was written. `details.conflicts` names each such asset, with its current revision and who changed it when for an asset the caller may read.",
  PRECONDITION_REQUIRED:
    "The call names no `expectedRevision` for an asset it writes. `details.assets` names each. Send the revision that was read, or `null` to create the asset.",
  TIMEOUT: "The instance did not finish the work in time.",
  VALIDATION_FAILED: "Path, query or body do not match the operation's schema.",
  RATE_LIMITED:
    "The caller sent too many requests of this operation's rate class. `details.retryAfterSeconds` and the `Retry-After` header give the seconds to wait. The numbers are the instance's, set under `rateLimits` in its release config.",
  POLICY_DENIED:
    "The instance's policy does not allow this operation from here. `details.operation` names it. `details.reason` is `approval_unavailable` where the policy asks for another person's approval and the call cannot wait for one; `details.guardrailId` then names the guardrail that asked for it, where one did. It is `workflow_deleted` where a step of a run of a published Workflow needs the confirmation its publish gave, and the Workflow was deleted since. It is `approval_stale` where a call that waited can no longer be approved because what it is about changed or a newer call replaced it. It is `confirmation_required` where a subagent made a call that needs a person's confirmation or approval: a subagent never waits for one, and the agent that started it makes the call instead.",
  GUARDRAIL_BLOCKED:
    "A guardrail refused the call. `details.guardrailId` names it. `details.reason` is `check_unavailable` where a check could not answer, by an error or a timeout; `details.guardrailId` then names the event that was checked.",
  DECLINED:
    "The person asked to approve the call declined it. `details.by` names them, `details.comment` holds their reason where they gave one.",
  IDEMPOTENCY_KEY_REUSED:
    "The `Idempotency-Key` was already used for another operation or another input. Send a new key.",
  OPERATION_IN_PROGRESS:
    "The first call with this `Idempotency-Key` has not ended, or it was interrupted and its outcome is not known (`details.interrupted` is `true`). `details.operationRunId` names its run. An interrupted call is never run again under its key: check what it changed, then send a new key.",
  OPERATION_EXPIRED:
    "The call waited for an approval until it expired, and nothing was executed. Call again with a new key.",
  OUTPUT_NOT_RETAINED:
    "The call with this `Idempotency-Key` completed, and its answer is not kept: it was too large, or it held a secret that is shown once. Read the result from what the call changed. A secret is not shown again.",
  INTERNAL: "The instance failed. The message never carries details."
};

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: appErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
    correlationId: z.string().min(1)
  })
});

/**
 * `details` of the 429 a caller over an operation's rate limit receives. The `Retry-After`
 * header of that answer carries the same number.
 */
export const rateLimitedDetailsSchema = z.object({
  retryAfterSeconds: z.number().int().min(1)
});

/**
 * `details.reason` of the 404 a server answers for a method and path that is no operation of
 * its catalog. An operation the instance runs without answers 404 without it. A caller built
 * from the catalog reads it as: this caller belongs to another release than the server.
 */
export const UNKNOWN_OPERATION_REASON = "unknown_operation";

const unknownOperationSchema = z.object({
  error: z.object({
    code: z.literal("NOT_FOUND"),
    details: z.object({ reason: z.literal(UNKNOWN_OPERATION_REASON) })
  })
});

/**
 * `details.reason` of the 400 a server answers for a request body over the size it accepts.
 * The limit is the server's own and bounds every operation alike.
 */
export const BODY_TOO_LARGE_REASON = "body_too_large";

/**
 * `details.reason` of the 400 a server answers for a JSON request body it does not read: one
 * that is empty, does not parse, or names `__proto__` or `constructor.prototype` as a key.
 */
export const INVALID_JSON_BODY_REASON = "invalid_json_body";

export function isUnknownOperationResponse(payload: unknown): boolean {
  return unknownOperationSchema.safeParse(payload).success;
}

export type ApiErrorCode = z.infer<typeof appErrorCodeSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
