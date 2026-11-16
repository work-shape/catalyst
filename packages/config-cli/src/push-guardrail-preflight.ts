import type { ConfigApi } from "./api";
import {
  writeError,
  type ConfigCommandOptions,
  type LocalAsset,
  type RemoteAsset
} from "./command-support";

/** A guardrail that changed on the instance since the last pull: the push skips it. */
export interface StaleGuardrail {
  kind: string;
  name: string;
  currentRevision: number | null;
}

/**
 * Check every guardrail before the release batch or any guardrail write can start. Answers the
 * guardrails that changed on the instance since the last pull, which the push skips, or nothing
 * where one that did not change is invalid, which it has reported.
 */
export async function preflightGuardrails(
  api: ConfigApi,
  input: {
    puts: readonly LocalAsset[];
    deletes: readonly RemoteAsset[];
    listing: ReadonlyMap<string, RemoteAsset>;
    baseOf: (key: string) => { revision: number } | undefined;
    workspaceId?: string;
    options: ConfigCommandOptions;
  }
): Promise<{ stale: StaleGuardrail[] } | undefined> {
  const stale: StaleGuardrail[] = [];
  for (const asset of [...input.puts, ...input.deletes]) {
    const base = input.baseOf(asset.key);
    const current = input.listing.get(asset.key);
    const revision =
      current?.revision ??
      (base === undefined
        ? undefined
        : (await api.getLatestRevision(asset.kind, asset.name))?.revision);
    if ((revision ?? null) !== (base?.revision ?? null)) {
      stale.push({ kind: asset.kind, name: asset.name, currentRevision: revision ?? null });
    }
  }
  const staleKeys = new Set(stale.map((asset) => `${asset.kind}:${asset.name}`));
  for (const asset of input.puts.filter((put) => !staleKeys.has(put.key))) {
    const checked = await api.read((client) =>
      client.assets.validate({
        params: { kind: asset.kind },
        body: {
          config: { ...asset.config },
          ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId })
        }
      })
    );
    if (!checked.valid) {
      // Paths and counts identify the invalid definition without repeating its values.
      const paths = checked.issues.flatMap((issue) => issue.path?.join(".") ?? []);
      writeError(
        input.options,
        `Validation failed for ${asset.key}: ${checked.issues.length} ${checked.issues.length === 1 ? "issue" : "issues"}${paths.length ? ` (${paths.join(", ")})` : ""}; nothing was applied.`
      );
      return undefined;
    }
  }
  return { stale };
}
