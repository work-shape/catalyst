import { settle } from "./support";
import { requireGuardrail } from "./guardrails";
import type { Verb } from "./types";

export const unpublishVerb: Verb = {
  usage: "unpublish <name>",
  summary: "Stop a published guardrail from enforcing; its draft stays (guardrails.unpublish)",
  named: true,
  options: {},
  prepare: (_values, name) => async (session) => {
    requireGuardrail(session, "unpublish");
    const outcome = await session.api.change(
      (client, idempotencyKey) => client.guardrails.unpublish({ params: { name }, idempotencyKey }),
      "It may have been applied: run 'show' before sending it again."
    );
    return settle(session, outcome, (output) => [
      `Guardrail '${name}' no longer enforces: revision ${output.unpublishedRevision} was taken back. Its draft is at revision ${output.draftRevision}.`
    ]);
  }
};
