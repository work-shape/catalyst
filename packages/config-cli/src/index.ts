import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { RELEASE_VERSION } from "@work-shape/catalyst-api-contract";
import { commandGroups } from "./command-groups";
import { assetsGroup } from "./command-groups/assets";
import type { CliRuntimeOptions } from "./cli-runtime";

export * from "./api";
export { publishReview, type PublishReview } from "./app-commands";
export * from "./commands";
export * from "./diff";
export * from "./serialization";
export { renderCatalystSkill } from "./setup";
export * from "./working-copy";

export type { CliRuntimeOptions } from "./cli-runtime";
export { commandNames } from "./command-groups";

export async function runCli(argv: string[], runtime: CliRuntimeOptions = {}): Promise<number> {
  const stdout = runtime.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = runtime.stderr ?? ((text: string) => process.stderr.write(text));
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    stdout(commandGroups.map((group) => group.help).join("\n"));
    return 0;
  }
  if (argv[0] === "--version") {
    stdout(`${RELEASE_VERSION}\n`);
    return 0;
  }
  const group =
    commandGroups.find((candidate) => candidate !== assetsGroup && candidate.matches(argv)) ??
    assetsGroup;
  return group.run(argv, { ...runtime, cwd: runtime.cwd ?? process.cwd(), stdout, stderr });
}

const entryPath = process.argv[1];
// The bin is reached through a node_modules symlink, so compare resolved paths.
if (entryPath && import.meta.url === pathToFileURL(realpathSync(entryPath)).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
