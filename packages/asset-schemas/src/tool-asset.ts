import { z } from "zod";
import { CONNECTION_NAME_PATTERN } from "./contract-values";
import { localizedStringSchema } from "./schemas";

// A tool an instance adds without a release (TOOL-1, platform-access.md, section 3a): an asset
// of kind `tool`. Its operation is `tool.<name>.call`. It has two types:
// - `result` holds no code. It checks the agent's input against a declared JSON Schema and
//   writes it as the conversation's structured result of one display kind.
// - `code` holds a handler in Python or JavaScript among its files, which a call runs in the
//   sandbox of Workflow code steps (TOOL-2b). Its `connections` names the Connection operations
//   the handler may call through the platform (TOOL-2c).

/** The kind's id, as the asset store keeps it. */
export const TOOL_ASSET_KIND = "tool";

/** The prefix of every operation of one tool asset: `tool.<name>.call`. */
export const TOOL_OPERATION_PREFIX = "tool.";

/** The name of a tool: lowercase letters, digits and `_`, starting with a letter. */
export const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/u;
export const TOOL_NAME_MAX_LENGTH = 48;
export const TOOL_NAME_RULE =
  "A tool's name is lowercase letters, digits and _, starts with a letter and is at most 48 characters long";

/** A display kind: lowercase words joined by `.`, `_` or `-`, such as `review.document_check`. */
export const TOOL_RESULT_KIND_PATTERN = /^[a-z][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)*$/u;

/** How long the agent's description of a tool is at most. */
export const TOOL_DESCRIPTION_MAX_CHARS = 4_000;

/** How large a tool's input schema is at most, as JSON, in bytes. */
export const TOOL_INPUT_SCHEMA_MAX_BYTES = 32 * 1024;

/** How deeply a tool's input schema nests at most, counting objects and arrays. */
export const TOOL_INPUT_SCHEMA_MAX_DEPTH = 24;

/** What a call of a `result` tool answers the agent where the tool names no sentence. */
export const TOOL_RESULT_DEFAULT_REPLY = "Done.";

/**
 * The types of tool. `result` hands the agent's finished result to the panel; `code` runs a
 * handler of its own files in the sandbox.
 */
export const TOOL_TYPES = ["result", "code"] as const;

/** What a code tool's handler is run with: the runner image's `python3` or `node`. */
export const TOOL_CODE_RUNTIMES = ["python", "node"] as const;
export type ToolCodeRuntime = (typeof TOOL_CODE_RUNTIMES)[number];

/** The endings of a handler file of each runtime. */
export const TOOL_CODE_ENTRY_ENDINGS: Readonly<Record<ToolCodeRuntime, readonly string[]>> = {
  python: [".py"],
  node: [".js", ".mjs"]
};

/** How long a handler may run where its tool names no time, and at most, in seconds. */
export const TOOL_CODE_TIMEOUT_DEFAULT_SECONDS = 30;
export const TOOL_CODE_TIMEOUT_MAX_SECONDS = 120;

/**
 * How many files a code tool holds at most, how large one is and how large all are. A
 * TypeScript tool is one bundled module that carries Zod, about 330 KiB minified, so one file
 * may be as large as all of them.
 */
export const TOOL_FILES_MAX = 32;
export const TOOL_FILE_MAX_BYTES = 1024 * 1024;
export const TOOL_FILES_MAX_BYTES = 1024 * 1024;

/**
 * A path in a code tool's folder: `/`-separated parts of letters, digits, `_`, `-` and `.`,
 * each starting with a letter, a digit or `_`. No part is `..`, none is hidden and none is
 * empty, so a path never leaves the folder.
 */
export const TOOL_FILE_PATH_PATTERN =
  /^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_][A-Za-z0-9_.-]*$/u;
const TOOL_FILE_PATH_RULE =
  "A file path is '/'-separated parts of letters, digits, '_', '-' and '.', none of them hidden";

/** How many Connection operations one code tool declares at most. */
export const TOOL_CONNECTIONS_MAX = 32;

/**
 * A Connection operation a code tool declares, `connection.<name>.<operation>`: the Connection's
 * name and the operation's, as `parseConnectionOperationName` reads them.
 */
const TOOL_CONNECTION_OPERATION_PATTERN = new RegExp(
  `^connection\\.${CONNECTION_NAME_PATTERN.source.slice(1, -1)}\\.[A-Za-z][A-Za-z0-9_-]*$`,
  "u"
);
const TOOL_CONNECTION_OPERATION_RULE =
  "A declared Connection operation is named connection.<connection>.<operation>";

export const toolConnectionOperationSchema = z
  .string()
  .max(200, TOOL_CONNECTION_OPERATION_RULE)
  .regex(TOOL_CONNECTION_OPERATION_PATTERN, TOOL_CONNECTION_OPERATION_RULE);

export const toolNameSchema = z
  .string()
  .max(TOOL_NAME_MAX_LENGTH, TOOL_NAME_RULE)
  .regex(TOOL_NAME_PATTERN, TOOL_NAME_RULE);

function depthOf(value: unknown): number {
  let deepest = 0;
  const open: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  for (let next = open.pop(); next; next = open.pop()) {
    if (typeof next.value !== "object" || next.value === null) continue;
    const depth = next.depth + 1;
    if (depth > deepest) deepest = depth;
    if (depth > TOOL_INPUT_SCHEMA_MAX_DEPTH) return depth;
    for (const item of Object.values(next.value)) open.push({ value: item, depth });
  }
  return deepest;
}

/**
 * A tool's input schema: a JSON Schema of an object, bounded in size and depth. Whether it
 * compiles is asked where the kind is checked, in the platform's schema checker.
 */
export const toolInputSchemaSchema = z
  .record(z.string(), z.unknown())
  .superRefine((schema, context) => {
    if (schema.type !== "object") {
      context.addIssue({
        code: "custom",
        message: 'The input schema must describe an object: give it `type: "object"`'
      });
    }
    const bytes = new TextEncoder().encode(JSON.stringify(schema)).byteLength;
    if (bytes > TOOL_INPUT_SCHEMA_MAX_BYTES) {
      context.addIssue({
        code: "custom",
        message: `The input schema is ${bytes} bytes as JSON; it may be at most ${TOOL_INPUT_SCHEMA_MAX_BYTES}`
      });
    }
    if (depthOf(schema) > TOOL_INPUT_SCHEMA_MAX_DEPTH) {
      context.addIssue({
        code: "custom",
        message: `The input schema nests deeper than ${TOOL_INPUT_SCHEMA_MAX_DEPTH} levels`
      });
    }
  });

export const toolResultSchema = z
  .object({
    /** The display kind the panel draws the result with. */
    kind: z
      .string()
      .max(120)
      .regex(
        TOOL_RESULT_KIND_PATTERN,
        "A result kind is lowercase words joined by '.', '_' or '-', such as review.document_check"
      ),
    /** The resource a new call replaces in its conversation. The tool's name where left out. */
    key: z
      .string()
      .max(80)
      .regex(/^[a-z][a-z0-9_-]*$/u, "A result key is lowercase letters, digits, _ and -")
      .optional(),
    /** The panel's heading. */
    title: z.string().trim().min(1).max(120),
    schemaVersion: z.number().int().min(1).max(1_000).optional(),
    /** The sentence the agent is answered with. */
    reply: z.string().trim().min(1).max(500).optional()
  })
  .strict();

/** What both types share. */
const toolFields = {
  name: toolNameSchema,
  /** What people read: the agent page and Studio. */
  title: localizedStringSchema,
  summary: localizedStringSchema.optional(),
  /** What the agent reads: when to call it and what it hands over. */
  description: z.string().trim().min(1).max(TOOL_DESCRIPTION_MAX_CHARS),
  icon: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/u)
    .max(40)
    .optional(),
  input: toolInputSchemaSchema
};

export const toolFilePathSchema = z
  .string()
  .max(200, "A file path is at most 200 characters long")
  .regex(TOOL_FILE_PATH_PATTERN, TOOL_FILE_PATH_RULE);

/** One file of a code tool's folder, as text. */
export const toolFileSchema = z
  .object({
    path: toolFilePathSchema,
    // Source text: a NUL byte is no text a database column keeps.
    content: z.string().refine((text) => !text.includes("\u0000"), "A file is text without NUL")
  })
  .strict();

const resultToolSchema = z
  .object({ ...toolFields, type: z.literal("result"), result: toolResultSchema })
  .strict();

const codeToolSchema = z
  .object({
    ...toolFields,
    type: z.literal("code"),
    runtime: z.enum(TOOL_CODE_RUNTIMES),
    /** The handler: the path of one of `files`. */
    entry: toolFilePathSchema,
    timeoutSeconds: z.number().int().min(1).max(TOOL_CODE_TIMEOUT_MAX_SECONDS).optional(),
    /**
     * The Connection operations the handler may call, each `connection.<name>.<operation>`. A
     * call of any other is refused with `connection_not_declared`. Each must be an operation of
     * a Connection when the tool is written.
     */
    connections: z.array(toolConnectionOperationSchema).max(TOOL_CONNECTIONS_MAX).optional(),
    /** The folder of the tool: the handler and whatever it reads or imports. */
    files: z.array(toolFileSchema).min(1).max(TOOL_FILES_MAX)
  })
  .strict()
  .superRefine((tool, context) => {
    const endings = TOOL_CODE_ENTRY_ENDINGS[tool.runtime];
    if (!endings.some((ending) => tool.entry.endsWith(ending))) {
      context.addIssue({
        code: "custom",
        path: ["entry"],
        message: `A ${tool.runtime} handler is a file ending in ${endings.map((e) => `'${e}'`).join(" or ")}`
      });
    }
    if (!tool.files.some((file) => file.path === tool.entry)) {
      context.addIssue({
        code: "custom",
        path: ["entry"],
        message: `The files hold no '${tool.entry}': the handler must be among them`
      });
    }
    const declared = new Set<string>();
    tool.connections?.forEach((name, at) => {
      if (declared.has(name)) {
        context.addIssue({
          code: "custom",
          path: ["connections", at],
          message: `'${name}' is declared twice`
        });
      }
      declared.add(name);
    });
    let total = 0;
    const seen = new Set<string>();
    tool.files.forEach((file, at) => {
      const bytes = new TextEncoder().encode(file.content).byteLength;
      total += bytes;
      if (bytes > TOOL_FILE_MAX_BYTES) {
        context.addIssue({
          code: "custom",
          path: ["files", at, "content"],
          message: `'${file.path}' has ${bytes} bytes; a file of a tool has at most ${TOOL_FILE_MAX_BYTES}`
        });
      }
      // Two paths that differ only in case, or a file where another has a folder, are one
      // place on some disks.
      const key = file.path.toLowerCase();
      if (
        seen.has(key) ||
        [...seen].some((other) => key.startsWith(`${other}/`) || other.startsWith(`${key}/`))
      ) {
        context.addIssue({
          code: "custom",
          path: ["files", at, "path"],
          message: `'${file.path}' is held twice, or as a file and a folder`
        });
      }
      seen.add(key);
    });
    if (total > TOOL_FILES_MAX_BYTES) {
      context.addIssue({
        code: "custom",
        path: ["files"],
        message: `The files have ${total} bytes together; a tool's files have at most ${TOOL_FILES_MAX_BYTES}`
      });
    }
  });

export const toolAssetConfigSchema = z.discriminatedUnion("type", [
  resultToolSchema,
  codeToolSchema
]);

export type ToolAssetConfig = z.infer<typeof toolAssetConfigSchema>;
export type ResultToolConfig = Extract<ToolAssetConfig, { type: "result" }>;
export type CodeToolConfig = Extract<ToolAssetConfig, { type: "code" }>;

/** How long a call of a code tool may run, in seconds. */
export function toolCodeTimeoutSeconds(tool: Pick<CodeToolConfig, "timeoutSeconds">): number {
  return tool.timeoutSeconds ?? TOOL_CODE_TIMEOUT_DEFAULT_SECONDS;
}

/** The operation a published tool contributes. */
export function toolCallOperationName(tool: string): string {
  return `${TOOL_OPERATION_PREFIX}${tool}.call`;
}

/** The tool a name `tool.<name>.call` names, or nothing for any other name. */
export function toolOfOperationName(name: string): string | undefined {
  if (!name.startsWith(TOOL_OPERATION_PREFIX) || !name.endsWith(".call")) return undefined;
  const tool = name.slice(TOOL_OPERATION_PREFIX.length, -".call".length);
  return tool.length <= TOOL_NAME_MAX_LENGTH && TOOL_NAME_PATTERN.test(tool) ? tool : undefined;
}
