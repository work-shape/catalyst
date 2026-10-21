import { operationHelpText, runOperationCommand } from "../operation-commands";
import type { CommandGroup } from "./types";

const connectionVerbs = ["secret", "test", "discover", "tools", "connect", "disconnect"];
export const operationsGroup: CommandGroup = {
  names: [
    "call",
    ...connectionVerbs.map((verb) => `connection ${verb === "secret" ? "secret set" : verb}`)
  ],
  matches: (argv) =>
    argv[0] === "call" || (argv[0] === "connection" && connectionVerbs.includes(argv[1] ?? "")),
  help: operationHelpText,
  run: runOperationCommand
};
