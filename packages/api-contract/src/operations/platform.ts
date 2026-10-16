import { configAssetReferencesSchema } from "../configuration";
import { platformContextSchema } from "../platform";
import { defineOperation, defineRegisteredOperation, json } from "./define-operation";

export const platformOperations = {
  // The first read of an outside editor, a service principal's included. It asks for no scope
  // of its own: the answer is cut to what the credential's scopes let its holder do.
  "platform.context.get": defineRegisteredOperation({
    id: "platform.context.get",
    method: "GET",
    path: "/api/v1/context",
    summary: "Read the instance, its release, the asset kinds and the caller's Namespaces",
    tag: "Platform",
    auth: "principal",
    scope: null,
    requires: [],
    effect: "reading",
    response: json(platformContextSchema),
    errors: [],
    rateClass: "read"
  }),
  // A plain operation. It was kept plain when every registered read wrote an Operation Run and
  // its audit rows; an allowed read writes neither any more. Its caller holds at least
  // one action of a registered asset kind, on the instance or in a Namespace, that the
  // credential's scopes let it use. The handler decides that, so `requires` names nothing.
  "platform.references.get": defineOperation({
    id: "platform.references.get",
    method: "GET",
    path: "/api/v1/context/references",
    summary: "Read what a definition may refer to on this instance: models, efforts and tools",
    tag: "Platform",
    auth: "principal",
    scope: "config_assets:read",
    requires: [],
    effect: "reading",
    response: json(configAssetReferencesSchema),
    errors: [],
    rateClass: "read"
  })
} as const;
