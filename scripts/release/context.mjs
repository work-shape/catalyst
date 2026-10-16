#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./package-metadata.mjs";
import { manifests } from "./versions.mjs";

export function releaseVersion(root, tag) {
  if (
    !/^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-rc\.(0|[1-9][0-9]*))?$/u.test(
      tag ?? ""
    )
  )
    throw new Error("A release requires a vX.Y.Z or vX.Y.Z-rc.N tag");
  const version = tag.slice(1);
  if (manifests(root).some(({ manifest }) => manifest.version !== version))
    throw new Error(`Every manifest must match release tag ${tag}`);
  return version;
}

export function assertReleaseContext(root, { publicMirror = false } = {}) {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REF_TYPE !== "tag")
    throw new Error("Publishing is only allowed from a GitHub Actions release tag");
  const version = releaseVersion(root, process.env.GITHUB_REF_NAME);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const sha = git("rev-parse", "HEAD");
  if (git("rev-parse", `${process.env.GITHUB_REF_NAME}^{commit}`) !== sha)
    throw new Error("The checkout is not the release tag commit");
  const branches = git("branch", "-r", "--contains", sha, "--format=%(refname:short)").split("\n");
  if (!branches.some((branch) => branch === "origin/main" || branch.startsWith("origin/release/")))
    throw new Error("Release tag commit must be on main or release/*");
  if (!publicMirror) {
    const repository = process.env.GITHUB_REPOSITORY;
    if (!/^work-shape\/catalyst-(?:core|capabilities)$/u.test(repository ?? ""))
      throw new Error("Unexpected release repository");
    const result = execFileSync(
      "gh",
      ["api", `repos/${repository}/actions/workflows/check.yml/runs?head_sha=${sha}&per_page=100`],
      { encoding: "utf8" }
    );
    const runs = JSON.parse(result).workflow_runs;
    const checked = runs.find(
      (run) =>
        run.head_sha === sha &&
        run.event === "push" &&
        (run.head_branch === "main" || run.head_branch.startsWith("release/"))
    );
    if (!checked || checked.status !== "completed" || checked.conclusion !== "success")
      throw new Error("Release tag commit needs a successful Check push run on main or release/*");
  } else if (process.env.GITHUB_REPOSITORY !== "work-shape/catalyst") {
    throw new Error("Unexpected public mirror repository");
  }
  return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rootIndex = process.argv.indexOf("--root");
  const root = rootIndex === -1 ? repoRoot : resolve(process.argv[rootIndex + 1]);
  const version = assertReleaseContext(root, { publicMirror: process.argv.includes("--public") });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  console.log(`Release tag ${version} is eligible`);
}
