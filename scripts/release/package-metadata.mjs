// Public release policy. The mirror ships only this policy, never the core inventory.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC_PACKAGE_DIRS = ["config-cli", "asset-schemas", "api-contract", "api-client"];

export function listPackages(root = repoRoot) {
  return readdirSync(resolve(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name: dir }) => {
      if (!PUBLIC_PACKAGE_DIRS.includes(dir)) throw new Error(`Unexpected public package ${dir}`);
      const manifestPath = resolve(root, "packages", dir, "package.json");
      return {
        dir,
        root: dirname(manifestPath),
        manifestPath,
        manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
        publishable: true,
        group: { license: "MIT", access: "public" }
      };
    })
    .sort((left, right) => left.dir.localeCompare(right.dir));
}

export function findMetadataDrift({ root = repoRoot } = {}) {
  return listPackages(root)
    .filter(
      ({ dir, manifest }) =>
        manifest.license !== "MIT" ||
        manifest.repository?.url !== "https://github.com/work-shape/catalyst" ||
        manifest.repository?.directory !== `packages/${dir}` ||
        manifest.publishConfig?.access !== "public" ||
        manifest.publishConfig?.registry !== "https://registry.npmjs.org/"
    )
    .map(({ dir }) => dir);
}
