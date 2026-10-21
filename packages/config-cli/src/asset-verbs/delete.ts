import { formatWarnings } from "../asset-output";
import { settle, ifRevision } from "./support";
import type { Verb } from "./types";

export const deleteVerb: Verb = {
  usage: "delete <name> --if-revision <n>",
  summary: "Delete one asset and keep its revisions (assets.delete)",
  named: true,
  options: { "if-revision": { type: "string" } },
  prepare: (values, name) => {
    const expectedRevision = ifRevision(values["if-revision"], false);
    return async (session) => {
      const outcome = await session.api.change(
        (client, idempotencyKey) =>
          client.assets.delete({
            params: { kind: session.kind.kind, name },
            body: { expectedRevision, ...session.scope },
            idempotencyKey
          }),
        "It may have been applied: run 'history' before sending it again."
      );
      return settle(session, outcome, (output) => [
        `Deleted ${session.kind.kind} '${name}'; its delete is revision ${output.revision}.`,
        ...formatWarnings(output.warnings)
      ]);
    };
  }
};
