import { settle, ifRevision } from "./support";
import type { Verb } from "./types";

export const discardDraftVerb: Verb = {
  usage: "discard-draft <name> --if-revision <n>",
  summary: "Move the draft back to the published revision (assets.discard_draft)",
  named: true,
  options: { "if-revision": { type: "string" } },
  prepare: (values, name) => {
    const expectedRevision = ifRevision(values["if-revision"], false);
    return async (session) => {
      const outcome = await session.api.change(
        (client, idempotencyKey) =>
          client.assets.discard_draft({
            params: { kind: session.kind.kind, name },
            body: { expectedRevision, ...session.scope },
            idempotencyKey
          }),
        "It may have been applied: run 'show' before sending it again."
      );
      return settle(session, outcome, (output) => [
        `The draft of ${session.kind.kind} '${name}' is revision ${output.draftRevision} again.`
      ]);
    };
  }
};
