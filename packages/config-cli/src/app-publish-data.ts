import type { ApiClient } from "@work-shape/catalyst-api-client";
import type { Asset } from "@work-shape/catalyst-api-contract";
import type { ConfigApi } from "./api";
import { isRecord } from "./command-support";

type AppSources = Awaited<ReturnType<ApiClient["data_stores"]["app_sources"]>>;

/**
 * The selected revision's stored-data disclosure, before asking to publish. Reading actions
 * can take parameters: a store's measured row estimate is never the number they expose.
 * An unavailable disclosure stops the publish before its question or changing request.
 */
export async function appPublishData(
  api: ConfigApi,
  app: string,
  candidate: Asset,
  audienceLabel?: string
): Promise<string> {
  const config = candidate.config;
  const manifest = isRecord(config) && isRecord(config.manifest) ? config.manifest : undefined;
  const reads =
    Array.isArray(manifest?.actions) &&
    manifest.actions.some(
      (action: unknown) => isRecord(action) && action.kind === "sql" && action.effect === "reading"
    );
  if (!reads) return "";
  const revision = candidate.contentRevision ?? candidate.revision;
  const data = await api.read((client) =>
    client.data_stores.app_sources({ query: { app, revision } })
  );
  if (data.revision !== revision || data.audience === undefined) {
    throw new Error(
      "The stored-data summary does not describe this revision. Nothing was published."
    );
  }
  return formatStoredData(data, audienceLabel);
}

function formatStoredData(data: AppSources, audienceLabel?: string): string {
  const audience = data.audience;
  if (!audience) return "";
  return [
    "Who sees the stored data:",
    ...(audienceLabel ? [`  ${audienceLabel}.`] : []),
    ...(!audienceLabel && audience.workspace
      ? [`  Everyone in ${audience.workspace.title} (${audience.workspace.members} people).`]
      : []),
    ...audience.holders.map((holder) => `  Additional ${holder.kind}: ${holder.title}.`),
    ...(audience.hiddenHolders > 0
      ? [`  ${audience.hiddenHolders} additional grant holders (not a count of people).`]
      : []),
    "  Instance admins also have access.",
    "Stored data its reading actions select:",
    ...data.stores.flatMap((store) => [
      `  ${store.title}: ${(store.actions ?? []).join(", ")}.`,
      ...(store.unavailable
        ? ["    No Data Store of this name is available to the App; a publish is refused."]
        : store.rows
          ? [
              `    Whole store: about ${store.rows.estimate} rows in ${store.rows.tables} ${store.rows.tables === 1 ? "table" : "tables"}, measured ${store.rows.measuredAt}; not the number these actions select.`
            ]
          : ["    No measured row estimate is available."]),
      ...store.fillers.map(
        (filler) =>
          `    Copied by ${filler.kind === "workflow" ? "Workflow" : "App"} ${filler.title}${filler.connections.length > 0 ? ` from ${filler.connections.join(", ")}` : ""}.`
      )
    ]),
    "Published SQL actions use the store's app role. Store rights are checked against the publisher, not each viewer. Everyone who may use the App sees what its actions select; their source-system rights are not checked again.",
    ...(data.truncated
      ? ["This summary is incomplete: more assets or grant holders exist than one read can show."]
      : [])
  ].join("\n");
}
