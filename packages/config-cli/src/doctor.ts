import { parseArgs } from "node:util";
import { createApiClient, ApiError } from "@work-shape/catalyst-api-client";
import { RELEASE_VERSION } from "@work-shape/catalyst-api-contract";
import { assertSafeApiKeyExchangeUrl, instanceFetch } from "./api";
import { connectApi, type ConfigCommandOptions } from "./command-support";
import { cliCompatibilityError } from "./instance-output";
import { resolveInstanceUrl } from "./login";
import type { CommandGroup } from "./command-groups/types";

const help = `Diagnostics:
  doctor [--instance <name-or-url>] [--dir <working-copy-dir>]
             Check address, sign-in, versions and effective key rights; safe to share
`;

export const doctorGroup: CommandGroup = {
  names: ["doctor"],
  matches: (argv) => argv[0] === "doctor",
  help,
  async run(argv, runtime) {
    let values;
    try {
      ({ values } = parseArgs({
        args: argv.slice(1),
        options: {
          instance: { type: "string" },
          dir: { type: "string" },
          help: { type: "boolean", short: "h" }
        },
        strict: true
      }));
    } catch {
      runtime.stderr(
        `Usage: catalyst doctor [--instance <name-or-url>] [--dir <working-copy-dir>]\n`
      );
      return 2;
    }
    if (values.help) {
      runtime.stdout(help);
      return 0;
    }
    return doctor({ ...runtime, instance: values.instance, dir: values.dir });
  }
};

async function doctor(options: ConfigCommandOptions): Promise<number> {
  let address = "FAIL Address: no instance selected; pass --instance <url>";
  let signIn = "SKIP Sign-in: address check failed";
  let versions = `SKIP Versions: CLI ${RELEASE_VERSION}; server unavailable`;
  let rights = "SKIP Key rights: sign-in not checked";
  let code = 1;
  try {
    const url = await resolveInstanceUrl(options);
    const displayUrl = new URL(url);
    displayUrl.username = "";
    displayUrl.password = "";
    displayUrl.search = "";
    displayUrl.hash = "";
    address = `FAIL Address: ${displayUrl}; use the instance's HTTPS origin, without /api or a sign-in path`;
    assertSafeApiKeyExchangeUrl(url);
    let serverVersion: string | undefined;
    // Doctor keeps version failures separate from reachability. No credentials on this probe.
    const fetchImpl = instanceFetch(options.fetchImpl, {
      checkVersion: false,
      timeoutMs: 10_000,
      onServerVersion: (version) => {
        serverVersion = version;
      }
    });
    const probe = createApiClient({ baseUrl: url, fetchImpl });
    try {
      await probe.health.get();
    } catch (error) {
      const info = error instanceof ApiError ? error.responseInfo : undefined;
      if (info)
        address = `FAIL Address: ${info.url} returned ${info.body} (HTTP ${error instanceof ApiError ? error.status : "unknown"}, ${info.contentType})`;
      throw error;
    }
    address = `OK Address: ${displayUrl}`;
    const mismatch =
      serverVersion === undefined
        ? undefined
        : cliCompatibilityError(RELEASE_VERSION, serverVersion);
    if (mismatch) {
      versions = `FAIL Versions: ${mismatch.message}`;
      signIn = "SKIP Sign-in: update the CLI first";
      throw mismatch;
    }
    versions =
      serverVersion === undefined
        ? `SKIP Versions: CLI ${RELEASE_VERSION}; server has no version header`
        : `OK Versions: CLI ${RELEASE_VERSION}; server ${serverVersion}`;
    signIn = "FAIL Sign-in: no working key; run catalyst login --instance <url>";
    rights = "SKIP Key rights: sign-in failed";
    const api = await connectApi(url, { ...options, fetchImpl });
    signIn = "OK Sign-in: API key accepted";
    rights = "FAIL Key rights: could not read effective rights";
    const context = await api.read((client) => client.platform.context.get());
    const compatibility = cliCompatibilityError(RELEASE_VERSION, context.release.version);
    if (compatibility) {
      versions = `FAIL Versions: ${compatibility.message}`;
      rights = "SKIP Key rights: update the CLI first";
      throw compatibility;
    }
    versions = `OK Versions: CLI ${RELEASE_VERSION}; server ${context.release.version}`;
    const instanceActions = new Set([...context.actions, ...context.instanceActions]).size;
    const workspaceActions = context.workspaces.reduce(
      (sum, workspace) => sum + workspace.actions.length,
      0
    );
    const count = instanceActions + context.assetActions.length + workspaceActions;
    rights =
      count === 0
        ? "FAIL Key rights: no effective actions; ask an instance admin to check the key's scopes and your grants"
        : `OK Key rights: ${instanceActions} instance actions, ${context.assetActions.length} scoped asset actions, ${workspaceActions} workspace actions`;
    code = count === 0 ? 1 : 0;
  } catch {
    // Only our diagnostic categories are printed, never server messages, identities or keys.
  }
  (options.stdout ?? ((text) => process.stdout.write(text)))(
    `${[address, signIn, versions, rights].join("\n")}\n`
  );
  return code;
}
