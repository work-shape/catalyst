import { ConfigApiError } from "./api";
import { isRecord, writeError, type ConfigCommandOptions } from "./command-support";

/** How a publish goes ahead: answered here, sent for the Inbox with `--yes`, or not at all. */
export type PublishAnswer = "answered" | "unattended" | "refused";

/**
 * The question a publish of an App or a Workflow asks in the terminal before it is sent: a
 * yes submits the publish but never supplies an approval. With a publish guardrail on, even
 * an admin's CLI publish waits in the Inbox. An answer that is not yes publishes nothing.
 * `--yes` asks nothing: the publish is sent unattended, so it is not the caller's own
 * confirmation and waits in their Inbox until they allow it there (Confirmation in the Inbox).
 * A terminal nobody can answer without `--yes` publishes nothing. Where the publish does not
 * go ahead, it has said why.
 */
export async function askBeforePublish(
  options: ConfigCommandOptions,
  publish: {
    kind: string;
    command: string;
    name: string;
    revision: number;
    yes: boolean;
    /** The review stays folded until the reader asks for Details. */
    details?: () => void | Promise<void>;
  }
): Promise<PublishAnswer> {
  const { kind, command, name, revision } = publish;
  if (publish.yes) return "unattended";
  if (!options.prompt) {
    writeError(
      options,
      `Publishing ${/^[aeiou]/u.test(kind) ? "an" : "a"} ${kind} needs your answer here, so a run without a terminal to ask publishes nothing. Run 'catalyst ${command} publish ${name} --revision ${revision}' in a terminal and answer its question, add --yes to confirm it in your Inbox, or publish it in the interface.`
    );
    return "refused";
  }
  let answer: string;
  do {
    answer = await options.prompt(
      `Publish revision ${revision} of ${kind} '${name}'? If approval is required, this files a request in the Inbox. ${publish.details ? "[y/N; d=Details]" : "[y/N]"} `
    );
    if (/^d(?:etails)?$/iu.test(answer.trim()) && publish.details) await publish.details();
    else break;
  } while (true);
  if (/^y(?:es)?$/iu.test(answer.trim())) return "answered";
  writeError(options, "Nothing was published.");
  return "refused";
}

/**
 * The line of a publish that waits and changed nothing yet: for the caller's own confirmation
 * in their Inbox, after `--yes`, or for an approver.
 */
export function waitingPublishLine(
  run: { id: string; status?: string; approvalRequestId?: string },
  approvalHint?: string
): string {
  const named = `${run.approvalRequestId === undefined ? "" : `request ${run.approvalRequestId}, `}Operation Run ${run.id}`;
  if (run.status === "pending_confirmation") {
    return `Waits in your Inbox for your confirmation; nothing has changed yet (${named}). Allow it there to publish, or deny it.`;
  }
  return `Waits for an approval on the instance; nothing has changed yet (${named}).${approvalHint ? ` ${approvalHint}` : ""}`;
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
  const keyRefused =
    reason === "user_only" ||
    reason === "outside_key_scope" ||
    error.message.includes(`'${PUBLISH_SCOPE}'`);
  return keyRefused
    ? `This key publishes no agent. A service principal's key, such as the release key of an operated instance, writes agent drafts and publishes none (AP-10); a personal key publishes only with the publish right, scope ${PUBLISH_SCOPE}. Publish the draft with such a personal key or on the agent page.`
    : "Publishing an agent needs the right agent.publish on it, which an instance admin holds.";
}

/** The scope of a key that reaches `assets.publish`. */
const PUBLISH_SCOPE = "config_assets:publish";
