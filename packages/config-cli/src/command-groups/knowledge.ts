import { knowledgeHelpText, runKnowledgeCommand } from "../knowledge-commands";
import type { CommandGroup } from "./types";

export const knowledgeGroup: CommandGroup = {
  names: [
    "knowledge-base source add",
    "knowledge-base source list",
    "knowledge-base source remove",
    "knowledge-base source status",
    "knowledge-base source retry",
    "knowledge-base sync",
    "knowledge-base reindex"
  ],
  matches: (argv) =>
    argv[0] === "knowledge-base" &&
    (argv[1] === "source" || argv[1] === "sync" || argv[1] === "reindex"),
  help: knowledgeHelpText,
  run: runKnowledgeCommand
};
