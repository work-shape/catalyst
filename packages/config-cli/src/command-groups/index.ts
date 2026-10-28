import { doctorGroup } from "../doctor";
import { assetsGroup } from "./assets";
import { authGroup } from "./auth";
import { configGroup } from "./config";
import { dataStoreReviewGroup } from "./data-store-review";
import { catalogueGroup } from "./catalogue";
import { initGroup } from "./init";
import { knowledgeGroup } from "./knowledge";
import { modelsGroup } from "./models";
import { namedGroup } from "./named";
import { operationsGroup } from "./operations";

export const commandGroups = [
  assetsGroup,
  authGroup,
  doctorGroup,
  configGroup,
  catalogueGroup,
  dataStoreReviewGroup,
  initGroup,
  knowledgeGroup,
  modelsGroup,
  namedGroup,
  operationsGroup
] as const;

export function commandNames(): string[] {
  return [...new Set(commandGroups.flatMap((group) => group.names))];
}
