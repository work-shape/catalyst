import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Readable, Writable } from "node:stream";
import {
  TOOL_CODE_ANSWER_MAX_BYTES,
  TOOL_CODE_REQUESTS_MAX,
  TOOL_CODE_REQUEST_ANSWER_MAX_BYTES,
  TOOL_CODE_REQUEST_MAX_BYTES,
  toolCodeAnswerSchema,
  toolCodeTimeoutSeconds,
  utf8Bytes,
  type ToolCodeDisplay
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { ConfigApiError, type ConfigApi } from "./api";
import {
  filedForApproval,
  openInstance,
  writeError,
  writeOutput,
  type ConfigCommandOptions
} from "./command-support";
import { formatWarnings } from "./asset-output";
import { readConfigCliEnv, toolHandlerEnv, type ConfigCliEnv } from "./env";
import { EXIT, UsageError, ifRevision, settle } from "./asset-verbs/support";
import type { Values } from "./asset-verbs/types";
import {
  ToolFolderError,
  bundleTool,
  readToolFolder,
  writeToolLibrary,
  type ToolFolder
} from "./tool-folder";
import { toolInputIssues } from "./tool-input";

// `catalyst tool put <folder>` and `catalyst tool run <folder>` (TOOL-2d, platform-access.md,
// section 3a): a code tool written as a folder. `put` reads the folder's definition here and
// writes it as the tool's next draft; the instance never runs the code to learn it. `run` runs
// the handler on this computer as the sandbox runs it, with the same library and request
// channel. Its Connection calls go to the instance as calls of a draft, made with the person's
// key: to the test credential where the Connection has one, and simulated where a call would
// change something and it has none.

const TOOL_KIND = "tool";

/** Whether the command line is one of the commands of a tool's folder. */
export function isToolFolderCommand(noun: string, verb: string, values: Values): boolean {
  if (noun !== TOOL_KIND && noun !== `${TOOL_KIND}s`) return false;
  return verb === "run" || (verb === "put" && values.from === undefined);
}

export const TOOL_FOLDER_FLAGS = {
  put: ["instance", "dir", "json", "help", "workspace", "if-revision"],
  run: ["instance", "dir", "json", "help", "input"]
} as const;

/** `catalyst tool put <folder>` or `catalyst tool run <folder>`. */
export async function runToolFolderCommand(
  verb: "put" | "run",
  folderArgument: string,
  values: Values,
  options: ConfigCommandOptions
): Promise<number> {
  if (folderArgument === "") {
    throw new UsageError(
      verb === "put"
        ? "Usage: catalyst tool put <folder> [--if-revision <n|new>]"
        : "Usage: catalyst tool run <folder> [--input <json>]"
    );
  }
  const folder = resolve(options.cwd ?? process.cwd(), folderArgument);
  const env = readConfigCliEnv(options.env);
  try {
    return verb === "put"
      ? await putFolder(folder, values, options, env)
      : await runFolder(folder, values, options, env);
  } catch (error) {
    if (error instanceof ToolFolderError) {
      writeError(options, error.message);
      return EXIT.refused;
    }
    throw error;
  }
}

async function putFolder(
  folder: string,
  values: Values,
  options: ConfigCommandOptions,
  env: ConfigCliEnv
): Promise<number> {
  const expected =
    values["if-revision"] === undefined ? undefined : ifRevision(values["if-revision"], true);
  const tool = await readToolFolder(folder, env);
  const { name } = tool.config;
  const { api, workspace } = await openInstance(options);
  const workspaceId = values.workspace ?? workspace;
  const scope = workspaceId === undefined ? {} : { workspaceId };
  // Left out, the write replaces the revision read now: a folder is the tool's source.
  const expectedRevision =
    expected === undefined ? await latestRevision(api, name, scope) : expected;
  const outcome = await api.change(
    (client, idempotencyKey) =>
      client.assets.put({
        params: { kind: TOOL_KIND, name },
        body: { config: tool.config, expectedRevision, ...scope },
        idempotencyKey
      }),
    `It may have been written: run 'catalyst tool show ${name}' before sending it again.`
  );
  return settle({ values, options }, outcome, (output) => [
    output.approvalRequestId !== undefined
      ? filedForApproval(`tool '${name}'`, output.approvalRequestId, output.revision)
      : `Wrote tool '${name}' as revision ${output.revision} from '${folderLabel(folder, options)}'. Agents call it once it is published: 'catalyst tool publish ${name} --revision ${output.revision}'.`,
    ...formatWarnings(output.warnings)
  ]);
}

async function latestRevision(
  api: ConfigApi,
  name: string,
  scope: { workspaceId?: string }
): Promise<number | null> {
  try {
    const asset = await api.read((client) =>
      client.assets.get({ params: { kind: TOOL_KIND, name }, query: scope })
    );
    return asset.revision;
  } catch (error) {
    if (error instanceof ConfigApiError && error.status === 404) return null;
    throw error;
  }
}

function folderLabel(folder: string, options: ConfigCommandOptions): string {
  const cwd = options.cwd ?? process.cwd();
  return folder.startsWith(`${cwd}/`) ? folder.slice(cwd.length + 1) : folder;
}

/** One request of the handler, as the request channel carries it. */
const channelRequestSchema = z.object({
  connection: z.string().min(1),
  operation: z.string().min(1),
  input: z.record(z.string(), z.unknown()).optional()
});
type ChannelRequest = z.infer<typeof channelRequestSchema>;

const objectSchema = z.record(z.string(), z.unknown());

type ChannelAnswer =
  | { ok: true; output: unknown; simulated?: true }
  | { ok: false; error: { code: string; message: string } };

const refused = (code: string, message: string): ChannelAnswer => ({
  ok: false,
  error: { code, message }
});

function parseInput(text: string | undefined): Record<string, unknown> {
  if (text === undefined) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new UsageError(`--input is not JSON: ${text}`);
  }
  const parsed = objectSchema.safeParse(value);
  if (!parsed.success || Array.isArray(value)) {
    throw new UsageError("--input is a JSON object, the tool's input.");
  }
  return parsed.data;
}

async function runFolder(
  folder: string,
  values: Values,
  options: ConfigCommandOptions,
  env: ConfigCliEnv
): Promise<number> {
  const input = parseInput(values.input);
  const tool = await readToolFolder(folder, env, { bundle: false });
  const issues = toolInputIssues(tool.config.input, input);
  if (issues.length > 0) {
    writeError(
      options,
      [
        "--input does not fit the tool's input schema:",
        ...issues.map((issue) => `  ${issue}`)
      ].join("\n")
    );
    return EXIT.refused;
  }
  // The work folder holds the input, the answer, the library and the bundle. It is removed
  // however the run ends; only a display's page outlives it, in a folder of its own.
  const work = await mkdtemp(join(tmpdir(), "catalyst-tool-run-"));
  try {
    return await runInFolder({ folder, work, tool, input, values, options, env });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function runInFolder(run: {
  folder: string;
  work: string;
  tool: ToolFolder;
  input: Record<string, unknown>;
  values: Values;
  options: ConfigCommandOptions;
  env: ConfigCliEnv;
}): Promise<number> {
  const { folder, work, tool, input, values, options } = run;
  const library = join(work, "lib");
  await mkdir(library);
  await writeToolLibrary(library);
  const inputFile = join(work, "input.json");
  const outputFile = join(work, "output.json");
  await writeFile(inputFile, JSON.stringify(input));
  let command: string;
  let args: string[];
  if (tool.config.runtime === "python") {
    command = "python3";
    args = [tool.config.entry];
  } else {
    const bundle = join(work, "tool.mjs");
    await writeFile(
      bundle,
      await bundleTool({
        folder,
        source: tool.source ?? "index.ts",
        ...(tool.exportName === undefined ? {} : { exportName: tool.exportName }),
        library
      })
    );
    command = process.execPath;
    args = ["--enable-source-maps", bundle];
  }
  let instance: Promise<{ api: ConfigApi }> | undefined;
  const connect = () => (instance ??= openInstance(options));
  let simulatedCalls = 0;
  const ended = await runHandler({
    command,
    args,
    folder,
    input,
    env: {
      ...toolHandlerEnv(run.env),
      WORKFLOW_INPUT_FILE: inputFile,
      WORKFLOW_OUTPUT_FILE: outputFile,
      CATALYST_LIBRARY: library,
      CATALYST_REQUEST_FD: "3",
      CATALYST_ANSWER_FD: "4",
      PYTHONPATH: [folder, library].join(":")
    },
    timeoutSeconds: toolCodeTimeoutSeconds(tool.config),
    stderr: (text) => (options.stderr ?? process.stderr.write.bind(process.stderr))(text),
    answer: async (request) => {
      const answer = await answerRequest(tool, request, connect);
      if (answer.ok && answer.simulated) {
        simulatedCalls += 1;
        writeError(
          options,
          `Simulated connection.${request.connection}.${request.operation}: the Connection has no test credential, so nothing changed and the handler got a simulated answer.`
        );
      }
      return answer;
    }
  });
  const written = await readFile(outputFile, "utf8").catch(() => undefined);
  if (ended.timedOut) {
    writeError(
      options,
      `The handler ran longer than ${toolCodeTimeoutSeconds(tool.config)} seconds and was stopped.`
    );
    return EXIT.refused;
  }
  if (ended.code !== 0) {
    writeError(options, `The handler failed (exit ${String(ended.code)}).`);
    return EXIT.refused;
  }
  const text = written ?? ended.stdout;
  if (
    (written === undefined && ended.stdoutOverflow) ||
    utf8Bytes(text) > TOOL_CODE_ANSWER_MAX_BYTES
  ) {
    writeError(
      options,
      `The handler answered more than ${TOOL_CODE_ANSWER_MAX_BYTES} bytes; the sandbox takes at most that.`
    );
    return EXIT.refused;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    writeError(options, "The handler answered no JSON object: it writes { output, display? }.");
    return EXIT.refused;
  }
  const parsed = toolCodeAnswerSchema.safeParse(raw);
  if (!parsed.success) {
    writeError(
      options,
      [
        "The handler's answer is not one the sandbox takes:",
        ...parsed.error.issues.map(
          (issue) =>
            `  ${issue.path.length > 0 ? issue.path.join(".") : "answer"}: ${issue.message}`
        )
      ].join("\n")
    );
    return EXIT.refused;
  }
  const answer = parsed.data;
  if (values.json) writeOutput(options, JSON.stringify({ ...answer, simulatedCalls }, null, 2));
  else writeOutput(options, JSON.stringify(answer.output ?? null, null, 2));
  if (answer.display !== undefined) {
    const page = join(await mkdtemp(join(tmpdir(), "catalyst-tool-display-")), "display.html");
    await writeFile(page, displayPage(answer.display));
    writeError(options, `The handler showed a display: open ${page} in a browser.`);
  }
  return EXIT.done;
}

/** Carries one request out: to the instance where the tool declares the operation. */
async function answerRequest(
  tool: ToolFolder,
  request: ChannelRequest,
  connect: () => Promise<{ api: ConfigApi }>
): Promise<ChannelAnswer> {
  const name = `connection.${request.connection}.${request.operation}`;
  if (!(tool.config.connections ?? []).includes(name)) {
    return refused(
      "connection_not_declared",
      `The tool does not declare '${name}' in its connections, so its handler may not call it.`
    );
  }
  try {
    const { api } = await connect();
    const input = request.input ?? {};
    const result = await api.change(
      (client, idempotencyKey) =>
        client.connections.try_call({
          params: { name: request.connection, operation: request.operation },
          body: { input },
          idempotencyKey
        }),
      "The Connection call has no answer."
    );
    if (result.status !== "done") {
      return refused(
        "approval_required",
        `The call waits for a decision (run ${result.run.id}); a local run does not wait for it.`
      );
    }
    return {
      ok: true,
      output: result.output.output ?? null,
      ...(result.output.target === "dry_run" ? { simulated: true as const } : {})
    };
  } catch (error) {
    return error instanceof ConfigApiError
      ? refused((error.code ?? "failed").toLowerCase(), error.message)
      : refused("failed", error instanceof Error ? error.message : String(error));
  }
}

/**
 * Answers one line of the request channel within the sandbox's bounds: at most
 * `TOOL_CODE_REQUESTS_MAX` requests, each at most `TOOL_CODE_REQUEST_MAX_BYTES`, each answer
 * at most `TOOL_CODE_REQUEST_ANSWER_MAX_BYTES`.
 */
async function answerLine(
  line: string,
  seq: number,
  answer: (request: ChannelRequest) => Promise<ChannelAnswer>
): Promise<ChannelAnswer> {
  if (seq > TOOL_CODE_REQUESTS_MAX) {
    return refused(
      "too_many_requests",
      `A handler makes at most ${TOOL_CODE_REQUESTS_MAX} Connection calls in one call of its tool.`
    );
  }
  if (utf8Bytes(line) > TOOL_CODE_REQUEST_MAX_BYTES) {
    return refused(
      "request_too_large",
      `A request is at most ${TOOL_CODE_REQUEST_MAX_BYTES} bytes as one line of JSON.`
    );
  }
  let request: ChannelRequest | undefined;
  try {
    const parsed = channelRequestSchema.safeParse(JSON.parse(line));
    request = parsed.success ? parsed.data : undefined;
  } catch {
    request = undefined;
  }
  if (!request) {
    return refused(
      "request_invalid",
      'A request is one line of JSON: { "connection": ..., "operation": ..., "input": ... }.'
    );
  }
  const answered = await answer(request);
  const bytes = utf8Bytes(JSON.stringify(answered));
  return bytes <= TOOL_CODE_REQUEST_ANSWER_MAX_BYTES
    ? answered
    : refused(
        "answer_too_large",
        `The answer has ${bytes} bytes as JSON; a handler is handed at most ${TOOL_CODE_REQUEST_ANSWER_MAX_BYTES}.`
      );
}

/** Runs the handler with the request channel on descriptors 3 and 4, as the sandbox does. */
function runHandler(input: {
  command: string;
  args: string[];
  folder: string;
  input: Record<string, unknown>;
  env: Record<string, string>;
  timeoutSeconds: number;
  stderr: (text: string) => void;
  answer: (request: ChannelRequest) => Promise<ChannelAnswer>;
}): Promise<{ code: number | null; stdout: string; stdoutOverflow: boolean; timedOut: boolean }> {
  return new Promise((done, failed) => {
    const child = spawn(input.command, input.args, {
      cwd: input.folder,
      env: input.env,
      stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stdoutOverflow = false;
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      // An answer past the bound is refused anyway; what is past it is not kept.
      if (stdoutOverflow) return;
      stdout += chunk;
      if (stdout.length > TOOL_CODE_ANSWER_MAX_BYTES) {
        stdoutOverflow = true;
        stdout = "";
      }
    });
    child.stderr.setEncoding("utf8").on("data", input.stderr);
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify(input.input));
    const [, , , requests, answers] = child.stdio;
    if (!(requests instanceof Readable) || !(answers instanceof Writable)) {
      child.kill("SIGKILL");
      failed(new ToolFolderError("Could not open the handler's request channel."));
      return;
    }
    answers.on("error", () => undefined);
    // Requests are answered one after another, in order: the handler waits for each answer.
    let queue = Promise.resolve();
    let made = 0;
    createInterface({ input: requests }).on("line", (line) => {
      made += 1;
      const seq = made;
      queue = queue.then(async () => {
        const answer = await answerLine(line, seq, input.answer);
        if (!answers.destroyed) answers.write(`${JSON.stringify(answer)}\n`);
      });
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, input.timeoutSeconds * 1000);
    child.on("error", (error) => {
      clearTimeout(timer);
      failed(
        new ToolFolderError(`Could not start '${input.command}': ${error.message}.`, {
          cause: error
        })
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, stdout, stdoutOverflow, timedOut });
    });
  });
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/gu,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char
  );

// What the chat's frame allows a display, said again for a page opened from a file: nothing
// from any host, no form, no other address for its frame.
const CLOSED_DIRECTIVES = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
];

const policyTag = (scriptSrc: string) =>
  `<meta http-equiv="Content-Security-Policy" content="${[...CLOSED_DIRECTIVES, `script-src ${scriptSrc}`].join("; ")}">`;

/**
 * A page of what the handler showed. An HTML display runs in a frame without an origin, as
 * the chat shows it, under a policy that lets it reach no host; the frame's document inherits
 * that policy. A data display is shown as its kind and data, since its widget lives in the
 * instance.
 */
function displayPage(display: ToolCodeDisplay): string {
  const title = display.title ?? "Display";
  const head = (scriptSrc: string) =>
    [
      "<!doctype html>",
      "<html><head>",
      policyTag(scriptSrc),
      '<meta charset="utf-8">',
      `<title>${escapeHtml(title)}</title>`,
      "</head>"
    ].join("\n");
  if (display.type === "html") {
    return [
      head("'unsafe-inline' 'unsafe-eval'"),
      '<body style="margin:0">',
      `<iframe sandbox="allow-scripts" title="${escapeHtml(title)}" style="border:0;width:100vw;height:100vh" srcdoc="${escapeHtml(display.html)}"></iframe>`,
      "</body></html>",
      ""
    ].join("\n");
  }
  return [
    head("'none'"),
    '<body style="font-family:system-ui,sans-serif;margin:2rem">',
    `<h1>${escapeHtml(title)}</h1>`,
    `<p>A data display of kind <code>${escapeHtml(display.kind)}</code>. The chat shows it with the widget registered for that kind.</p>`,
    `<pre>${escapeHtml(JSON.stringify(display.data, null, 2))}</pre>`,
    "</body></html>",
    ""
  ].join("\n");
}
