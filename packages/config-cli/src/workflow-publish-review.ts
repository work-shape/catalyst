import { publishFileChanges } from "./publish-file-changes";
import type { ConfigApi } from "./api";
import { writeError, writeOutput, type ConfigCommandOptions } from "./command-support";

/** Read exactly the revision being published; Details never print file contents or rows. */
export async function workflowPublishDetails(input: {
  api: ConfigApi;
  options: ConfigCommandOptions;
  scope: { workspaceId?: string };
  name: string;
  revision: number;
  json: boolean;
}): Promise<(() => Promise<void>) | undefined> {
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
  const narrative = asset.publishNarrative;
  if (!narrative) return undefined;
  const say = (text: string) => (json ? writeError(options, text) : writeOutput(options, text));
  say([narrative.summary, ...narrative.warnings].join("\n"));
  return async () => {
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
  };
}
