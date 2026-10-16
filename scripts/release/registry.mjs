import { spawnSync } from "node:child_process";
// Registry requests must finish so a release cannot hang after partially publishing.
const REGISTRY_TIMEOUT_MS = 30_000;
// Gives the public build/publish time to finish; exhaustion leaves the release rerunnable.
const PUBLIC_PUBLISH_WAIT_MS = 20 * 60_000;
const REGISTRY_RETRY_MS = 15_000;

export function npmView(specifier, field) {
  const result = spawnSync(
    "npm",
    ["view", specifier, field, "--json", "--registry=https://registry.npmjs.org/"],
    {
      encoding: "utf8",
      timeout: REGISTRY_TIMEOUT_MS,
      env: {
        ...process.env,
        npm_config_fetch_retries: "0",
        npm_config_fetch_timeout: String(REGISTRY_TIMEOUT_MS)
      }
    }
  );
  if (result.error) throw new Error(`Registry request failed for ${specifier}`);
  if (result.status !== 0) {
    let code;
    try {
      code = JSON.parse(result.stdout).error?.code;
    } catch {
      /* Refuse unparseable registry failures. */
    }
    if (code === "E404") return undefined;
    throw new Error(`Registry request failed for ${specifier}; refusing to treat it as absent`);
  }
  // Candidate-only packages have no latest field after first-publish tag cleanup.
  if (field === "dist-tags.latest" && result.stdout.trim() === "") return undefined;
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`Invalid registry response for ${specifier}`);
  }
}

export async function waitForPackages(packages) {
  const deadline = Date.now() + PUBLIC_PUBLISH_WAIT_MS;
  let pending = packages;
  while (pending.length) {
    pending = pending.filter(
      ({ name, version }) => npmView(`${name}@${version}`, "version") !== version
    );
    if (!pending.length) return;
    if (Date.now() >= deadline)
      throw new Error(
        `Timed out waiting for ${pending.map(({ name }) => name).join(", ")}; rerun after its release completes`
      );
    await new Promise((resolve) => setTimeout(resolve, REGISTRY_RETRY_MS));
  }
}

export async function verifyRestricted(packages) {
  // fetch has no npm configuration or Authorization header: this is an anonymous probe.
  for (const { name } of packages) {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
      redirect: "error",
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS)
    });
    await response.body?.cancel();
    if (response.status !== 404)
      throw new Error(
        `${name}: anonymous registry returned ${response.status}; Felix must immediately run npm access set status=private ${name} if it is public`
      );
  }
}
