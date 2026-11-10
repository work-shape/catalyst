import {
  AGENT_AVAILABILITY_MODES,
  type AgentAvailabilityMode
} from "@work-shape/catalyst-asset-schemas";
import { setAvailability } from "../asset-pointers";
import { availabilityPhrase } from "../asset-output";
import { settle, UsageError } from "./support";
import type { Verb } from "./types";

function isAvailabilityMode(mode: string | undefined): mode is AgentAvailabilityMode {
  return AGENT_AVAILABILITY_MODES.some((known) => known === mode);
}

export const setAvailabilityVerb: Verb = {
  usage:
    "set-availability <name> --mode all|selected|all_except [--personal] [--available-in <workspace-id>]... [--except <workspace-id>]...",
  summary: "Set the workspaces one asset is offered in (assets.set_availability)",
  named: true,
  options: {
    mode: { type: "string" },
    personal: { type: "boolean", default: false },
    "available-in": { type: "string", multiple: true },
    except: { type: "string", multiple: true }
  },
  prepare: (values, name) => {
    const mode = values.mode;
    if (!isAvailabilityMode(mode)) {
      throw new UsageError("--mode is 'all', 'selected' or 'all_except'.");
    }
    // Each list belongs to its mode: a workspace named for the other one is never read as this.
    if (mode !== "selected" && values["available-in"]?.length) {
      throw new UsageError("--available-in goes with --mode selected.");
    }
    if (mode !== "all_except" && values.except?.length) {
      throw new UsageError("--except goes with --mode all_except.");
    }
    if (mode === "all" && values.personal) {
      throw new UsageError("--personal goes with --mode selected or all_except.");
    }
    const body = {
      mode,
      personalWorkspaces: values.personal,
      collaborationWorkspaceIds:
        (mode === "all_except" ? values.except : values["available-in"]) ?? []
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
        `${session.kind.kind} '${name}' is offered in ${availabilityPhrase(output)}.`
      ]);
    };
  }
};
