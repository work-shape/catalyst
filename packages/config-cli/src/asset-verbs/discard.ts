import { settle, revisionNumber, required, UsageError, AGENT_KIND } from "./support";
import type { Verb } from "./types";

export const discardVerb: Verb = {
  usage: "discard <name> --revision <n>",
  summary:
    "Drop an agent's draft at the draft revision you read; the live agent stays (agents.draft.discard)",
  named: true,
  options: { revision: { type: "string" } },
  prepare: (values, name) => {
    const expectedRevision = revisionNumber(required(values.revision, "--revision <n>"));
    return async (session) => {
      if (session.kind.kind !== AGENT_KIND) {
        throw new UsageError(
          "'discard' is a command of agents only; another kind's draft goes with 'discard-draft'."
        );
      }
      const outcome = await session.api.change(
        (client, idempotencyKey) =>
          client.agents.draft.discard({
            params: { name },
            body: { expectedRevision, ...session.scope },
            idempotencyKey
          }),
        "It may have been applied: run 'show' before sending it again."
      );
      return settle(session, outcome, () => [
        `Discarded draft revision ${expectedRevision} of agent '${name}'; its live revision is unchanged.`
      ]);
    };
  }
};
