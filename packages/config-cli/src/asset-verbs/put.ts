import { readAssetSource } from "../asset-sources";
import { formatWarnings, kindNoun } from "../asset-output";
import {
  settle,
  ifRevision,
  ifDraftRevision,
  requireAgentForDraftFence,
  explainDraftChanged,
  fromPath,
  UsageError,
  AGENT_KIND
} from "./support";
import type { Verb } from "./types";

export const putVerb: Verb = {
  usage: "put <name> --from <file-or-folder> --if-revision <n|new> [--if-draft-revision <n|none>]",
  summary:
    "Create an asset (--if-revision new) or replace it at the revision you read (assets.put). An agent that exists, and a shared skill, is written as its draft",
  named: true,
  options: {
    from: { type: "string" },
    "if-revision": { type: "string" },
    "if-draft-revision": { type: "string" }
  },
  prepare: (values, name, cwd) => {
    const expectedRevision = ifRevision(values["if-revision"], true);
    const draftFence = ifDraftRevision(values["if-draft-revision"]);
    const from = fromPath(values, cwd, "--from <file-or-folder>");
    return async (session) => {
      requireAgentForDraftFence(session, draftFence);
      const source = await readAssetSource(from, session.kind.representation, session.kind.kind);
      if ("config" in source && source.config.name !== undefined && source.config.name !== name) {
        throw new UsageError(
          `The definition names '${String(source.config.name)}', and the command '${name}'.`
        );
      }
      const body =
        "config" in source
          ? {
              config: { ...source.config, name },
              expectedRevision,
              ...draftFence,
              ...session.scope
            }
          : { files: source.files, expectedRevision, ...session.scope };
      const outcome = await session.api
        .change(
          (client, idempotencyKey) =>
            client.assets.put({
              params: { kind: session.kind.kind, name },
              body,
              idempotencyKey
            }),
          `It may have been written: run 'catalyst ${kindNoun(session.kind)} show ${name}' before sending it again.`
        )
        .catch(explainDraftChanged(name, "put", session.kind.kind));
      return settle(session, outcome, (output) => [
        output.draftRevision !== undefined &&
        (session.kind.kind === AGENT_KIND || session.kind.kind === "skill")
          ? `Wrote ${session.kind.kind} '${name}' as draft revision ${output.draftRevision}; live revision ${output.publishedRevision ?? "-"} is unchanged until it is published with 'catalyst ${session.kind.kind} publish ${name} --revision ${output.draftRevision}'.`
          : `Wrote ${session.kind.kind} '${name}' at revision ${output.revision}.${session.kind.lifecycle === "draft_published" ? " It is a draft until it is published." : ""}`,
        ...formatWarnings(output.warnings)
      ]);
    };
  }
};
