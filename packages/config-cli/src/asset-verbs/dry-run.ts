import { formatDryRun } from "../asset-output";
import { print, revisionNumber } from "./support";
import { requireGuardrail, guardrailDryRun } from "./guardrails";
import type { Verb } from "./types";

export const dryRunVerb: Verb = {
  usage: "dry-run <name> [--revision <n>]",
  summary:
    "Count what a guardrail's draft, or one revision, would have answered in the last 14 days, without names (guardrails.dry_run)",
  named: true,
  options: { revision: { type: "string" } },
  prepare: (values, name) => {
    const revision = values.revision === undefined ? undefined : revisionNumber(values.revision);
    return async (session) => {
      requireGuardrail(session, "dry-run");
      const answer = await guardrailDryRun(session, name, revision);
      return print(session, answer, () => formatDryRun(name, answer));
    };
  }
};
