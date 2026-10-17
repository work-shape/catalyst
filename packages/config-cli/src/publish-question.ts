import { writeError, type ConfigCommandOptions } from "./command-support";

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
  publish: { kind: string; command: string; name: string; revision: number; yes: boolean }
): Promise<PublishAnswer> {
  const { kind, command, name, revision } = publish;
  if (publish.yes) return "unattended";
  if (!options.prompt) {
    writeError(
      options,
      `Publishing a ${kind} needs your answer here, so a run without a terminal to ask publishes nothing. Run 'catalyst ${command} publish ${name} --revision ${revision}' in a terminal and answer its question, add --yes to confirm it in your Inbox, or publish it in the interface.`
    );
    return "refused";
  }
  const answer = await options.prompt(
    `Publish revision ${revision} of ${kind} '${name}'? If approval is required, this files a request in the Inbox. [y/N] `
  );
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
