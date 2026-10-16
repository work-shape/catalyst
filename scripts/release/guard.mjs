#!/usr/bin/env node
// Read-only policy gate. A private npm package is publishable with restricted access;
// `private: true` instead means development tooling that must never reach a registry.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findMetadataDrift, listPackages, repoRoot } from "./package-metadata.mjs";
import { checkCurrentVersion, manifests } from "./versions.mjs";

export function guard(roots) {
  const problems = [];
  try {
    const version = checkCurrentVersion(roots);
    if (roots.some((root) => manifests(root).some(({ manifest }) => manifest.version !== version)))
      problems.push("Every retained manifest needs the lockstep version");
  } catch (error) {
    problems.push(error.message);
  }
  const packages = roots.flatMap((root) => listPackages(root));
  const publicNames = new Set(
    packages.filter((pkg) => pkg.group.access === "public").map((pkg) => pkg.manifest.name)
  );
  for (const root of roots) {
    for (const dir of findMetadataDrift({ root }))
      problems.push(`${root}: metadata drift in ${dir}`);
    const rootManifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    if (rootManifest.private !== true) problems.push(`${root}: repository root must be private`);
    const clients = resolve(root, "clients");
    if (existsSync(clients))
      for (const dir of readdirSync(clients)) {
        const path = resolve(clients, dir, "package.json");
        if (existsSync(path) && JSON.parse(readFileSync(path, "utf8")).private !== true)
          problems.push(`${dir}: client assembly must be private`);
      }
    if (existsSync(resolve(root, "packages/registry-canary")))
      problems.push("registry-canary must be removed");
  }
  for (const pkg of packages) {
    const { manifest, dir, group } = pkg;
    if (!pkg.publishable) {
      if (manifest.private !== true) problems.push(`${dir}: unpublished tooling must be private`);
      if (manifest.publishConfig?.access === "public" || manifest.license === "MIT")
        problems.push(`${dir}: only the four public packages may declare public access or MIT`);
      continue;
    }
    if (manifest.private) problems.push(`${dir}: published package must not set private`);
    if (manifest.license !== group.license || manifest.publishConfig?.access !== group.access)
      problems.push(`${dir}: expected ${group.license} and ${group.access}`);
    if (group.access === "public") {
      if (!existsSync(resolve(pkg.root, "LICENSE")))
        problems.push(`${dir}: public package needs LICENSE`);
      for (const section of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies"
      ]) {
        for (const name of Object.keys(manifest[section] ?? {}))
          if (name.startsWith("@work-shape/catalyst-") && !publicNames.has(name))
            problems.push(`${dir}: public package depends on private package ${name}`);
      }
    }
  }
  if (problems.length) throw new Error(`release:guard refused:\n${problems.join("\n")}`);
  return packages.filter((pkg) => pkg.publishable);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf("--root");
  if (index !== -1 && !process.argv[index + 1]) throw new Error("--root needs a directory");
  const roots = [repoRoot, ...(index === -1 ? [] : [resolve(process.argv[index + 1])])];
  console.log(`release:guard passed: ${guard(roots).length} publishable packages`);
}
