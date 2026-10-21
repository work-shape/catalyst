import { assetHelpText, runAssetCommand } from "../asset-commands";
import { APP_VERBS } from "../app-commands";
import { VERBS } from "../asset-verbs";
import { askTerminal } from "../cli-runtime";
import type { CommandGroup } from "./types";

export const assetsGroup: CommandGroup = {
  names: [
    "context",
    "kinds",
    "docs",
    "references",
    "operation show",
    "requests",
    ...Object.keys(VERBS)
      .filter((name) => name !== "pull")
      .map((name) => `<kind> ${name}`),
    "skill pull",
    ...Object.keys(APP_VERBS).map((name) => `app ${name}`)
  ],
  matches: () => true,
  help: assetHelpText,
  run: (argv, runtime) => {
    const prompt = runtime.prompt ?? (process.stdin.isTTY ? askTerminal : undefined);
    return runAssetCommand(argv, {
      cwd: runtime.cwd,
      stdout: runtime.stdout,
      stderr: runtime.stderr,
      ...(runtime.fetchImpl === undefined ? {} : { fetchImpl: runtime.fetchImpl }),
      ...(runtime.env === undefined ? {} : { env: runtime.env }),
      ...(prompt === undefined ? {} : { prompt })
    });
  }
};
