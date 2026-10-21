import { ConfigApiError } from "../api";
import { setDefault } from "../asset-pointers";
import { settle, ExplainedRefusal, UsageError } from "./support";
import type { Verb } from "./types";

export const setDefaultVerb: Verb = {
  usage: "set-default <name> | set-default --none",
  summary: "Set or clear the instance's default asset of the kind (assets.set_default)",
  named: false,
  options: { none: { type: "boolean", default: false } },
  prepare: (values, name) => {
    if (values.none === (name !== "")) {
      throw new UsageError("Name the asset, or pass --none to clear the default.");
    }
    const chosen = values.none ? null : name;
    return async (session) => {
      const outcome = await setDefault(session.api, session.kind.kind, chosen, session.scope).catch(
        (error: unknown) => {
          if (!(error instanceof ConfigApiError) || error.code !== "REVISION_CONFLICT") throw error;
          throw new ExplainedRefusal(
            error,
            `Run 'catalyst ${session.kind.kind} list' and retry the default selection.`
          );
        }
      );
      return settle(session, outcome, () => [
        chosen === null
          ? `The instance has no default ${session.kind.kind} now.`
          : `'${chosen}' is the instance's default ${session.kind.kind} now.`
      ]);
    };
  }
};
