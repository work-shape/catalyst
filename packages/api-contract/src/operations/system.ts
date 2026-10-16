import { listQuerySchema } from "../shared";
import { capturedMailSchema, healthSchema, notReadySchema, readySchema } from "../system";
import { blob, defineOperation, json, page, probe } from "./define-operation";

export const systemOperations = {
  "health.get": defineOperation({
    id: "health.get",
    method: "GET",
    path: "/health",
    summary: "Report that the instance answers",
    tag: "System",
    auth: "public",
    effect: "reading",
    response: json(healthSchema),
    errors: [],
    rateClass: "read"
  }),
  // What a proxy or a deploy step asks before it sends this process traffic. Providers are
  // not part of it: a model or mail outage does not take the API out of rotation.
  "ready.get": defineOperation({
    id: "ready.get",
    method: "GET",
    path: "/ready",
    summary: "Report whether the database answers and holds this release's migrations",
    tag: "System",
    auth: "public",
    effect: "reading",
    response: probe(readySchema, notReadySchema),
    errors: [],
    rateClass: "read"
  }),
  // Outside `/api`: a script address inside a sandboxed frame, called without credentials and
  // never changed under a version. APP-1 serves the App Kit from the same path family.
  "view_runtime.files.get": defineOperation({
    id: "view_runtime.files.get",
    method: "GET",
    path: "/app-runtime/view/:version/:file",
    summary: "Serve one pinned file of the runtime a generated view loads",
    tag: "System",
    auth: "public",
    effect: "reading",
    response: blob(),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  // The App Kit a Page loads: `<version>/<file>` below the prefix, one frozen directory per
  // released version. A Page's frame has no origin, so its requests carry no credentials and
  // the answer is the same for everyone. An unknown version answers `kit_unavailable`.
  "app_kit.files.get": defineOperation({
    id: "app_kit.files.get",
    method: "GET",
    path: "/app-runtime/kit/:version/*",
    summary: "Serve one file of a released App Kit version to a Page",
    tag: "System",
    auth: "public",
    effect: "reading",
    response: blob(),
    errors: ["NOT_FOUND"],
    rateClass: "read"
  }),
  // Beside the view runtime and for the same reason outside `/api`: the address of a frame.
  // It reads no credentials and answers everyone the same. A browser may still attach cookies
  // of the instance to the request. It answers a frame only.
  "view_shell.files.get": defineOperation({
    id: "view_shell.files.get",
    method: "GET",
    path: "/app-runtime/view-shell/:version/:file",
    summary: "Serve the document a generated view is framed in, or its script",
    tag: "System",
    auth: "public",
    effect: "reading",
    response: blob(),
    errors: ["FORBIDDEN", "NOT_FOUND"],
    rateClass: "read"
  }),
  // Outside `/api` like the two above: the address of a frame and of the files it loads. The
  // frame has no origin, so no request for a file carries a session; the token in the path is
  // the whole authorization of a request. The rest of the path is `<file set id>/<token>/<path
  // of the file in the file set>`. It is one wildcard and not three parts, because the token
  // is longer than the router lets a named part be and a file's path holds slashes.
  "app_content.files.get": defineOperation({
    id: "app_content.files.get",
    method: "GET",
    path: "/app-content/*",
    summary: "Serve one file of a Page revision to the frame that shows it",
    tag: "System",
    auth: "public",
    effect: "reading",
    response: blob(),
    errors: ["FORBIDDEN", "NOT_FOUND"],
    rateClass: "read"
  }),
  "captured_mail.list": defineOperation({
    id: "captured_mail.list",
    method: "GET",
    path: "/api/v1/dev/captured-mail",
    summary: "List the mails a development instance captured instead of sending",
    tag: "System",
    auth: "public",
    effect: "reading",
    query: listQuerySchema,
    response: page(capturedMailSchema, ["sentAt", "id"], true),
    errors: [],
    rateClass: "read",
    devOnly: true
  })
} as const;
