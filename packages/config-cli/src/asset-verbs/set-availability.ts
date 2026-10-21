import { setAvailability } from "../asset-pointers";
import { settle, UsageError } from "./support";
import type { Verb } from "./types";

export const setAvailabilityVerb: Verb = {
  usage:
    "set-availability <name> --mode all|selected [--personal] [--available-in <workspace-id>]...",
  summary: "Set the workspaces one asset is offered in (assets.set_availability)",
  named: true,
  options: {
    mode: { type: "string" },
    personal: { type: "boolean", default: false },
    "available-in": { type: "string", multiple: true }
  },
  prepare: (values, name) => {
    const { mode } = values;
    if (mode !== "all" && mode !== "selected") {
      throw new UsageError("--mode is 'all' or 'selected'.");
    }
    const body = {
      mode: mode === "all" ? ("all" as const) : ("selected" as const),
      personalWorkspaces: values.personal,
      collaborationWorkspaceIds: values["available-in"] ?? []
    };
    return async (session) => {
      const outcome = await setAvailability(
        session.api,
        session.kind.kind,
        name,
        body,
        session.scope
      );
      return settle(session, outcome, (output) => [
        `${session.kind.kind} '${name}' is offered in ${output.mode === "all" ? "every workspace" : `${output.personalWorkspaces ? "personal workspaces and " : ""}${output.collaborationWorkspaceIds.length} shared workspaces`}.`
      ]);
    };
  }
};
