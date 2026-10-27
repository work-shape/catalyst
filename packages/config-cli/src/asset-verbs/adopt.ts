import type { AdoptAssetRepositoryResponse } from "@work-shape/catalyst-api-contract";
import { writeError } from "../command-support";
import { EXIT, UsageError, print, settle } from "./support";
import type { Verb } from "./types";

type Totals = Omit<AdoptAssetRepositoryResponse, "done" | "after">;

/**
 * The adoption of the assets of a kind written before its writes were commits (WF-GIT-2): an
 * operator's step after the deploy of the release, with the release key. One call works for a
 * while and says where to go on; this calls again until the instance says it is done. A stop
 * loses nothing: the same command goes on where the last one stopped and makes the same commits.
 */
export const adoptVerb: Verb = {
  usage: "adopt <name> | adopt --all",
  summary:
    "Give every revision written before the kind had a repository its commit, with the release key (assets.adopt_repository)",
  named: false,
  options: { all: { type: "boolean", default: false } },
  prepare: (values, name) => {
    if (values.all === (name !== "")) {
      throw new UsageError("Name the asset, or pass --all to adopt every one of the kind.");
    }
    return async (session) => {
      const { kind } = session.kind;
      const totals: Totals = {
        adopted: 0,
        revisions: 0,
        commits: 0,
        refused: 0,
        adoptedAssetIds: [],
        refusedAssetIds: []
      };
      let after: string | undefined;
      for (;;) {
        const body = {
          ...(name === "" ? {} : { name }),
          ...(after === undefined ? {} : { after })
        };
        const outcome = await session.api.change(
          (client, idempotencyKey) =>
            client.assets.adopt_repository({ params: { kind }, body, idempotencyKey }),
          "Nothing is lost: run the same command again, and it goes on where it stopped."
        );
        if (outcome.status !== "done") return settle(session, outcome, () => []);
        const { done, after: next, ...step } = outcome.output;
        totals.adopted += step.adopted;
        totals.revisions += step.revisions;
        totals.commits += step.commits;
        totals.refused += step.refused;
        totals.adoptedAssetIds.push(...step.adoptedAssetIds);
        totals.refusedAssetIds.push(...step.refusedAssetIds);
        // Progress goes to stderr, so `--json` prints the answer alone.
        writeError(
          session.options,
          `${totals.adopted} adopted, ${totals.refused} refused, ${totals.commits} commits${done ? "" : " so far"}`
        );
        if (done) break;
        after = next;
      }
      print(session, totals, () =>
        [
          `Adopted ${totals.adopted} ${kind}${totals.adopted === 1 ? "" : "s"}: ${totals.revisions} revisions, ${totals.commits} commits.`,
          ...totals.adoptedAssetIds.map((id) => `  adopted ${id}`),
          ...totals.refusedAssetIds.map(
            (id) => `  refused ${id}: the instance's log names the revision and why`
          )
        ].join("\n")
      );
      return totals.refused > 0 ? EXIT.refused : EXIT.done;
    };
  }
};
