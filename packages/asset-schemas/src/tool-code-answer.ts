import { z } from "zod";
import { TOOL_RESULT_KIND_PATTERN } from "./tool-asset";

// What a code tool's handler may answer and ask (TOOL-2b, TOOL-2c, platform-access.md, section
// 3a). The command worker checks a call in the sandbox against these, and `catalyst tool run`
// checks a local run against the same, so a handler that runs locally runs on the instance.

/** How large a handler's answer may be, as JSON in UTF-8: what it hands the model and a display. */
export const TOOL_CODE_ANSWER_MAX_BYTES = 512 * 1024;
/** How large what the model is handed of an answer may be, as JSON in UTF-8. */
export const TOOL_CODE_OUTPUT_MAX_BYTES = 64 * 1024;
/** How long a display's HTML may be: what `show_view` takes. */
export const TOOL_CODE_HTML_MAX_CHARS = 200_000;
/** How many Connection calls one handler makes at most. A further one is refused. */
export const TOOL_CODE_REQUESTS_MAX = 50;
/** How large one request of a handler is at most, as one line of JSON in UTF-8. */
export const TOOL_CODE_REQUEST_MAX_BYTES = 256 * 1024;
/** How large the answer to one request is at most, as JSON in UTF-8. */
export const TOOL_CODE_REQUEST_ANSWER_MAX_BYTES = 1024 * 1024;

/** The length of a text in UTF-8, in bytes, in Node and in a browser. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

const dataDisplaySchema = z.strictObject({
  type: z.literal("data"),
  kind: z
    .string()
    .max(120)
    .regex(
      TOOL_RESULT_KIND_PATTERN,
      "A display kind is lowercase words joined by '.', '_' or '-', such as review.document_check"
    ),
  title: z.string().trim().min(1).max(120),
  data: z.record(z.string(), z.unknown()),
  schemaVersion: z.number().int().min(1).max(1_000).optional()
});

const htmlDisplaySchema = z.strictObject({
  type: z.literal("html"),
  title: z.string().trim().min(1).max(160).optional(),
  html: z.string().min(1).max(TOOL_CODE_HTML_MAX_CHARS)
});

/** What a handler shows beside the chat: data of a display kind, or its own HTML. */
export const toolCodeDisplaySchema = z.discriminatedUnion("type", [
  dataDisplaySchema,
  htmlDisplaySchema
]);
export type ToolCodeDisplay = z.infer<typeof toolCodeDisplaySchema>;

/** What a handler answers: `output` for the model, and at most one display beside the chat. */
export const toolCodeAnswerSchema = z
  .strictObject({
    output: z.unknown(),
    display: toolCodeDisplaySchema.optional()
  })
  .superRefine((answer, context) => {
    if (answer.output === undefined) {
      context.addIssue({ code: "custom", path: ["output"], message: "The answer has no output" });
      return;
    }
    const bytes = utf8Bytes(JSON.stringify(answer.output));
    if (bytes > TOOL_CODE_OUTPUT_MAX_BYTES) {
      context.addIssue({
        code: "custom",
        path: ["output"],
        message: `The output has ${bytes} bytes as JSON; a tool hands the model at most ${TOOL_CODE_OUTPUT_MAX_BYTES}`
      });
    }
  });
