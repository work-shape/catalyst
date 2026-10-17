import {
  agentTryConversationResponseSchema,
  agentDraftResponseSchema,
  discardAgentDraftRequestSchema,
  discardAgentDraftResponseSchema
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
  // Who may decide on the proposal may try it: the write right on the agent. The Build
  // conversation is the caller's own conversation about the agent; any other is answered as a
  // missing one. The Try conversation goes with an Apply, a Discard and the Build conversation.
  "agents.try.open": defineRegisteredOperation({
    id: "agents.try.open",
    method: "POST",
    path: "/api/v1/agents/:name/try/:conversationId",
    summary:
      "Open the Try conversation of an agent beside a Build conversation, made where there is none",
    tag: "Agents",
    auth: "user",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    response: json(agentTryConversationResponseSchema),
    errors: ["NOT_FOUND"],
    rateClass: "write"
  })
} as const;
