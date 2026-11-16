import { dataStoreLine } from "./app-publish-together";
import type { ConfigApi } from "./api";
import { writeError, writeOutput, type ConfigCommandOptions } from "./command-support";

/** The Data Stores a Workflow's publish names, which it makes live first (LIVE-2). */
export interface WorkflowPublishReview {
  /** The Data Stores one Publish makes live first, at the revisions shown; as the page sends. */
  dataStores: { name: string; revision: number }[];
}

/**
 * Read exactly the revision being published and say what it changes before it is sent: the
 * Data Stores it publishes first with the migrations each applies, and the Workflow's own
 * account, as the Workflow page's question does. It asks nothing (PUB-LIVE-1) and never prints
 * file contents or rows.
 */
export async function workflowPublishReview(input: {
  api: ConfigApi;
  options: ConfigCommandOptions;
  scope: { workspaceId?: string };
  name: string;
  revision: number;
  json: boolean;
}): Promise<WorkflowPublishReview> {
  const { api, options, scope, name, revision, json } = input;
  const asset = await api.read((client) =>
    client.assets.get({
      params: { kind: "workflow", name },
      query: { revision: String(revision), ...scope }
    })
  );
  if ((asset.contentRevision ?? asset.revision) !== revision) {
    throw new Error("The publish review does not describe this revision. Nothing was published.");
  }
  const say = (text: string) => (json ? writeError(options, text) : writeOutput(options, text));
  const stores = asset.publishDataStores ?? [];
  const together =
    stores.length === 0
      ? []
      : [
          "Publishes together: the Data Stores and their migrations first, then the Workflow, or neither:",
          ...stores.map(dataStoreLine)
        ];
  const narrative = asset.publishNarrative;
  // Without the leading sentence the lines of the review stand in for it, as for an App.
  const lead = narrative
    ? [narrative.summary, ...narrative.warnings, ...together]
    : [...together, ...(asset.publishQuestion ?? [])];
  if (lead.length > 0) say(lead.join("\n"));
  return {
    dataStores: stores.map(({ name: store, revision: draft }) => ({
      name: store,
      revision: draft
    }))
  };
}
