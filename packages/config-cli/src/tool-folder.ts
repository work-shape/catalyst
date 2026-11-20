import { spawn } from "node:child_process";
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import {
  TOOL_CODE_LIBRARY,
  loadYamlData,
  toolAssetConfigSchema,
  type CodeToolConfig
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { toolHandlerEnv, type ConfigCliEnv } from "./env";

// A code tool as a folder (TOOL-2d, platform-access.md, section 3a): `tool.yaml` beside a
// handler, `main.py` with one `@tool` function or `index.ts` that exports one `defineTool`.
// The CLI reads the handler's own name, description and input schema here, by running it on
// this computer: the instance never runs a tool's code to learn its schema. A TypeScript
// handler is bundled with esbuild into one ES module that runs on the runner image's `node`.

/** The file of a tool's folder that holds what the handler does not say. */
const TOOL_FILE = "tool.yaml";
/** The handler of a Python tool. */
const PYTHON_ENTRY = "main.py";
/** The handlers of a TypeScript tool, the first one found. */
const NODE_ENTRIES = ["index.ts", "index.mts", "index.js", "index.mjs"];
/** The module a TypeScript tool is sent as, and runs from. */
const NODE_BUNDLE = "tool.mjs";
/** Folders a Python tool's files leave out, beside every hidden one. */
const LEFT_OUT_FOLDERS = new Set(["node_modules", "__pycache__"]);
/** The library's Node SDK, a bare import the sandbox resolves. */
const SDK_MODULE = "catalyst-tools";
/** How long reading a handler's schema may take. */
const DESCRIBE_TIMEOUT_MS = 30_000;

const toolFileSchema = z
  .object({
    name: z.string().optional(),
    title: z.unknown().optional(),
    summary: z.unknown().optional(),
    description: z.string().optional(),
    icon: z.string().optional(),
    /** `connection.<name>.<operation>`, or `<name>.<operation>`. */
    connections: z.array(z.string()).optional(),
    /** Seconds. */
    timeout: z.number().int().optional()
  })
  .strict();

/** What a handler says of itself. Its fields win over `tool.yaml`. */
interface Described {
  name?: string;
  /** A Python handler's function, whose name the tool takes where nothing else names it. */
  function?: string;
  title?: unknown;
  description?: string;
  input: Record<string, unknown>;
}

/** A tool's folder as one write sends it, and what a local run needs beside it. */
export interface ToolFolder {
  folder: string;
  config: CodeToolConfig;
  /** For a TypeScript tool: the export that holds the tool. */
  exportName?: string;
  /** For a TypeScript tool: the handler file the bundle starts from. */
  source?: string;
}

/** A tool's folder this CLI cannot read. Nothing was sent. */
export class ToolFolderError extends Error {}

const exists = (path: string) =>
  lstat(path).then(
    (found) => found.isFile(),
    () => false
  );

/** The library modules written into a directory, as the sandbox puts them beside a handler. */
export async function writeToolLibrary(directory: string): Promise<void> {
  for (const file of TOOL_CODE_LIBRARY) await writeFile(join(directory, file.path), file.content);
}

/** `Find contact` for `find_contact`. */
function titleOf(name: string): string {
  const words = name.replaceAll("_", " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function declared(connection: string): string {
  return connection.startsWith("connection.") ? connection : `connection.${connection}`;
}

async function readToolFile(folder: string): Promise<z.infer<typeof toolFileSchema>> {
  const path = join(folder, TOOL_FILE);
  if (!(await exists(path))) {
    throw new ToolFolderError(
      `'${folder}' holds no ${TOOL_FILE}. A code tool's folder holds ${TOOL_FILE} beside main.py or index.ts.`
    );
  }
  const parsed = toolFileSchema.safeParse(loadYamlData(await readFile(path, "utf8"), TOOL_FILE));
  if (!parsed.success) {
    throw new ToolFolderError(
      `${TOOL_FILE} is not what a tool's file holds:\n${parsed.error.issues
        .map((issue) => `- ${issue.path.join(".") || "(file)"}: ${issue.message}`)
        .join(
          "\n"
        )}\nIt names name, title, summary, icon, description, connections and timeout (seconds).`
    );
  }
  return parsed.data;
}

/** Runs a command and answers what it printed, or throws what it wrote to its error stream. */
function capture(
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string> }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (out += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (err += chunk));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, DESCRIBE_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new ToolFolderError(
          `Could not start '${command}': ${error.message}. A Python tool is read with python3.`
        )
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new ToolFolderError(
            `Reading the tool's handler took longer than ${String(DESCRIBE_TIMEOUT_MS / 1000)} seconds and was stopped.`
          )
        );
      } else if (code === 0) resolve(out);
      else reject(new ToolFolderError(err.trim() || `'${command}' ended with ${String(code)}.`));
    });
  });
}

async function describePython(folder: string, env: ConfigCliEnv): Promise<Described> {
  const library = await mkdtemp(join(tmpdir(), "catalyst-tool-library-"));
  try {
    await writeToolLibrary(library);
    const out = await capture(
      "python3",
      ["-m", "catalyst_tools", "describe", join(folder, PYTHON_ENTRY)],
      {
        cwd: folder,
        env: { ...toolHandlerEnv(env), PYTHONPATH: [folder, library].join(":") }
      }
    );
    return z
      .object({
        name: z.string().optional(),
        function: z.string(),
        description: z.string().optional(),
        input: z.record(z.string(), z.unknown())
      })
      .parse(JSON.parse(out));
  } finally {
    await rm(library, { recursive: true, force: true });
  }
}

const esbuildFailureSchema = z.looseObject({
  errors: z.array(
    z.looseObject({
      text: z.string(),
      location: z.looseObject({ file: z.string(), line: z.number() }).nullish()
    })
  )
});

/** What esbuild reported, one line each, and what to do where the SDK is not installed. */
function bundleError(error: unknown, entry: string): ToolFolderError {
  const parsed = esbuildFailureSchema.safeParse(error);
  const reported = parsed.success ? parsed.data.errors : [];
  const lines = reported.map((item) =>
    item.location ? `${item.location.file}:${String(item.location.line)}: ${item.text}` : item.text
  );
  const missing = reported.some((item) =>
    /Could not resolve "(?:zod|@work-shape\/)/u.test(item.text)
  );
  return new ToolFolderError(
    [
      `Could not bundle ${entry}:`,
      ...(lines.length > 0 ? lines : [error instanceof Error ? error.message : String(error)]),
      ...(missing
        ? ["Install the SDK in the tool's folder: npm install @work-shape/catalyst-tool-sdk zod"]
        : [])
    ].join("\n")
  );
}

/**
 * The tool's TypeScript bundled into one ES module. `serve`: the module answers the call when it
 * runs, through the library's `catalyst-tools`, which stays a bare import the sandbox resolves,
 * or which `library` names a directory of for a local run.
 */
export async function bundleTool(input: {
  folder: string;
  source: string;
  exportName?: string;
  library?: string;
  minify?: boolean;
}): Promise<string> {
  const esbuild = await import("esbuild");
  const entry = `./${input.source}`;
  const contents =
    input.exportName === undefined
      ? `export * from ${JSON.stringify(entry)};\nexport { default } from ${JSON.stringify(entry)};\n`
      : [
          input.exportName === "default"
            ? `import tool from ${JSON.stringify(entry)};`
            : `import { ${input.exportName} as tool } from ${JSON.stringify(entry)};`,
          `import { serve } from ${JSON.stringify(SDK_MODULE)};`,
          "await serve(tool);",
          ""
        ].join("\n");
  const { library } = input;
  try {
    const built = await esbuild.build({
      stdin: { contents, resolveDir: input.folder, sourcefile: "catalyst-tool-entry.mjs" },
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      // A tool written inside the workspace reaches the SDK's source, as the workspace's own
      // packages do; a package from npm has no such condition and is read as published.
      conditions: ["development"],
      write: false,
      logLevel: "silent",
      minify: input.minify ?? false,
      keepNames: true,
      legalComments: "none",
      ...(input.minify ? {} : { sourcemap: "inline" as const }),
      banner: {
        js: `// ${input.source} of a Catalyst code tool, bundled by the CLI. Change the tool's folder, not this file.`
      },
      plugins: [
        {
          name: "catalyst-tool-library",
          setup(build) {
            build.onResolve({ filter: /^catalyst-tools?$/ }, (args) =>
              library === undefined
                ? { path: args.path, external: true }
                : { path: join(library, `${args.path}.mjs`) }
            );
          }
        }
      ]
    });
    const [file] = built.outputFiles;
    if (!file) throw new Error("esbuild wrote nothing");
    return file.text;
  } catch (error) {
    throw bundleError(error, input.source);
  }
}

/**
 * What reads a bundled TypeScript tool, in a child process of its own: it imports the bundle,
 * so the tool's own code runs there, with the handler's environment and the describe timeout,
 * never in this CLI's process with its key. It writes every export that looks like a tool.
 */
const NODE_DESCRIBE = [
  'import { writeFileSync } from "node:fs";',
  "import { pathToFileURL } from 'node:url';",
  "const loaded = await import(pathToFileURL(process.argv[2]).href);",
  "const tools = [];",
  "for (const [name, value] of Object.entries(loaded)) {",
  "  if (value && typeof value === 'object' && typeof value.execute === 'function')",
  "    tools.push({ export: name, name: value.name, description: value.description, title: value.title, input: value.inputJsonSchema });",
  "}",
  "writeFileSync(process.argv[3], JSON.stringify(tools));",
  ""
].join("\n");

const describedToolsSchema = z.array(
  z.object({
    export: z.string(),
    name: z.string(),
    description: z.string(),
    title: z.unknown().optional(),
    input: z.record(z.string(), z.unknown())
  })
);

async function describeNode(
  folder: string,
  source: string,
  env: ConfigCliEnv
): Promise<{ described: Described; exportName: string }> {
  const bundle = await bundleTool({ folder, source });
  const directory = await mkdtemp(join(tmpdir(), "catalyst-tool-describe-"));
  try {
    const file = join(directory, "describe.mjs");
    const reader = join(directory, "reader.mjs");
    const answer = join(directory, "described.json");
    await writeFile(file, bundle);
    await writeFile(reader, NODE_DESCRIBE);
    await capture(process.execPath, [reader, file, answer], {
      cwd: folder,
      env: toolHandlerEnv(env)
    });
    const parsed = describedToolsSchema.safeParse(JSON.parse(await readFile(answer, "utf8")));
    if (!parsed.success) {
      throw new ToolFolderError(
        `${source} exports a tool without a name, a description or an input schema: make it with defineTool from @work-shape/catalyst-tool-sdk/code.`
      );
    }
    const tools = parsed.data;
    const chosen = tools.find((entry) => entry.export === "default") ?? tools[0];
    if (!chosen || (tools.length > 1 && chosen.export !== "default")) {
      throw new ToolFolderError(
        `${source} exports ${tools.length === 0 ? "no tool" : `${String(tools.length)} tools`}: it exports one, made with defineTool from @work-shape/catalyst-tool-sdk/code, best as its default export.`
      );
    }
    return {
      exportName: chosen.export,
      described: {
        name: chosen.name,
        description: chosen.description,
        ...(chosen.title === undefined || chosen.title === null ? {} : { title: chosen.title }),
        input: chosen.input
      }
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Every file of a Python tool's folder but `tool.yaml`, hidden ones and caches. */
async function pythonFiles(folder: string): Promise<{ path: string; content: string }[]> {
  const files: { path: string; content: string }[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name.endsWith(".pyc")) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!LEFT_OUT_FOLDERS.has(entry.name)) await walk(path);
        continue;
      }
      if (!entry.isFile()) continue;
      const name = relative(folder, path).split(sep).join("/");
      if (name === TOOL_FILE) continue;
      const bytes = await readFile(path);
      const content = bytes.toString("utf8");
      if (bytes.includes(0) || Buffer.from(content, "utf8").compare(bytes) !== 0) {
        throw new ToolFolderError(`${name} is no UTF-8 text; a tool's files are text.`);
      }
      files.push({ path: name, content });
    }
  };
  await walk(folder);
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * The definition of the tool in `folder`, as `catalyst tool put` sends it: `tool.yaml` with the
 * handler's own fields over it, checked as the instance checks it.
 */
export async function readToolFolder(
  folder: string,
  env: ConfigCliEnv,
  options: { bundle?: boolean } = {}
): Promise<ToolFolder> {
  const stats = await lstat(folder).catch(() => undefined);
  if (!stats?.isDirectory()) {
    throw new ToolFolderError(`'${folder}' is no folder. A code tool is put from its folder.`);
  }
  const file = await readToolFile(folder);
  const python = await exists(join(folder, PYTHON_ENTRY));
  const source = python
    ? undefined
    : (
        await Promise.all(
          NODE_ENTRIES.map(async (name) => ((await exists(join(folder, name))) ? name : undefined))
        )
      ).find((name) => name !== undefined);
  if (!python && source === undefined) {
    throw new ToolFolderError(
      `'${folder}' holds no ${PYTHON_ENTRY} and no index.ts: a tool's handler is one of them.`
    );
  }
  let described: Described;
  let exportName: string | undefined;
  let files: { path: string; content: string }[];
  if (source === undefined) {
    described = await describePython(folder, env);
    files = await pythonFiles(folder);
  } else {
    ({ described, exportName } = await describeNode(folder, source, env));
    files =
      options.bundle === false
        ? []
        : [
            {
              path: NODE_BUNDLE,
              content: await bundleTool({ folder, source, exportName, minify: true })
            }
          ];
  }
  const name = described.name ?? file.name ?? described.function;
  if (name === undefined) {
    throw new ToolFolderError(
      `Neither ${TOOL_FILE} nor the handler names the tool: give it a name.`
    );
  }
  const description = described.description ?? file.description;
  if (description === undefined) {
    throw new ToolFolderError(
      `Neither the handler nor ${TOOL_FILE} describes the tool for the model: give the handler a ${python ? "docstring" : "description"}.`
    );
  }
  const config = {
    type: "code",
    name,
    title: described.title ?? file.title ?? titleOf(name),
    ...(file.summary === undefined ? {} : { summary: file.summary }),
    description,
    ...(file.icon === undefined ? {} : { icon: file.icon }),
    input: described.input,
    runtime: python ? "python" : "node",
    entry: python ? PYTHON_ENTRY : NODE_BUNDLE,
    ...(file.timeout === undefined ? {} : { timeoutSeconds: file.timeout }),
    ...(file.connections === undefined ? {} : { connections: file.connections.map(declared) }),
    files: files.length > 0 ? files : [{ path: NODE_BUNDLE, content: "" }]
  };
  const checked = toolAssetConfigSchema.safeParse(config);
  if (!checked.success || checked.data.type !== "code") {
    throw new ToolFolderError(
      `The tool in '${folder}' is not one the instance takes:\n${(checked.error?.issues ?? [])
        .map((issue) => `- ${issue.path.join(".") || "(tool)"}: ${issue.message}`)
        .join("\n")}`
    );
  }
  return {
    folder,
    config: checked.data,
    ...(exportName === undefined ? {} : { exportName }),
    ...(source === undefined ? {} : { source })
  };
}
