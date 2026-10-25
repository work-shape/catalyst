import { dataStoreReviewHelpText, runDataStoreReviewCommand } from "../data-store-review-commands";
import type { CommandGroup } from "./types";

export const dataStoreReviewGroup: CommandGroup = {
  names: ["data-store review list", "data-store review decide"],
  matches: (argv) => argv[0] === "data-store" && argv[1] === "review",
  help: dataStoreReviewHelpText,
  run: runDataStoreReviewCommand
};
