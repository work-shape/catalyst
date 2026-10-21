import type { Asset } from "@work-shape/catalyst-api-contract";
import { isRecord } from "./command-support";

/** The file diff of a publish contains names and change kinds, never source contents. */
export function publishFileChanges(next: Asset, live: Asset | undefined): string[] {
  const after = filesOf(next);
  const before = filesOf(live);
  return [...new Set([...after.keys(), ...before.keys()])].sort().flatMap((path) => {
    if (after.get(path) === before.get(path)) return [];
    return [`${path} (${!before.has(path) ? "added" : !after.has(path) ? "removed" : "changed"})`];
  });
}

function filesOf(asset: Asset | undefined): Map<string, string> {
  if (asset?.files) return new Map(asset.files.map((file) => [file.path, file.sha256]));
  const result = new Map<string, string>();
  const config = asset?.config;
  if (!isRecord(config)) return result;
  if (Array.isArray(config.files)) {
    for (const file of config.files) {
      if (isRecord(file) && typeof file.path === "string" && typeof file.content === "string") {
        result.set(file.path, file.content);
      }
    }
  }
  if (asset?.kind === "workflow" && config.manifest !== undefined) {
    result.set("workflow.yaml", JSON.stringify(config.manifest));
  }
  return result;
}
