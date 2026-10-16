#!/usr/bin/env node
// Pack with pnpm (workspace:* and publishConfig.exports are rewritten), publish with npm
// (OIDC and provenance). Never publish the raw workspace manifests with npm.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { listPackages, repoRoot } from "./package-metadata.mjs";
import { guard } from "./guard.mjs";
import { compareVersions } from "./versions.mjs";
import { assertReleaseContext } from "./context.mjs";
import { npmView, verifyRestricted, waitForPackages } from "./registry.mjs";

/** Candidates use next; stable hotfixes never move latest backwards. */
export function distributionTag(version, latest) {
  if (version.includes("-")) return "next";
  if (latest && compareVersions(version, latest) < 0) {
    const [major, minor] = version.split(".");
    return `release-${major}.${minor}`;
  }
  return "latest";
}

// The registry may initialize latest on the first publish even when --tag next was used.
// Reconcile on reruns too, in case the job stopped after publish but before tag cleanup.
function settleDistributionTag(name, version, tag) {
  if (version.includes("-")) {
    if (npmView(name, "dist-tags.latest") === version) {
      try {
        execFileSync("npm", ["dist-tag", "rm", name, "latest"], { stdio: "inherit" });
      } catch (error) {
        const published = npmView(name, "versions");
        const versions = typeof published === "string" ? [published] : published;
        if (Array.isArray(versions) && versions.length === 1 && versions[0] === version) {
          console.warn(
            `${name}: leaving latest on ${version}; npm refused cleanup of its only version`
          );
          return;
        }
        throw error;
      }
    }
    if (npmView(name, "dist-tags.latest") === version)
      throw new Error(`${name}: candidate still has latest; rerun the release to remove it`);
  } else if (tag === "latest") {
    execFileSync("npm", ["dist-tag", "add", `${name}@${version}`, "latest"], { stdio: "inherit" });
  }
}

export async function publish(args) {
  for (let index = 0; index < args.length; index += 1) {
    if (["--root", "--group"].includes(args[index])) {
      index += 1;
      continue;
    }
    if (!["--dry-run", "--wait", "--verify"].includes(args[index]))
      throw new Error(`Unknown publish option: ${args[index]}`);
  }
  const value = (flag, fallback) => {
    const index = args.indexOf(flag);
    if (index === -1) return fallback;
    if (!args[index + 1] || args[index + 1].startsWith("--"))
      throw new Error(`${flag} needs a value`);
    return args[index + 1];
  };
  const root = resolve(value("--root", repoRoot));
  const group = value("--group", "restricted");
  if (!["public", "restricted"].includes(group))
    throw new Error("--group must be public or restricted");
  const packages = listPackages(root).filter(
    (pkg) => pkg.publishable && pkg.group.access === group
  );
  if (!packages.length) throw new Error("No packages selected");
  if (args.includes("--wait")) return waitForPackages(packages.map(({ manifest }) => manifest));
  if (args.includes("--verify")) return verifyRestricted(packages.map(({ manifest }) => manifest));
  guard([root]);
  const dryRun = args.includes("--dry-run");
  const version = dryRun
    ? packages[0].manifest.version
    : assertReleaseContext(root, { publicMirror: group === "public" });
  if (
    packages.some(
      ({ manifest }) =>
        manifest.version !== version || manifest.private || manifest.publishConfig?.access !== group
    )
  )
    throw new Error("Package version, privacy or access does not match the release");
  const temporary = mkdtempSync(join(tmpdir(), "catalyst-publish-"));
  try {
    // Topological order of this group. Public dependencies are awaited by core CI first.
    const pending = new Map(packages.map((pkg) => [pkg.manifest.name, pkg]));
    const ordered = [];
    while (pending.size) {
      const ready = [...pending.values()].filter(
        ({ manifest }) =>
          !Object.keys({
            ...manifest.dependencies,
            ...manifest.optionalDependencies,
            ...manifest.devDependencies,
            ...manifest.peerDependencies
          }).some((name) => pending.has(name))
      );
      if (!ready.length) throw new Error("Publish dependencies contain a cycle");
      for (const pkg of ready) {
        pending.delete(pkg.manifest.name);
        ordered.push(pkg);
      }
    }
    for (const pkg of ordered) {
      const latest = dryRun ? undefined : npmView(pkg.manifest.name, "dist-tags.latest");
      const tag = distributionTag(version, latest);
      if (!dryRun && npmView(`${pkg.manifest.name}@${version}`, "version") === version) {
        console.log(`Already published: ${pkg.manifest.name}@${version}`);
        settleDistributionTag(pkg.manifest.name, version, tag);
        continue;
      }
      execFileSync("pnpm", ["pack", "--pack-destination", temporary], {
        cwd: pkg.root,
        stdio: "pipe"
      });
      const tarball = join(
        temporary,
        readdirSync(temporary).find((file) => file.endsWith(".tgz"))
      );
      const manifest = JSON.parse(
        execFileSync("tar", ["-xzOf", tarball, "package/package.json"], { encoding: "utf8" })
      );
      if (
        JSON.stringify(manifest).includes("workspace:") ||
        manifest.private ||
        manifest.publishConfig?.access !== group
      )
        throw new Error(`${pkg.dir}: unsafe packed manifest`);
      execFileSync(
        "npm",
        [
          "publish",
          tarball,
          "--access",
          group,
          "--tag",
          tag,
          ...(group === "public" && !dryRun ? ["--provenance"] : []),
          ...(dryRun ? ["--dry-run", "--ignore-scripts"] : [])
        ],
        { cwd: root, stdio: "inherit" }
      );
      rmSync(tarball);
      if (!dryRun) settleDistributionTag(pkg.manifest.name, version, tag);
    }
    if (!dryRun && group === "restricted")
      await verifyRestricted(packages.map(({ manifest }) => manifest));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await publish(process.argv.slice(2));
}
