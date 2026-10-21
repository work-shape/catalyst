import { formatAsset } from "../asset-output";
import { print } from "./support";
import type { Verb } from "./types";

export const showVerb: Verb = {
  usage: "show <name> [--revision draft|published|<n>] [--files]",
  summary: "Print one asset, or one revision of it (assets.get)",
  named: true,
  options: { revision: { type: "string" }, files: { type: "boolean", default: false } },
  prepare: (values, name) => async (session) => {
    const asset = await session.api.read((client) =>
      client.assets.get({
        params: { kind: session.kind.kind, name },
        query: {
          ...session.scope,
          ...(values.revision === undefined ? {} : { revision: values.revision }),
          ...(values.files ? { files: "true" as const } : {})
        }
      })
    );
    return print(session, asset, () => formatAsset(asset));
  }
};
