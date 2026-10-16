import { listQuerySchema } from "../shared";
import {
  administeredCollaborationWorkspaceSchema,
  configAssetsOverviewSchema
} from "../configuration";
import { defineOperation, json, page } from "./define-operation";

// What is read of the instance's agents and skills as a whole. Every write of an asset, its
// content, its default and its audience, is one of the asset operations.
export const configAssetOperations = {
  "config_assets.get_overview": defineOperation({
    id: "config_assets.get_overview",
    method: "GET",
    path: "/api/v1/instance/config/assets",
    summary: "List agents and skills with their revisions",
    tag: "Config Assets",
    auth: "principal",
    scope: "config_assets:read",
    requires: ["agent.read", "skill.read"],
    effect: "reading",
    response: json(configAssetsOverviewSchema),
    errors: [],
    rateClass: "read"
  }),
  "instance.workspaces.list": defineOperation({
    id: "instance.workspaces.list",
    method: "GET",
    path: "/api/v1/instance/workspaces",
    summary: "List the Shared Workspaces an agent can be made available in",
    tag: "Config Assets",
    auth: "principal",
    scope: "config_assets:write",
    requires: ["agent.write"],
    effect: "reading",
    query: listQuerySchema,
    response: page(administeredCollaborationWorkspaceSchema, ["createdAt", "id"], false),
    errors: [],
    rateClass: "read"
  })
} as const;
