import { MAX_LIST_LIMIT, type AssetSummary } from "@work-shape/catalyst-api-contract";
import { formatAssetList } from "../asset-output";
import { print } from "./support";
import type { Verb } from "./types";

export const listVerb: Verb = {
  usage: "list [--prefix <text>] [--text <text>]",
  summary: "List the assets of the kind you may read (assets.list)",
  named: false,
  options: { prefix: { type: "string" }, text: { type: "string" } },
  prepare: (values) => async (session) => {
    const items: AssetSummary[] = [];
    let cursor: string | undefined;
    do {
      const page = await session.api.read((client) =>
        client.assets.list({
          params: { kind: session.kind.kind },
          query: {
            limit: MAX_LIST_LIMIT,
            ...session.scope,
            ...(values.prefix === undefined ? {} : { prefix: values.prefix }),
            ...(values.text === undefined ? {} : { text: values.text }),
            ...(cursor === undefined ? {} : { cursor })
          }
        })
      );
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return print(session, items, () => formatAssetList(session.kind, items));
  }
};
