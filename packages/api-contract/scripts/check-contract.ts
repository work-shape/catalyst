// Holds the committed document against the document of the newest release that has paths
// under the version prefix, and fails on a change that breaks a caller of that release.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  API_VERSION_PREFIX,
  findBreakingChanges,
  selectContractBaseline,
  type ReleasedDocument
} from "../src/index";
import { artifactPath } from "./openapi-artifact";

const packageDir = dirname(artifactPath);

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: packageDir, encoding: "utf8", maxBuffer: 64 << 20 });
}

/** Release tags (v1.2.3) reachable from this commit, newest first. */
function releaseTags(): string[] {
  return git(["tag", "--list", "v*", "--merged", "HEAD", "--sort=-version:refname"])
    .split("\n")
    .filter((tag) => /^v\d+\.\d+\.\d+$/u.test(tag));
}

function releasedDocument(tag: string): ReleasedDocument[] {
  try {
    // The path is relative to this package, wherever the repository root is.
    const text = execFileSync("git", ["show", `${tag}:./openapi.json`], {
      cwd: packageDir,
      encoding: "utf8",
      maxBuffer: 64 << 20,
      stdio: ["ignore", "pipe", "ignore"]
    });
    return [{ tag, document: JSON.parse(text) as unknown }];
  } catch {
    // A release from before the document was committed.
    return [];
  }
}

const tags = releaseTags();
const baseline = selectContractBaseline(tags.flatMap(releasedDocument));
if (!baseline) {
  console.log(
    `[check:contract] no release has a document with ${API_VERSION_PREFIX} paths yet (looked at ${tags.length} release tags, newest ${tags[0] ?? "none"}); nothing to compare, passing`
  );
  process.exit(0);
}

const current: unknown = JSON.parse(await readFile(artifactPath, "utf8"));
const findings = findBreakingChanges(baseline.document, current);
if (findings.length > 0) {
  console.error(`[check:contract] breaking changes against ${baseline.tag}:`);
  for (const finding of findings) console.error(`  ${finding}`);
  console.error(
    `[check:contract] a caller of ${baseline.tag} must keep working under ${API_VERSION_PREFIX}; a breaking change belongs under a new version prefix`
  );
  process.exit(1);
}
console.log(`[check:contract] no breaking change against ${baseline.tag}`);
