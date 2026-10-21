import {
  appActionCallRequestSchema,
  appActionCallResultSchema,
  appActionsListQuerySchema,
  appActionsSchema,
  appFromPageQuerySchema,
  appFromPageSchema,
  appPreviewRequestSchema,
  appSessionContextRequestSchema,
  appSessionContextSchema,
  appStorageWriteRequestSchema,
  appStorageWriteResponseSchema,
  appPreviewSchema,
  createAppFromPageRequestSchema,
  createAppFromPageResponseSchema,
  updateAppFromPageRequestSchema
} from "../apps";
import { appWorkflowRunSchema } from "../app-bridge";
import { defineOperation, defineRegisteredOperation, json } from "./define-operation";

/**
 * What a call of a frame declares. It runs through the call path as the operation its action
 * is (`app.<id>.<action>` in an App, `page_action.<page id>.<action>` in a Page of a
 * conversation), so every call is an Operation Run with the origin `app`. The name of that operation is read from the manifest the frame shows and
 * is not this descriptor's id, which is why these are not defined with
 * `defineRegisteredOperation`. A call that waits for an approval answers `200` with the
 * status `pending_approval`: the frame reads one shape.
 */
const FRAME_CALL = {
  method: "POST",
  tag: "Apps",
  auth: "user",
  scope: "conversation:write",
  requires: [],
  effect: "changing",
  headers: {
    request: ["Idempotency-Key"],
    response: ["Operation-Run-Id", "Idempotent-Replayed"]
  },
  response: json(appActionCallResultSchema),
  errors: [
    "NOT_FOUND",
    "CONFLICT",
    "TIMEOUT",
    "POLICY_DENIED",
    "GUARDRAIL_BLOCKED",
    "IDEMPOTENCY_KEY_REUSED",
    "OPERATION_IN_PROGRESS",
    "OPERATION_EXPIRED",
    "OUTPUT_NOT_RETAINED"
  ],
  rateClass: "write"
} as const;

// What an App has beside the operations of every asset (`assets.put`, `assets.publish`,
// `assets.discard_draft`, `assets.delete` with the kind `app`): it is made from a Page, and
// its draft is written from that Page again, and its revisions are opened by people. The rights
// are the kind's own, decided on the App's workspace, so no operation names one in `requires`.
export const appOperations = {
  "apps.create_from_page": defineRegisteredOperation({
    id: "apps.create_from_page",
    method: "POST",
    path: "/api/v1/apps",
    summary: "Save the newest revision of a Page as an App with a draft",
    tag: "Apps",
    auth: "user",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    body: createAppFromPageRequestSchema,
    response: json(createAppFromPageResponseSchema),
    errors: ["NOT_FOUND", "CONFLICT"],
    rateClass: "write"
  }),
  "apps.update_from_page": defineRegisteredOperation({
    id: "apps.update_from_page",
    method: "POST",
    path: "/api/v1/apps/:app/update-from-page",
    summary:
      "Write the newest revision of a Page as a new draft revision of the App that is updated from it",
    tag: "Apps",
    auth: "user",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    body: updateAppFromPageRequestSchema,
    response: json(createAppFromPageResponseSchema),
    errors: ["NOT_FOUND", "CONFLICT", "REVISION_CONFLICT", "VALIDATION_FAILED"],
    rateClass: "write"
  }),
  "apps.get_from_page": defineOperation({
    id: "apps.get_from_page",
    method: "GET",
    path: "/api/v1/conversations/:conversationId/pages/:pageId/app",
    summary: "Read the App a Page is updated into, where the caller may write it",
    tag: "Apps",
    auth: "user",
    scope: "conversation:read",
    requires: [],
    effect: "reading",
    query: appFromPageQuerySchema,
    response: json(appFromPageSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  // POST although it changes nothing: its answer is a credential and is never cached.
  "apps.preview": defineOperation({
    id: "apps.preview",
    method: "POST",
    path: "/api/v1/apps/:app/preview",
    summary: "Get the address a frame loads the published or the draft revision of an App from",
    tag: "Apps",
    auth: "user",
    scope: "conversation:read",
    requires: [],
    effect: "reading",
    body: appPreviewRequestSchema,
    response: json(appPreviewSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  // POST because it carries the token of the frame's address, which never stands in a path.
  "apps.sessions.context": defineOperation({
    id: "apps.sessions.context",
    method: "POST",
    path: "/api/v1/app-content-sessions/:pageSessionId/context",
    summary: "Read what each action of the Page or App a frame shows would come to for the caller",
    tag: "Apps",
    auth: "user",
    scope: "conversation:read",
    requires: [],
    effect: "reading",
    body: appSessionContextRequestSchema,
    response: json(appSessionContextSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "apps.sessions.write_storage": defineRegisteredOperation({
    id: "apps.sessions.write_storage",
    method: "POST",
    path: "/api/v1/app-content-sessions/:pageSessionId/storage",
    summary: "Update the caller's private storage in the App shown by a frame",
    tag: "Apps",
    auth: "user",
    scope: "conversation:write",
    requires: [],
    effect: "changing",
    body: appStorageWriteRequestSchema,
    response: json(appStorageWriteResponseSchema),
    errors: ["NOT_FOUND", "VALIDATION_FAILED"],
    rateClass: "write"
  }),
  // A path of its own: `actions` beside `/apps/:app` would read an App named `actions`. The
  // Named details require app.read. The unnamed chooser lists published actions through
  // app.read or app.use, decided per App where the answer is built.
  "apps.actions.list": defineRegisteredOperation({
    id: "apps.actions.list",
    method: "GET",
    path: "/api/v1/app-actions",
    summary:
      "List the actions of one App, or a cursor page of published Apps the caller reads or uses, with call previews. Follow nextCursor until absent to reach every App.",
    tag: "Apps",
    auth: "user",
    scope: "config_assets:read",
    requires: [],
    effect: "reading",
    query: appActionsListQuerySchema,
    response: json(appActionsSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "apps.sessions.call_action": defineOperation({
    ...FRAME_CALL,
    id: "apps.sessions.call_action",
    path: "/api/v1/app-content-sessions/:pageSessionId/actions/:name",
    summary: "Call a named action of the Page or App a frame shows, with the caller's rights",
    body: appActionCallRequestSchema
  }),
  // POST because it carries the token of the frame's address, which never stands in a path.
  // The run is read through `workflows.get_run` with the caller's rights, which lets whoever
  // started a run read it.
  "apps.sessions.get_workflow_run": defineOperation({
    id: "apps.sessions.get_workflow_run",
    method: "POST",
    path: "/api/v1/app-content-sessions/:pageSessionId/workflow-runs/:runId",
    summary:
      "Read the state and result of a Workflow Run that a workflow action of the Page or App a frame shows started",
    tag: "Apps",
    auth: "user",
    scope: "conversation:read",
    requires: [],
    effect: "reading",
    body: appSessionContextRequestSchema,
    response: json(appWorkflowRunSchema),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  })
} as const;
