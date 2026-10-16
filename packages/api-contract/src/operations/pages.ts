import {
  pageDetailSchema,
  pagePreviewRequestSchema,
  pagePreviewSchema,
  pageSchema,
  pageSourceFileListSchema,
  pageSourceFileQuerySchema,
  pageSourceFileSchema
} from "../pages";
import { listQuerySchema } from "../shared";
import { defineOperation, json, page } from "./define-operation";

// A Page is a resource of its conversation: who may read the conversation may read its Pages.
const pageAccess = {
  tag: "Pages",
  auth: "user",
  scope: "conversation:read",
  requires: [],
  effect: "reading",
  rateClass: "read"
} as const;

export const pageOperations = {
  "pages.list": defineOperation({
    ...pageAccess,
    id: "pages.list",
    method: "GET",
    path: "/api/v1/conversations/:conversationId/pages",
    summary: "List the Pages of a conversation",
    query: listQuerySchema,
    response: page(pageSchema, ["createdAt", "id"]),
    errors: ["NOT_FOUND"]
  }),
  "pages.get": defineOperation({
    ...pageAccess,
    id: "pages.get",
    method: "GET",
    path: "/api/v1/conversations/:conversationId/pages/:pageId",
    summary: "Read one Page with its revisions, newest first",
    response: json(pageDetailSchema),
    errors: ["NOT_FOUND"]
  }),
  "pages.files.list": defineOperation({
    ...pageAccess,
    id: "pages.files.list",
    method: "GET",
    path: "/api/v1/conversations/:conversationId/pages/:pageId/file-sets/:fileSetId/source-files",
    summary: "List the source files of a Page revision",
    response: json(pageSourceFileListSchema),
    errors: ["NOT_FOUND"]
  }),
  "pages.files.get": defineOperation({
    ...pageAccess,
    id: "pages.files.get",
    method: "GET",
    path: "/api/v1/conversations/:conversationId/pages/:pageId/file-sets/:fileSetId/source-file",
    summary: "Read one source file of a Page revision as text",
    query: pageSourceFileQuerySchema,
    response: json(pageSourceFileSchema),
    errors: ["NOT_FOUND"]
  }),
  // POST although it changes nothing: its answer is a credential and is never cached.
  "pages.preview": defineOperation({
    ...pageAccess,
    id: "pages.preview",
    method: "POST",
    path: "/api/v1/conversations/:conversationId/pages/:pageId/preview",
    summary: "Get the address a frame loads one Page revision from",
    body: pagePreviewRequestSchema,
    response: json(pagePreviewSchema),
    errors: ["NOT_FOUND"]
  })
} as const;
