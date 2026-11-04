import { ConfigApiError } from "../api";
import { setDefault } from "../asset-pointers";
import { settle, ExplainedRefusal, UsageError } from "./support";
import type { Verb } from "./types";

export const setDefaultVerb: Verb = {
  usage: "set-default <name> [--workspace <id>] | set-default --none [--workspace <id>]",
  summary:
    "Set or clear the instance's default asset of the kind, or with --workspace a Shared Workspace's own default agent (assets.set_default)",
  named: false,
  options: { none: { type: "boolean", default: false } },
  prepare: (values, name) => {
    if (values.none === (name !== "")) {
      throw new UsageError("Name the asset, or pass --none to clear the default.");
    }
    const chosen = values.none ? null : name;
    // Only a workspace named on the command line sets that workspace's own default: the one a
    // working copy is bound to addresses its assets, not this setting.
    const workspaceId = values.workspace;
    return async (session) => {
      const outcome = await setDefault(
        session.api,
        session.kind.kind,
        chosen,
        session.scope,
        workspaceId
      ).catch((error: unknown) => {
        if (!(error instanceof ConfigApiError) || error.code !== "REVISION_CONFLICT") throw error;
        throw new ExplainedRefusal(
          error,
          `Run 'catalyst ${session.kind.kind} list' and retry the default selection.`
        );
      });
      return settle(session, outcome, () => [
        workspaceId === undefined
          ? chosen === null
            ? `The instance has no default ${session.kind.kind} now.`
            : `'${chosen}' is the instance's default ${session.kind.kind} now.`
          : chosen === null
            ? `The workspace '${workspaceId}' follows the instance's default ${session.kind.kind} now.`
            : `'${chosen}' is the default ${session.kind.kind} of the workspace '${workspaceId}' now.`
      ]);
    };
  }
};
