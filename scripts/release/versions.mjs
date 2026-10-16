import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Strict SemVer, including numeric prerelease identifiers without leading zeroes.
const NUMBER = "(?:0|[1-9][0-9]*)";
const IDENTIFIER = `(?:${NUMBER}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const SEMVER = new RegExp(
  `^(${NUMBER})\\.(${NUMBER})\\.(${NUMBER})(?:-(${IDENTIFIER}(?:\\.${IDENTIFIER})*))?$`,
  "u"
);

export function versionParts(version) {
  const match = typeof version === "string" ? SEMVER.exec(version) : null;
  if (!match || match[0] !== version)
    throw new Error(`"${version}" is not a SemVer version without build metadata.`);
  return { numbers: match.slice(1, 4).map(BigInt), prerelease: match[4]?.split(".") ?? [] };
}

/** SemVer precedence for release versions (build metadata is refused). */
export function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index] ? 1 : -1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0)
    return Number(b.prerelease.length > 0) - Number(a.prerelease.length > 0);
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const x = a.prerelease[index];
    const y = b.prerelease[index];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const numericX = /^[0-9]+$/u.test(x);
    const numericY = /^[0-9]+$/u.test(y);
    if (numericX && numericY) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (numericX !== numericY) return numericX ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

export function manifests(root) {
  const paths = [join(root, "package.json")];
  for (const folder of ["packages", "clients"]) {
    const parent = join(root, folder);
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      const path = join(parent, entry.name, "package.json");
      if (entry.isDirectory() && existsSync(path)) paths.push(path);
    }
  }
  return paths.map((path) => ({ path, manifest: JSON.parse(readFileSync(path, "utf8")) }));
}

/** Read-only lockstep check, also usable without preparing or cutting a release. */
export function checkCurrentVersion(roots) {
  const versions = new Set(
    roots.flatMap((root) =>
      manifests(root).flatMap(({ manifest }) =>
        manifest.version === undefined ? [] : [manifest.version]
      )
    )
  );
  if (versions.size !== 1)
    throw new Error(
      `Core and capabilities must share one current version; found ${[...versions].join(", ")}.`
    );
  return [...versions][0];
}
