import { MAX_LIST_LIMIT, type ConfigAssetRevision } from "@work-shape/catalyst-api-contract";
import { formatHistory } from "../asset-output";
import { print } from "./support";
import type { Verb } from "./types";

export const historyVerb: Verb = {
  usage: "history <name>",
  summary: "List the revisions of one asset, newest first (assets.revisions.list)",
  named: true,
  options: {},
  prepare: (_values, name) => async (session) => {
    const revisions: ConfigAssetRevision[] = [];
    let cursor: string | undefined;
    do {
      const page = await session.api.read((client) =>
        client.assets.revisions.list({
          params: { kind: session.kind.kind, name },
          query: {
            limit: MAX_LIST_LIMIT,
            ...session.scope,
            ...(cursor === undefined ? {} : { cursor })
          }
        })
      );
      revisions.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return print(session, revisions, () => formatHistory(revisions));
  }
};
