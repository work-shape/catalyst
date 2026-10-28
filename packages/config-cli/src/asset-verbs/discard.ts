import { settle, revisionNumber, required, UsageError, AGENT_KIND } from "./support";
import type { Verb } from "./types";

export const discardVerb: Verb = {
  usage: "discard <name> --revision <n>",
  summary:
    "Drop an agent's or a shared skill's draft at the draft revision you read; the live revision stays (agents.draft.discard, skills.draft.discard)",
  named: true,
  options: { revision: { type: "string" } },
  prepare: (values, name) => {
    const expectedRevision = revisionNumber(required(values.revision, "--revision <n>"));
    return async (session) => {
      const kind = session.kind.kind;
      if (kind !== AGENT_KIND && kind !== "skill") {
        throw new UsageError(
          "'discard' is a command of agents and skills only; another kind's draft goes with 'discard-draft'."
        );
      }
      const outcome = await session.api.change(
        (client, idempotencyKey) =>
          (kind === "skill" ? client.skills.draft : client.agents.draft).discard({
            params: { name },
            body: { expectedRevision, ...session.scope },
            idempotencyKey
          }),
        "It may have been applied: run 'show' before sending it again."
      );
      return settle(session, outcome, () => [
        `Discarded draft revision ${expectedRevision} of ${kind} '${name}'; its live revision is unchanged.`
      ]);
    };
  }
};
