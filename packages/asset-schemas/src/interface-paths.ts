import type { AppMode } from "./contract-values";

// The paths of the interface's pages that the server names in its answers, so an agent links a
// page without building its address, and the interface resolves the same path to its route.

/**
 * The path of the interface route that shows one App to a signed-in person: the published
 * revision under `/apps/`, or the draft under `/app-drafts/`. Every path below the published
 * one is the App's own, so the draft stands outside it: an App may have any route, `/edit`
 * among them. The server answers it from `apps.preview` and the interface builds its routes
 * from it, so the two never disagree.
 */
export function appInterfacePath(input: {
  workspaceId: string;
  app: string;
  mode: AppMode;
}): string {
  const area = input.mode === "draft" ? "app-drafts" : "apps";
  return `/w/${encodeURIComponent(input.workspaceId)}/${area}/${encodeURIComponent(input.app)}`;
}

/** The Studio list of each kind that has one, by the kind's id: `/build/<path>/<name>`. */
export const STUDIO_KIND_PATHS: Readonly<Record<string, string>> = {
  agent: "agents",
  skill: "skills",
  connection: "connections",
  data_store: "data-stores",
  knowledge_base: "knowledge-bases",
  guardrail: "guardrails"
};

/**
 * The path of the page where a person works on an asset: its Studio page, a Workflow's canvas,
 * or an App's draft. Nothing for a kind without a page, or for a Workflow or App without the
 * workspace that owns it. It names only what the caller already read: kind, name and owner.
 */
export function assetPagePath(asset: {
  kind: string;
  name: string;
  workspaceId?: string | undefined;
}): string | undefined {
  const name = encodeURIComponent(asset.name);
  if (Object.hasOwn(STUDIO_KIND_PATHS, asset.kind)) {
    return `/build/${STUDIO_KIND_PATHS[asset.kind]}/${name}`;
  }
  if (asset.workspaceId === undefined) return undefined;
  if (asset.kind === "workflow") {
    return `/w/${encodeURIComponent(asset.workspaceId)}/workflows/${name}`;
  }
  return asset.kind === "app"
    ? appInterfacePath({ workspaceId: asset.workspaceId, app: asset.name, mode: "draft" })
    : undefined;
}

/**
 * The path of one conversation of a workspace: a link to it opens the conversation, so a person
 * goes on there with the work it holds, such as the files of an App built in it.
 */
export function conversationInterfacePath(input: {
  workspaceId: string;
  conversationId: string;
}): string {
  return `/w/${encodeURIComponent(input.workspaceId)}/c/${encodeURIComponent(input.conversationId)}`;
}

/** The path of one item of the Inbox, such as an approval request, by its id. */
export function inboxItemPath(itemId: string): string {
  return `/inbox/${encodeURIComponent(itemId)}`;
}
