import {
  dataStoreTestCopyHelpText,
  runDataStoreTestCopyCommand
} from "../data-store-test-copy-commands";
import type { CommandGroup } from "./types";

export const dataStoreTestCopyGroup: CommandGroup = {
  names: ["data-store test-copy reset", "data-store test-copy delete"],
  matches: (argv) => argv[0] === "data-store" && argv[1] === "test-copy",
  help: dataStoreTestCopyHelpText,
  run: runDataStoreTestCopyCommand
};
