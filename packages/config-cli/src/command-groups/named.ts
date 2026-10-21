import {
  isNamedCommand,
  isNamedNoun,
  namedHelpText,
  namedCommandNames,
  runNamedCommand
} from "../named-commands";
import type { CommandGroup } from "./types";

export const namedGroup: CommandGroup = {
  names: namedCommandNames(),
  matches: (argv) =>
    isNamedCommand(argv) ||
    (isNamedNoun(argv[0]) && (argv.length === 1 || argv.includes("--help"))),
  help: namedHelpText,
  run: async (argv, runtime) => {
    if (!isNamedCommand(argv)) {
      runtime.stdout(namedHelpText);
      return 0;
    }
    return runNamedCommand(argv, runtime);
  }
};
