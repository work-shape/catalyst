import { formatWarnings } from "../asset-output";
import {
  settle,
  ifRevision,
  ifDraftRevision,
  requireAgentForDraftFence,
  explainDraftChanged,
  revisionNumber,
  required,
  AGENT_KIND
} from "./support";
import type { Verb } from "./types";

export const revertVerb: Verb = {
  usage: "revert <name> --to <n> --if-revision <n> [--if-draft-revision <n|none>]",
  summary:
    "Make an earlier revision the content again (assets.revert). For an agent it becomes the draft",
  named: true,
  options: {
    to: { type: "string" },
    "if-revision": { type: "string" },
    "if-draft-revision": { type: "string" }
  },
  prepare: (values, name) => {
    const revision = revisionNumber(required(values.to, "--to <n>"));
    const expectedRevision = ifRevision(values["if-revision"], false);
    const draftFence = ifDraftRevision(values["if-draft-revision"]);
    return async (session) => {
      requireAgentForDraftFence(session, draftFence);
      const outcome = await session.api
        .change(
          (client, idempotencyKey) =>
            client.assets.revert({
              params: { kind: session.kind.kind, name },
              body: { revision, expectedRevision, ...draftFence, ...session.scope },
              idempotencyKey
            }),
          "It may have been applied: run 'history' before sending it again."
        )
        .catch(explainDraftChanged(name, "revert", session.kind.kind));
      return settle(session, outcome, (output) => [
        output.draftRevision !== undefined &&
        (session.kind.kind === AGENT_KIND || session.kind.kind === "skill")
          ? `Wrote the content of revision ${revision} of ${session.kind.kind} '${name}' as draft revision ${output.draftRevision}; live revision ${output.publishedRevision ?? "-"} is unchanged until it is published.`
          : `Reverted ${session.kind.kind} '${name}' to the content of revision ${revision}; it is revision ${output.revision} now.`,
        ...formatWarnings(output.warnings)
      ]);
    };
  }
};
