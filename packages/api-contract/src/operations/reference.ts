import { openApiDocumentSchema } from "../openapi-document";
import { blob, defineOperation, json } from "./define-operation";

// Any signed-in person and any key may read what the instance offers: `scope` is null.
export const referenceOperations = {
  "openapi.get": defineOperation({
    id: "openapi.get",
    method: "GET",
    path: "/api/v1/openapi.json",
    summary: "Read the OpenAPI document of the operations this instance runs",
    tag: "Reference",
    auth: "principal",
    scope: null,
    requires: [],
    effect: "reading",
    response: json(openApiDocumentSchema),
    errors: [],
    rateClass: "read"
  }),
  "docs.get": defineOperation({
    id: "docs.get",
    method: "GET",
    path: "/api/v1/docs",
    summary: "Read the API reference of this instance as a page",
    tag: "Reference",
    auth: "principal",
    scope: null,
    requires: [],
    effect: "reading",
    response: blob("text/html"),
    errors: [],
    rateClass: "read"
  })
} as const;
