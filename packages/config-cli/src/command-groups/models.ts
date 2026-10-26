import { modelsHelpText, runModelsCommand } from "../model-commands";
import { askTerminal } from "../cli-runtime";
import type { CommandGroup } from "./types";

export const modelsGroup: CommandGroup = {
  names: ["models add", "models check", "models list"],
  matches: (argv) => argv[0] === "models",
  help: modelsHelpText,
  run: (argv, runtime) =>
    runModelsCommand(argv, {
      ...runtime,
      cwd: runtime.cwd,
      ...(runtime.prompt !== undefined
        ? { prompt: runtime.prompt }
        : process.stdin.isTTY
          ? { prompt: askTerminal }
          : {})
    })
};
