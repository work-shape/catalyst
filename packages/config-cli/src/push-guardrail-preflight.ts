import type { ConfigApi } from "./api";
import {
  writeError,
  type ConfigCommandOptions,
  type LocalAsset,
  type RemoteAsset
} from "./command-support";

/** Check every guardrail before the release batch or any guardrail write can start. */
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
): Promise<boolean> {
  for (const asset of [...input.puts, ...input.deletes]) {
    const base = input.baseOf(asset.key);
    const current = input.listing.get(asset.key);
    const revision =
      current?.revision ??
      (base === undefined
        ? undefined
        : (await api.getLatestRevision(asset.kind, asset.name))?.revision);
    if ((revision ?? null) !== (base?.revision ?? null)) {
      writeError(
        input.options,
        `Push refused; nothing was applied. ${asset.key} changed since the last pull. Run 'catalyst config pull --only ${asset.key}'.`
      );
      return false;
    }
  }
  for (const asset of input.puts) {
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
      return false;
    }
  }
  return true;
}
