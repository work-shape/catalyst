import { runInit } from "../init";
import type { CommandGroup } from "./types";

export const initGroup: CommandGroup = {
  names: ["init"],
  matches: (argv) => argv[0] === "init",
  help: "Working copy:\n  init --instance <alias-or-url> [--dir <root>]\n             Bind a new folder and write agent guidance in AGENTS.md and CLAUDE.md\n",
  run: (argv, runtime) => runInit(argv.slice(1), runtime)
};
