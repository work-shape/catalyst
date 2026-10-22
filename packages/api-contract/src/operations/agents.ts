import {
  agentTryConversationResponseSchema,
  agentDraftResponseSchema,
  discardAgentDraftRequestSchema,
  discardAgentDraftResponseSchema,
  setAgentUseRequestSchema,
  setAgentUseResponseSchema
} from "../agent-proposals";
import { assetScopeQuerySchema } from "../assets";
import { defineRegisteredOperation, json } from "./define-operation";

/** The shared draft is available only to holders of the agent's write right. */
export const agentOperations = {
  "agents.draft.get": defineRegisteredOperation({
    id: "agents.draft.get",
    method: "GET",
    path: "/api/v1/agents/:name/draft",
    summary: "Read the shared agent draft and its last author; needs agent.write",
    tag: "Agents",
    auth: "user",
    scope: "config_assets:read",
    requires: [],
    effect: "reading",
    query: assetScopeQuerySchema,
    response: json(agentDraftResponseSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "agents.draft.discard": defineRegisteredOperation({
    id: "agents.draft.discard",
    method: "POST",
    path: "/api/v1/agents/:name/draft/discard",
    summary: "Discard the named shared draft revision; the live agent stays as it is",
    tag: "Agents",
    auth: "user",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    body: discardAgentDraftRequestSchema,
    response: json(discardAgentDraftResponseSchema),
    errors: ["NOT_FOUND", "REVISION_CONFLICT"],
    rateClass: "write"
  }),
  // Who uses the agent where it is available (AGENT-USE-1). The right is decided as for its
  // availability: the agent's write right on the whole instance.
  "agents.use.set": defineRegisteredOperation({
    id: "agents.use.set",
    method: "PUT",
    path: "/api/v1/agents/:name/use",
    summary: "Set who uses one agent where it is available: everyone, or holders of agent.use",
    tag: "Agents",
    auth: "user",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    body: setAgentUseRequestSchema,
    response: json(setAgentUseResponseSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "agents.try.open": defineRegisteredOperation({
    id: "agents.try.open",
    method: "POST",
    path: "/api/v1/agents/:name/try",
    summary: "Open the private Try conversation of this agent and person",
    tag: "Agents",
    auth: "user",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    query: assetScopeQuerySchema,
    response: json(agentTryConversationResponseSchema),
    errors: ["NOT_FOUND"],
    rateClass: "write"
  })
} as const;
