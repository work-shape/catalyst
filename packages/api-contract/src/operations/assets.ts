import {
  assetPointersResponseSchema,
  assetSchema,
  assetScopeQuerySchema,
  getAssetQuerySchema,
  assetSummarySchema,
  assetWriteResponseSchema,
  checkAssetNameRequestSchema,
  checkAssetNameResponseSchema,
  checkAssetSyncResponseSchema,
  deleteAssetRequestSchema,
  discardAssetDraftRequestSchema,
  listAssetsQuerySchema,
  publishAssetRequestSchema,
  putAssetRequestSchema,
  revertAssetRequestSchema,
  runLiveOnceRequestSchema,
  runLiveOnceResponseSchema,
  listLiveOnceQuerySchema,
  liveOnceListSchema,
  setAssetAvailabilityRequestSchema,
  setAssetDefaultRequestSchema,
  setAssetDefaultResponseSchema,
  syncAssetsRequestSchema,
  syncAssetsResponseSchema,
  validateAssetRequestSchema,
  validateAssetResponseSchema
} from "../assets";
import { agentAvailabilitySchema, configAssetRevisionSchema } from "../configuration";
import { listQuerySchema } from "../shared";
import { defineRegisteredOperation, json, page } from "./define-operation";

// Every operation here is one of the registry: a call is an Operation Run. None names its
// right in `requires`, because the right is the kind's own (`<kind>.read`, `<kind>.write`,
// `<kind>.delete`) and is decided on the asset the call names: a grant on the instance, on a
// workspace or on the asset itself can answer it. The registration brings that check.
export const assetOperations = {
  "assets.list": defineRegisteredOperation({
    id: "assets.list",
    method: "GET",
    path: "/api/v1/assets/:kind",
    summary: "List the assets of one kind the caller may read, by name",
    tag: "Assets",
    auth: "principal",
    scope: "config_assets:read",
    requires: [],
    effect: "reading",
    query: listQuerySchema.extend(listAssetsQuerySchema.shape),
    response: page(assetSummarySchema, ["name"], false),
    errors: [],
    rateClass: "read"
  }),
  "assets.sync": defineRegisteredOperation({
    id: "assets.sync",
    method: "POST",
    path: "/api/v1/assets/sync",
    summary: "Apply puts and deletes among the assets of one owner, all of them or none",
    tag: "Assets",
    auth: "principal",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    body: syncAssetsRequestSchema,
    response: json(syncAssetsResponseSchema),
    errors: ["CONFLICT", "REVISION_CONFLICT", "PRECONDITION_REQUIRED"],
    rateClass: "write"
  }),
  "assets.sync_check": defineRegisteredOperation({
    id: "assets.sync_check",
    method: "POST",
    path: "/api/v1/assets/sync/check",
    summary: "Check a batch as a sync would, without applying it",
    tag: "Assets",
    auth: "principal",
    scope: "config_assets:write",
    requires: [],
    effect: "reading",
    body: syncAssetsRequestSchema,
    response: json(checkAssetSyncResponseSchema),
    errors: ["CONFLICT", "REVISION_CONFLICT", "PRECONDITION_REQUIRED"],
    rateClass: "read"
  }),
  // Valid for a kind that keeps an instance default. The right is the kind's write right on
  // the whole instance: a grant in a workspace or on one asset does not answer it.
  "assets.set_default": defineRegisteredOperation({
    id: "assets.set_default",
    method: "POST",
    path: "/api/v1/assets/:kind/default",
    summary: "Set or clear the instance's default asset of one kind",
    tag: "Assets",
    auth: "principal",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    body: setAssetDefaultRequestSchema,
    response: json(setAssetDefaultResponseSchema),
    errors: ["CONFLICT"],
    rateClass: "write"
  }),
  "assets.validate": defineRegisteredOperation({
    id: "assets.validate",
    method: "POST",
    path: "/api/v1/assets/:kind/validate",
    summary: "Check one definition against the instance without writing it",
    tag: "Assets",
    auth: "principal",
    scope: "config_assets:read",
    requires: [],
    effect: "reading",
    body: validateAssetRequestSchema,
    response: json(validateAssetResponseSchema),
    errors: [],
    rateClass: "read"
  }),
  // The right is the kind's write right on the name, as a create asks it. The answer tells
  // no more than a refused create would: an id is unique on the instance.
  "assets.check_name": defineRegisteredOperation({
    id: "assets.check_name",
    method: "POST",
    path: "/api/v1/assets/:kind/check-name",
    summary: "Check whether a new asset could take a name, without creating it",
    tag: "Assets",
    auth: "principal",
    scope: "config_assets:write",
    requires: [],
    effect: "reading",
    body: checkAssetNameRequestSchema,
    response: json(checkAssetNameResponseSchema),
    errors: [],
    rateClass: "read"
  }),
  "assets.get": defineRegisteredOperation({
    id: "assets.get",
    method: "GET",
    path: "/api/v1/assets/:kind/:name",
    summary: "Read one asset, or one revision of it with its source files",
    tag: "Assets",
    auth: "principal",
    scope: "config_assets:read",
    requires: [],
    effect: "reading",
    query: getAssetQuerySchema,
    response: json(assetSchema),
    errors: ["NOT_FOUND", "VALIDATION_FAILED"],
    rateClass: "read"
  }),
  // A call with files that a policy holds for an approval is refused where its input is above
  // the limit of a held call, with the reason `input_too_large_to_hold`, before a file is
  // stored or built: a held call is kept whole or not at all.
  "assets.put": defineRegisteredOperation({
    id: "assets.put",
    method: "PUT",
    path: "/api/v1/assets/:kind/:name",
    // A write with files that answers `TIMEOUT` (`build_timeout`) wrote nothing. Its
    // Idempotency-Key is used up: the same write is sent again under a new key.
    summary: "Create one asset, or replace it at the revision the caller read",
    tag: "Assets",
    auth: "principal",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    body: putAssetRequestSchema,
    response: json(assetWriteResponseSchema),
    errors: ["CONFLICT", "REVISION_CONFLICT", "PRECONDITION_REQUIRED", "TIMEOUT"],
    rateClass: "write"
  }),
  // The right is `<kind>.publish`, and the credential scope is one of its own: a key that
  // holds `config_assets:write` writes drafts and publishes none of them.
  "assets.publish": defineRegisteredOperation({
    id: "assets.publish",
    method: "POST",
    path: "/api/v1/assets/:kind/:name/publish",
    summary: "Make one revision of an asset the one its users are served",
    tag: "Assets",
    auth: "principal",
    scope: "config_assets:publish",
    requires: [],
    effect: "changing",
    body: publishAssetRequestSchema,
    response: json(assetPointersResponseSchema),
    errors: ["NOT_FOUND", "VALIDATION_FAILED", "CONFLICT", "PRECONDITION_REQUIRED"],
    rateClass: "write"
  }),
  "assets.discard_draft": defineRegisteredOperation({
    id: "assets.discard_draft",
    method: "POST",
    path: "/api/v1/assets/:kind/:name/discard-draft",
    summary: "Move the draft of one asset back to its published revision",
    tag: "Assets",
    auth: "principal",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    body: discardAssetDraftRequestSchema,
    response: json(assetPointersResponseSchema),
    errors: ["NOT_FOUND", "REVISION_CONFLICT", "PRECONDITION_REQUIRED"],
    rateClass: "write"
  }),
  // ADR-0031. A changing call of a draft App or Workflow is simulated; this makes the caller's
  // own next call of one action, or that step in their next test run, live. Another member's
  // call stays simulated. Only the kinds `app` and `workflow` have one.
  "assets.run_live_once": defineRegisteredOperation({
    id: "assets.run_live_once",
    method: "POST",
    path: "/api/v1/assets/:kind/:name/run-live-once",
    summary:
      "Make your own next call of one action or step of the draft live instead of simulated, once",
    tag: "Assets",
    auth: "principal",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    body: runLiveOnceRequestSchema,
    response: json(runLiveOnceResponseSchema),
    errors: ["NOT_FOUND", "REVISION_CONFLICT", "PRECONDITION_REQUIRED", "VALIDATION_FAILED"],
    rateClass: "write"
  }),
  "assets.list_live_once": defineRegisteredOperation({
    id: "assets.list_live_once",
    method: "GET",
    path: "/api/v1/assets/:kind/:name/run-live-once",
    summary:
      "List the caller's own Run live once switches on the draft, and the test run that used each",
    tag: "Assets",
    auth: "principal",
    scope: "config_assets:read",
    requires: [],
    effect: "reading",
    query: listLiveOnceQuerySchema,
    response: json(liveOnceListSchema),
    errors: ["NOT_FOUND", "VALIDATION_FAILED"],
    rateClass: "read"
  }),
  "assets.delete": defineRegisteredOperation({
    id: "assets.delete",
    method: "POST",
    path: "/api/v1/assets/:kind/:name/delete",
    summary: "Delete one asset and keep its revisions",
    tag: "Assets",
    auth: "principal",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    body: deleteAssetRequestSchema,
    response: json(assetWriteResponseSchema),
    errors: ["NOT_FOUND", "REVISION_CONFLICT", "PRECONDITION_REQUIRED", "VALIDATION_FAILED"],
    rateClass: "write"
  }),
  // Valid for a kind that is offered per workspace. The right is decided as for the default.
  "assets.set_availability": defineRegisteredOperation({
    id: "assets.set_availability",
    method: "PUT",
    path: "/api/v1/assets/:kind/:name/availability",
    summary: "Set the workspaces one asset is offered in",
    tag: "Assets",
    auth: "principal",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    body: setAssetAvailabilityRequestSchema,
    response: json(agentAvailabilitySchema),
    errors: ["NOT_FOUND", "CONFLICT", "PRECONDITION_REQUIRED"],
    rateClass: "write"
  }),
  "assets.revisions.list": defineRegisteredOperation({
    id: "assets.revisions.list",
    method: "GET",
    path: "/api/v1/assets/:kind/:name/revisions",
    summary: "List the revisions of one asset, newest first",
    tag: "Assets",
    auth: "principal",
    scope: "config_assets:read",
    requires: [],
    effect: "reading",
    query: listQuerySchema.extend(assetScopeQuerySchema.shape),
    response: page(configAssetRevisionSchema, ["revision"], true),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  "assets.revert": defineRegisteredOperation({
    id: "assets.revert",
    method: "POST",
    path: "/api/v1/assets/:kind/:name/revert",
    summary: "Make an earlier revision the content of one asset again",
    tag: "Assets",
    auth: "principal",
    scope: "config_assets:write",
    requires: [],
    effect: "changing",
    body: revertAssetRequestSchema,
    response: json(assetWriteResponseSchema),
    errors: ["NOT_FOUND", "REVISION_CONFLICT", "PRECONDITION_REQUIRED"],
    rateClass: "write"
  })
} as const;
