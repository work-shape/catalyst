import { cliVersionNotice, formatDocs } from "./instance-output";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { ConfigApiError } from "./api";
import {
  APP_VERBS,
  RepositoryUsageError,
  isRepositoryVerb,
  runRepositoryCommand,
  type RepositoryCommandOptions
} from "./app-commands";
import { REPOSITORY_KINDS } from "./app-folder";
import { runFollowCommand } from "./follow-commands";
import {
  formatContext,
  formatKinds,
  formatRefusal,
  formatReferences,
  kindNoun
} from "./asset-output";
import {
  openInstance,
  formatCommandError,
  writeError,
  writeOutput,
  type ConfigCommandOptions
} from "./command-support";
import { formatAssetHelp } from "./asset-help";
import { VERBS } from "./asset-verbs";
import type { Values, OptionName, AssetKind } from "./asset-verbs/types";
import { EXIT, UsageError, ExplainedRefusal, required } from "./asset-verbs/support";

const COMMON_OPTIONS = {
  instance: { type: "string" },
  dir: { type: "string" },
  json: { type: "boolean", default: false },
  workspace: { type: "string" },
  help: { type: "boolean", short: "h", default: false }
} as const;
const OPTIONS = {
  ...COMMON_OPTIONS,
  revision: { type: "string" },
  published: { type: "boolean", default: false },
  yes: { type: "boolean", default: false },
  audience: { type: "string" },
  withdraw: { type: "string" },
  ...Object.values(VERBS).reduce<NonNullable<ParseArgsConfig["options"]>>(
    (options, verb) => ({ ...options, ...verb.options }),
    {}
  )
} as const;
const COMMON_FLAGS = Object.keys(COMMON_OPTIONS);
function parseCommandLine(args: string[]) {
  const parsed = parseArgs({ args, options: OPTIONS, allowPositionals: true, strict: true });
  return {
    ...parsed,
    values: {
      files: false,
      personal: false,
      none: false,
      all: false,
      ...parsed.values
    } satisfies Values
  };
}

/** The options of the App commands beside the common ones. */
const APP_FLAGS = {
  pull: ["revision", "published"],
  push: [],
  publish: ["revision", "yes", "audience"],
  status: []
} as const satisfies Record<keyof typeof APP_VERBS, readonly OptionName[]>;

/** The words before the kind that are commands of their own. */
const INSTANCE_COMMANDS = [
  "context",
  "kinds",
  "docs",
  "references",
  "operation",
  "requests"
] as const;

/** Runs `catalyst <argv>` for every command but `config`. */
export async function runAssetCommand(
  argv: readonly string[],
  base: Omit<RepositoryCommandOptions, "dir" | "instance">
): Promise<number> {
  const [noun = "", ...rest] = argv;
  let values: Values;
  let positionals: string[];
  try {
    ({ values, positionals } = parseCommandLine(rest));
  } catch (error) {
    writeError(
      base,
      `${error instanceof Error ? error.message : String(error)}\n\n${assetHelpText}`
    );
    return EXIT.usage;
  }
  const options: RepositoryCommandOptions = {
    ...base,
    ...(values.dir === undefined ? {} : { dir: values.dir }),
    ...(values.instance === undefined ? {} : { instance: values.instance })
  };
  const instanceCommand = INSTANCE_COMMANDS.find((command) => command === noun);
  const [verbName = "", name = "", ...extra] = positionals;
  const knownKind = [
    "agent",
    "skill",
    "guardrail",
    "app",
    "workflow",
    "connection",
    "data-store",
    "knowledge-base"
  ].some((kind) => [kind, `${kind}s`, kind.replace("-", "_")].includes(noun));
  // A registered kind unknown to this CLI can still use offline help with a kind verb.
  if (instanceCommand === undefined && !knownKind && VERBS[verbName] === undefined) {
    writeError(options, `Unknown command '${noun}'.\n\n${assetHelpText}`);
    return EXIT.usage;
  }
  if (values.help) {
    writeOutput(options, assetHelpText);
    return EXIT.done;
  }
  if (instanceCommand === undefined && verbName === "") {
    writeError(options, `Unknown command '${noun}'.\n\n${assetHelpText}`);
    return EXIT.usage;
  }
  try {
    if (instanceCommand !== undefined) {
      if (instanceCommand === "operation") {
        if (verbName !== "show" || name === "" || extra.length > 0) {
          throw new UsageError("Usage: catalyst operation show <run-id>");
        }
      } else if (instanceCommand === "docs" ? positionals.length > 1 : positionals.length > 0) {
        throw new UsageError(`Unexpected argument '${positionals[0]}'.`);
      }
      refuseFlags(
        values,
        instanceCommand === "requests"
          ? ["instance", "dir", "json", "help", "withdraw"]
          : instanceCommand === "operation"
            ? ["instance", "dir", "json", "help"]
            : COMMON_FLAGS,
        instanceCommand
      );
      if (values.withdraw !== undefined) required(values.withdraw, "--withdraw <id>");
      return await runInstanceCommand(
        instanceCommand,
        values,
        options,
        instanceCommand === "docs" ? verbName : name
      );
    }
    const repository = Object.values(REPOSITORY_KINDS).find(
      (kind) => noun === kind.kind || noun === `${kind.kind}s`
    );
    if (
      repository &&
      isRepositoryVerb(verbName) &&
      (verbName !== "publish" || repository.kind === "app")
    ) {
      refuseFlags(values, [...COMMON_FLAGS, ...APP_FLAGS[verbName]], verbName);
      return await runRepositoryCommand(
        verbName,
        positionals.slice(1),
        values,
        options,
        repository
      );
    }
    const verb = VERBS[verbName];
    if (verb === undefined) throw new UsageError(`Unknown command '${noun} ${verbName}'.`);
    refuseFlags(values, [...COMMON_FLAGS, ...Object.keys(verb.options)], verbName);
    if (verb.named && name === "") throw new UsageError(`Usage: catalyst ${noun} ${verb.usage}`);
    if (
      extra.length > (verbName === "pull" ? 1 : 0) ||
      (!verb.named && verbName !== "set-default" && verbName !== "adopt" && name !== "")
    ) {
      throw new UsageError(`Unexpected argument '${extra[0] ?? name}'.`);
    }
    const call = verb.prepare(values, name, options.cwd, noun, extra[0]);
    const { api, workspace, url } = await openInstance(options);
    const context = await api.read((client) => client.platform.context.get());
    const workspaceId = values.workspace ?? workspace;
    return await call({
      api,
      instance: url,
      kind: findKind(context.kinds, noun),
      values,
      scope: workspaceId === undefined ? {} : { workspaceId },
      options
    });
  } catch (error) {
    if (error instanceof UsageError || error instanceof RepositoryUsageError) {
      writeError(options, error.message);
      return EXIT.usage;
    }
    if (error instanceof ExplainedRefusal) {
      const { refusal } = error;
      writeError(
        options,
        `${refusal instanceof ConfigApiError ? formatRefusal(refusal) : formatCommandError(refusal)}\n${error.hint}`
      );
      return EXIT.refused;
    }
    writeError(
      options,
      error instanceof ConfigApiError ? formatRefusal(error) : formatCommandError(error)
    );
    return EXIT.refused;
  }
}

async function runInstanceCommand(
  command: (typeof INSTANCE_COMMANDS)[number],
  values: Values,
  options: ConfigCommandOptions,
  runId: string
): Promise<number> {
  const { api } = await openInstance(options);
  const json = values.json;
  const out = (value: unknown, text: () => string) =>
    writeOutput(options, json ? JSON.stringify(value, null, 2) : text());
  if (command === "operation" || command === "requests") {
    return runFollowCommand(api, command, { runId, json, withdraw: values.withdraw }, options);
  }
  if (command === "docs") {
    const docs = await api.read((client) =>
      client.platform.docs.get({ query: runId ? { page: runId } : {} })
    );
    // A page's Markdown is written byte for byte, without the normal output newline.
    if (!json && "markdown" in docs)
      (options.stdout ?? process.stdout.write.bind(process.stdout))(docs.markdown);
    else out(docs, () => formatDocs(docs));
  } else if (command === "references") {
    const references = await api.read((client) => client.platform.references.get());
    out(references, () => formatReferences(references));
  } else {
    const context = await api.read((client) => client.platform.context.get());
    if (command === "kinds") out(context.kinds, () => formatKinds(context.kinds));
    else {
      const notice = cliVersionNotice(context.release.cliVersion);
      if (notice !== undefined) writeError(options, notice);
      out(context, () => formatContext(context));
    }
  }
  return EXIT.done;
}

/** The kind a noun names: its id, its plural, or either with dashes for underscores. */
function findKind(kinds: readonly AssetKind[], noun: string): AssetKind {
  const wanted = noun.replaceAll("-", "_");
  const kind = kinds.find((candidate) => candidate.kind === wanted || candidate.plural === wanted);
  if (kind === undefined) {
    throw new UsageError(
      `The instance has no asset kind '${noun}' you can reach. Its kinds: ${kinds.map(kindNoun).join(", ")}.`
    );
  }
  return kind;
}

function refuseFlags(values: Values, allowed: readonly string[], command: string): void {
  for (const [flag, value] of Object.entries(values)) {
    const given = value !== undefined && value !== false;
    if (given && !allowed.some((name) => name === flag)) {
      throw new UsageError(`--${flag} is not an option of '${command}'.`);
    }
  }
}
export const assetHelpText = formatAssetHelp(
  Object.entries(VERBS)
    .filter(([name]) => name !== "pull")
    .map(([, verb]) => verb)
);
