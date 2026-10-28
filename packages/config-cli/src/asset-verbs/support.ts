import { resolve } from "node:path";
import type { OperationOutcome } from "@work-shape/catalyst-api-client";
import { ConfigApiError } from "../api";
import { kindNoun } from "../asset-output";
import { writeError, writeOutput } from "../command-support";
import { readDraftConflict } from "../push";
import { waitingPublishLine } from "../publish-question";
import type { Session, Values } from "./types";

export const EXIT = { done: 0, refused: 1, usage: 2, pending: 3 } as const;
export const GUARDRAIL_KIND = "guardrail";
export const AGENT_KIND = "agent";

/** What `validate` says of a folder of files: read, within one write, not yet checked. */
export function filesRead(session: Session, from: string, files: number): number {
  const noun = kindNoun(session.kind);
  const draft = session.kind.lifecycle === "draft_published" ? " as a draft" : "";
  return print(session, { files, checkedByInstance: false }, () =>
    [
      `Read ${files} files from '${from}', within what one write carries.`,
      `The instance checks the files of a ${session.kind.kind} as it writes them: 'catalyst ${noun} put <name> --from ${from} --if-revision <n|new>' writes them${draft}.`
    ].join("\n")
  );
}

/** Prints what a changing call answered, or that it waits and has changed nothing yet. */
export function settle<Output>(
  session: Session,
  outcome: OperationOutcome<Output, { id: string; status?: string; approvalRequestId?: string }>,
  lines: (output: Output) => string[],
  approvalHint?: string
): number {
  if (outcome.status === "pending_approval") {
    const text = waitingPublishLine(outcome.run, approvalHint);
    if (session.values.json)
      writeOutput(
        session.options,
        JSON.stringify({ status: "pending_approval", run: outcome.run }, null, 2)
      );
    else writeError(session.options, text);
    return EXIT.pending;
  }
  if (session.values.json) writeOutput(session.options, JSON.stringify(outcome.output, null, 2));
  else writeOutput(session.options, lines(outcome.output).join("\n"));
  return EXIT.done;
}

export function print(session: Session, value: unknown, text: () => string): number {
  writeOutput(session.options, session.values.json ? JSON.stringify(value, null, 2) : text());
  return EXIT.done;
}

/** `--if-revision`: the revision the caller read, or `new` where it creates the asset. */
export function ifRevision(value: string | undefined, creates: true): number | null;

export function ifRevision(value: string | undefined, creates: false): number;

export function ifRevision(value: string | undefined, creates: boolean): number | null {
  const named = required(value, creates ? "--if-revision <n|new>" : "--if-revision <n>");
  if (creates && named === "new") return null;
  return revisionNumber(named);
}

/**
 * `--if-draft-revision`: the agent draft revision the caller read, or `none` where it read no
 * draft. Left out, the write names no draft, as `none` does.
 */
export function ifDraftRevision(
  value: string | undefined
): { expectedDraftRevision: number | null } | Record<string, never> {
  if (value === undefined) return {};
  return { expectedDraftRevision: value === "none" ? null : revisionNumber(value) };
}

export function requireAgentForDraftFence(session: Session, fence: object): void {
  if (
    "expectedDraftRevision" in fence &&
    session.kind.kind !== AGENT_KIND &&
    session.kind.kind !== "skill"
  ) {
    throw new UsageError("--if-draft-revision names the draft of an agent or a shared skill.");
  }
}

/** A write over an agent's or a shared skill's draft that moved: the refusal, and who moved it. */
export function explainDraftChanged(
  name: string,
  verb: "put" | "revert",
  kind = "agent"
): (error: unknown) => never {
  const noun = `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
  return (error) => {
    const conflict = error instanceof ConfigApiError ? readDraftConflict(error) : undefined;
    if (conflict?.draft === undefined) throw error;
    const { revision } = conflict.draft;
    throw new ExplainedRefusal(
      error,
      revision === null
        ? `${noun} '${name}' has no draft any more. Repeat the ${verb} with --if-draft-revision none.`
        : `${noun} '${name}' has draft revision ${revision}${conflict.changedBy === undefined ? "" : ` by ${conflict.changedBy}`}${conflict.changedAt === undefined ? "" : ` at ${conflict.changedAt}`}. Read it with 'catalyst ${kind} show ${name}'; the ${verb} writes over it with --if-draft-revision ${revision}.`
    );
  };
}

export function revisionNumber(value: string): number {
  if (!/^[1-9]\d{0,8}$/u.test(value)) throw new UsageError(`'${value}' is no revision number.`);
  return Number(value);
}

/** `--from`, against the folder the command runs in. */
export function fromPath(values: Values, cwd: string, flag: string): string {
  return resolve(cwd, required(values.from, flag));
}

export function required(value: string | undefined, flag: string): string {
  if (value === undefined || value === "") throw new UsageError(`Missing ${flag}.`);
  return value;
}

/** A refusal of the instance, with a line of this CLI that says what to do instead. */
export class ExplainedRefusal extends Error {
  constructor(
    readonly refusal: unknown,
    readonly hint: string
  ) {
    super(hint);
  }
}

/** A command line this tool cannot run. Nothing was sent. */
export class UsageError extends Error {}
