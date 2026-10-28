import {
  discardAgentDraftRequestSchema,
  discardAgentDraftResponseSchema,
  skillDraftQuerySchema,
  skillDraftResponseSchema
} from "../agent-proposals";
import { defineRegisteredOperation, json } from "./define-operation";

/**
 * The shared draft of a skill the instance or a Shared Workspace owns (SKILL-DRAFT-1), available
 * only to holders of the skill's write right. `assets.publish` makes it live with `skill.publish`.
 */
export const skillOperations = {
  "skills.draft.get": defineRegisteredOperation({
    id: "skills.draft.get",
    method: "GET",
    path: "/api/v1/skills/:name/draft",
    summary: "Read the shared skill draft and its last author; needs skill.write",
    tag: "Skills",
    auth: "user",
    scope: "config_assets:read",
    requires: [],
    effect: "reading",
    query: skillDraftQuerySchema,
    response: json(skillDraftResponseSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "skills.draft.discard": defineRegisteredOperation({
    id: "skills.draft.discard",
    method: "POST",
    path: "/api/v1/skills/:name/draft/discard",
    summary: "Discard the named shared draft revision; the live skill stays as it is",
    tag: "Skills",
    auth: "user",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    body: discardAgentDraftRequestSchema,
    response: json(discardAgentDraftResponseSchema),
    errors: ["NOT_FOUND", "REVISION_CONFLICT"],
    rateClass: "write"
  })
} as const;
