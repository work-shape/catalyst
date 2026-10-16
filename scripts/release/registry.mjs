import { spawnSync } from "node:child_process";
// Registry requests must finish so a release cannot hang after partially publishing.
const REGISTRY_TIMEOUT_MS = 30_000;
// Gives the public build/publish time to finish; exhaustion leaves the release rerunnable.
const PUBLIC_PUBLISH_WAIT_MS = 20 * 60_000;
// Back off during npm processing; the total wait remains PUBLIC_PUBLISH_WAIT_MS.
const REGISTRY_RETRY_MS = 15_000;
const REGISTRY_MAX_RETRY_MS = 60_000;

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
  const pending = new Map(packages.map((pkg) => [pkg, "not checked"]));
  let retryMs = REGISTRY_RETRY_MS;
  while (pending.size) {
    for (const [pkg] of pending) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      const { name, version } = pkg;
      let response;
      try {
        response = await fetch(
          `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
          {
            // Return redirects as HTTP errors instead of hiding their status in a fetch failure.
            redirect: "manual",
            signal: AbortSignal.timeout(Math.min(REGISTRY_TIMEOUT_MS, remainingMs))
          }
        );
      } catch {
        pending.set(pkg, "network error");
        continue;
      }
      pending.set(pkg, `HTTP ${response.status}`);
      if (!response.ok) {
        await response.body?.cancel();
        if (
          response.status === 404 ||
          response.status === 429 ||
          (response.status >= 500 && response.status <= 599)
        )
          continue;
        throw new Error(
          `Registry request failed for ${name}@${version}: HTTP ${response.status}; refusing to treat it as absent`
        );
      }
      let manifest;
      try {
        manifest = await response.json();
      } catch (error) {
        if (error instanceof SyntaxError)
          throw new Error(`Invalid registry response for ${name}@${version}`);
        pending.set(pkg, "network error");
        continue;
      }
      if (manifest?.version === version) pending.delete(pkg);
    }
    if (!pending.size) return;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0)
      throw new Error(
        `Timed out waiting for ${[...pending].map(([{ name }, status]) => `${name} (${status})`).join(", ")}; rerun after its release completes`
      );
    await new Promise((resolve) => setTimeout(resolve, Math.min(retryMs, remainingMs)));
    retryMs = Math.min(retryMs * 2, REGISTRY_MAX_RETRY_MS);
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
