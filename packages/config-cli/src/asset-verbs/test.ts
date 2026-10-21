import { readFile } from "node:fs/promises";
import { print, revisionNumber, fromPath, UsageError } from "./support";
import { requireGuardrail, assetReference } from "./guardrails";
import type { Verb } from "./types";

export const testVerb: Verb = {
  usage:
    "test <name> [--revision <n>] (--text <content> [--field <field>] | --from <file> [--field <field>] | --asset <kind>:<name>[@<n>])",
  summary:
    "Check a guardrail's draft, or one revision, on sample content or on an asset; keeps no hit (guardrails.test)",
  named: true,
  options: {
    revision: { type: "string" },
    text: { type: "string" },
    from: { type: "string" },
    field: { type: "string" },
    asset: { type: "string" }
  },
  prepare: (values, name, cwd) => {
    const revision = values.revision === undefined ? undefined : revisionNumber(values.revision);
    const given = [values.text, values.from, values.asset].filter((value) => value !== undefined);
    if (given.length !== 1) {
      throw new UsageError("Give the content to check: one of --text, --from or --asset.");
    }
    if (values.asset !== undefined && values.field !== undefined) {
      throw new UsageError("--field names a field of sample content, not of an asset.");
    }
    const asset = values.asset === undefined ? undefined : assetReference(values.asset);
    return async (session) => {
      requireGuardrail(session, "test");
      const text =
        values.from === undefined
          ? values.text
          : await readFile(fromPath(values, cwd, "--from <file>"), "utf8");
      const body = {
        ...(revision === undefined ? {} : { revision }),
        ...(asset ? { asset } : { sample: { [values.field ?? "content"]: text ?? "" } })
      };
      const answer = await session.api.read((client) =>
        client.guardrails.test({ params: { name }, body })
      );
      return print(session, answer, () =>
        [
          `Revision ${answer.revision} of guardrail '${name}' on '${answer.event}': ${answer.outcome}${answer.reason === "" ? "" : ` (${answer.reason})`}.`,
          ...(answer.appliesToAsset === false
            ? ["Its filter does not take this asset: where it enforces, it would not check it."]
            : []),
          "Nothing was kept: a test records no hit."
        ].join("\n")
      );
    };
  }
};
