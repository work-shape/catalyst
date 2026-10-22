import { assetsGroup } from "./assets";
import { authGroup } from "./auth";
import { configGroup } from "./config";
import { catalogueGroup } from "./catalogue";
import { initGroup } from "./init";
import { knowledgeGroup } from "./knowledge";
import { namedGroup } from "./named";
import { operationsGroup } from "./operations";

export const commandGroups = [
  assetsGroup,
  authGroup,
  configGroup,
  catalogueGroup,
  initGroup,
  knowledgeGroup,
  namedGroup,
  operationsGroup
] as const;

export function commandNames(): string[] {
  return [...new Set(commandGroups.flatMap((group) => group.names))];
}
