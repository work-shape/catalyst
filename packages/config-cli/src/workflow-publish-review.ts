import { dataStoreLine } from "./app-publish-together";
import { publishFileChanges } from "./publish-file-changes";
import type { ConfigApi } from "./api";
import { writeError, writeOutput, type ConfigCommandOptions } from "./command-support";

/** What a Workflow's publish shows before its question, and the stores it names (LIVE-2). */
export interface WorkflowPublishReview {
  /** The Data Stores one Publish makes live first, at the revisions shown; as the page sends. */
  dataStores: { name: string; revision: number }[];
  /** Absent where there is no narrative to fold the rest behind. */
  details?: () => Promise<void>;
}

/**
 * Read exactly the revision being published and say what it changes: the Data Stores it
 * publishes first with the migrations each applies, and the Workflow's own account, as the
 * Workflow page's question does. Details never print file contents or rows. `--yes` shows the
 * same lines and asks nothing.
 */
export async function workflowPublishReview(input: {
  api: ConfigApi;
  options: ConfigCommandOptions;
  scope: { workspaceId?: string };
  name: string;
  revision: number;
  json: boolean;
  /** The answer comes from the flag, so the sentence leading the question is not shown. */
  yes: boolean;
}): Promise<WorkflowPublishReview> {
  const { api, options, scope, name, revision, json } = input;
  const get = (selected: string) =>
    api.read((client) =>
      client.assets.get({
        params: { kind: "workflow", name },
        query: { revision: selected, ...scope }
      })
    );
  const asset = await get(String(revision));
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
  const narrative = input.yes ? undefined : asset.publishNarrative;
  // Without the leading sentence the lines of the question stand in for it, as for an App.
  const lead = narrative
    ? [narrative.summary, ...narrative.warnings, ...together]
    : [...together, ...(asset.publishQuestion ?? [])];
  if (lead.length > 0) say(lead.join("\n"));
  const dataStores = stores.map(({ name: store, revision: draft }) => ({
    name: store,
    revision: draft
  }));
  if (!narrative) return { dataStores };
  return {
    dataStores,
    details: async () => {
      const live =
        asset.publishedRevision === undefined
          ? undefined
          : await get(String(asset.publishedRevision));
      say(
        [
          "Details",
          ...publishFileChanges(asset, live),
          ...(asset.filesOmitted || live?.filesOmitted
            ? ["Some files are omitted from this review."]
            : []),
          ...(asset.publishQuestion ?? [])
        ].join("\n")
      );
    }
  };
}
