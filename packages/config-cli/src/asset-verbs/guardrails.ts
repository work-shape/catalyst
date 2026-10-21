import { formatDryRun } from "../asset-output";
import { writeError } from "../command-support";
import { GUARDRAIL_KIND, EXIT, UsageError, revisionNumber } from "./support";
import type { Session } from "./types";

export function requireGuardrail(session: Session, verb: string): void {
  if (session.kind.kind !== GUARDRAIL_KIND) {
    throw new UsageError(`'${verb}' is a command of guardrails only.`);
  }
}

/** `--asset <kind>:<name>[@<n>]`: the asset a test reads, at its live revision unless named. */
export function assetReference(value: string): { kind: string; name: string; revision?: number } {
  const match = /^([a-z][a-z0-9_-]*):([^@]+)(?:@(\d+))?$/u.exec(value);
  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new UsageError(`'${value}' names no asset: write <kind>:<name>, or <kind>:<name>@<n>.`);
  }
  return {
    kind: match[1].replaceAll("-", "_"),
    name: match[2],
    ...(match[3] === undefined ? {} : { revision: revisionNumber(match[3]) })
  };
}

export function guardrailDryRun(session: Session, name: string, revision: number | undefined) {
  return session.api.read((client) =>
    client.guardrails.dry_run({
      params: { name },
      body: revision === undefined ? {} : { revision }
    })
  );
}

/**
 * The dry run a guardrail's publish shows first. A first publish of a guardrail that stops
 * actions (it blocks or holds them for an approval) goes ahead only with `--confirm` naming
 * the actions it would have stopped and those it could not check: a dry run that checked
 * nothing does not say that the guardrail stops nothing. Answers an exit code where the
 * publish stops here, and nothing where it goes ahead.
 */
export async function guardrailDryRunBeforePublish(
  session: Session,
  name: string,
  revision: number
): Promise<number | undefined> {
  const answer = await guardrailDryRun(session, name, revision);
  if (!session.values.json) writeError(session.options, formatDryRun(name, answer));
  const stops = answer.outcome === "block" || answer.outcome === "require_approval";
  const stopped = answer.wouldBlock.actions + answer.wouldRequireApproval.actions;
  const unchecked = stops ? answer.notEvaluable : 0;
  const named = stopped + unchecked;
  const confirmed = session.values.confirm;
  if (answer.published || named === 0) {
    if (confirmed !== undefined) {
      throw new UsageError(
        "--confirm answers a first publish that would stop actions or could not check them, and this is none."
      );
    }
    return undefined;
  }
  if (confirmed === String(named)) return undefined;
  const actions = (count: number) => `${count} action${count === 1 ? "" : "s"}`;
  const what = `${actions(stopped)} it would have stopped${unchecked > 0 ? ` and ${actions(unchecked)} it could not check` : ""}`;
  writeError(
    session.options,
    confirmed === undefined
      ? `This first publish acts on ${what} in the last ${answer.days} days. Publish it with --confirm ${named}, or publish a draft with the outcome 'warn' first.`
      : `--confirm ${confirmed} does not name the ${named}: ${what}. Nothing was published.`
  );
  return EXIT.refused;
}
