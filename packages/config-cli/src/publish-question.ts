import { ConfigApiError } from "./api";
import { isRecord } from "./command-support";

/**
 * What becomes of a waiting publish when another revision goes live first, said with every
 * waiting publish: it can never overwrite that revision.
 */
export const OVERTAKEN_LINE =
  "If another version goes live before it is decided, this request is settled as superseded: it can do nothing then and never overwrites that version.";

/**
 * Whether the instance answered a publish with nothing to do: the revision it names is live,
 * and nothing newer waits beside it. No request was filed.
 */
export function isAlreadyLive(error: unknown): boolean {
  return (
    error instanceof ConfigApiError &&
    error.status === 409 &&
    isRecord(error.details) &&
    error.details.reason === "already_live"
  );
}

/** What the CLI says of a publish with nothing to do. */
export function alreadyLiveLine(kind: string, name: string, revision: number): string {
  return `Revision ${revision} of ${kind} '${name}' is already live. Nothing to do: nothing was published and no request was filed.`;
}

/**
 * The line of a publish that waits and changed nothing yet: for an approver, where a guardrail
 * of the instance holds it, or for the caller's own confirmation in their Inbox.
 */
export function waitingPublishLine(
  run: { id: string; status?: string; approvalRequestId?: string },
  approvalHint?: string,
  /** What the caller adds of this kind of call, such as `OVERTAKEN_LINE` of a publish. */
  note?: string
): string {
  const named = `${run.approvalRequestId === undefined ? "" : `request ${run.approvalRequestId}, `}Operation Run ${run.id}`;
  if (run.status === "pending_confirmation") {
    return `Waits in your Inbox for your confirmation; nothing has changed yet (${named}). Allow it there to publish, or deny it.${note ? ` ${note}` : ""}`;
  }
  return `Waits for an approval on the instance; nothing has changed yet (${named}).${approvalHint ? ` ${approvalHint}` : ""}${note ? ` ${note}` : ""}`;
}

/**
 * What to do where the instance refused to publish an agent for the caller's right or key: a
 * service principal's key writes agent drafts and publishes none (AP-10), and a personal key
 * publishes only with the publish scope, so a person publishes them. Nothing for any other
 * refusal.
 */
export function agentPublishRefusalHint(error: unknown): string | undefined {
  if (!(error instanceof ConfigApiError) || error.status !== 403) return undefined;
  const reason = isRecord(error.details) ? error.details.reason : undefined;
  // A personal key that lacks a right its owner holds is told so with the refusal itself.
  if (reason === "outside_key_scope") return undefined;
  const keyRefused = reason === "user_only" || error.message.includes(`'${PUBLISH_SCOPE}'`);
  return keyRefused
    ? `This key publishes no agent. A service principal's key, such as the release key of an operated instance, writes agent drafts and publishes none (AP-10); a personal key publishes only with the publish right, scope ${PUBLISH_SCOPE}. Publish the draft with such a personal key or on the agent page.`
    : "Publishing an agent needs the right agent.publish on it, which an instance admin holds.";
}

/** The scope of a key that reaches `assets.publish`. */
const PUBLISH_SCOPE = "config_assets:publish";
