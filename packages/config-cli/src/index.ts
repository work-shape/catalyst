import { runKnowledgeCommand, knowledgeHelpText } from "./knowledge-commands";
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { RELEASE_VERSION } from "@work-shape/catalyst-api-contract";
import { assetHelpText, runAssetCommand } from "./asset-commands";
import { runConfigCommand, type ConfigCommandName, type ConfigCommandOptions } from "./commands";
import { operationHelpText, runOperationCommand } from "./operation-commands";
import { isNamedCommand, isNamedNoun, namedHelpText, runNamedCommand } from "./named-commands";
import type { CommandInput } from "./input";
import type { AssetKindName } from "./command-support";
import { runInit } from "./init";
import { loginCommand, logoutCommand } from "./login";
import { isLocalAgentTool, SETUP_USAGE, setupCommand } from "./setup";

export * from "./api";
export { publishReview, type PublishReview } from "./app-commands";
export * from "./commands";
export * from "./diff";
export * from "./serialization";
export { renderCatalystSkill } from "./setup";
export * from "./working-copy";

export interface CliRuntimeOptions {
  cwd?: string;
  stdin?: CommandInput;
  fetchImpl?: typeof fetch;
  env?: Readonly<Record<string, string | undefined>>;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  /** Waits between tries. Tests pass one that does not wait. */
  sleep?: (milliseconds: number) => Promise<void>;
  /** Opens an address in a browser, as `setup` does. Tests pass one that opens nothing. */
  openUrl?: (address: string) => void;
  /**
   * Asks the person at the terminal and answers what they typed. Left out, the terminal is
   * asked where there is one, and nobody where there is none.
   */
  prompt?: (question: string) => Promise<string>;
}

/** Asks the question on standard error and reads one line of standard input. */
async function askTerminal(question: string): Promise<string> {
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await terminal.question(question);
  } finally {
    terminal.close();
  }
}

const helpText = `Usage: catalyst config <command> [options]
       catalyst login --instance <name-or-url>
       catalyst logout --instance <name-or-url>
       catalyst setup <claude-code|codex|other> --instance <url> [--force]

Sync local config assets with a live Catalyst instance.

Working copy:
  init --instance <alias-or-url> [--dir <root>]
             Bind a new folder and write agent guidance in AGENTS.md and CLAUDE.md

Login:
  login      Show a connect code, wait until you confirm it on the instance at
             /settings/you/api-keys, and save the personal API key it issues, readable by
             you alone
  logout     Forget the saved key of an instance; revoke it at /settings/you/api-keys
  setup      Connect a local agent: log in as 'login' does unless a working key is saved,
             then write the Catalyst skill for Claude Code, Codex or another tool. --force
             replaces a different skill file there and keeps it as SKILL.md.bak

Commands:
  pull       Sync remote config assets into the local working copy. An agent is pulled
             at its live revision; each pending draft is listed with its author
  push       Merge local config assets into the remote instance. A changed agent that
             exists is written as its draft: "draft revision n", nothing live yet
  diff       Show local changes, remote newer assets, and conflicts, each agent against
             its live revision, and name each pending agent draft
  validate   Validate local assets and remote references
  list       List local and remote config assets and their sync status
  show       Print a remote asset: show <agent|skill|guardrail> <name>

Options:
  --instance <name-or-url>  Manifest instance name or direct URL. Left out: the
                            manifest's defaultInstance; outside a working copy, the
                            one instance a key is saved for
  --dir <working-copy-dir>  Directory containing catalyst.yaml (default: .)
  --prune                   Mirror on push, deleting the remote-only assets the last pull
                            saw
  --publish                 On push: publish each agent draft the push wrote. An
                            instance's own agent is published without a question unless a
                            guardrail asks for an approval; a workspace's agent asks first.
                            Needs a personal key with the publish right: a service
                            principal's key writes drafts and publishes none
  --only <agent:name|skill:name|guardrail:name>
                            Sync selected assets; repeatable on push/pull
  --workspace <id>          On pull: bind the working copy to the workspace and hold
                            what it owns
  --help                    Show this help
  --version                 Print the version of this CLI

Environment:
  CATALYST_API_KEY      API key exchanged for a short-lived access token. It wins over
                        a key 'catalyst login' saved
  CATALYST_CONFIG_HOME  Folder of the saved keys (default: ~/.config/catalyst)

A working copy bound to a workspace names it beside the instance's url in catalyst.yaml,
as 'workspace: <id>', which the first 'catalyst config pull --workspace <id>' writes. It
holds what that workspace owns, and everything its push creates is owned by that workspace,
guardrails included. Its push is never a release: a new agent starts hidden until an instance
admin offers it. A working copy without one holds the instance's own assets.

Guardrails join the working copy where catalyst.yaml lists their globs under 'guardrails',
such as 'guardrails/*/guardrail.yaml'. Each is a folder with its guardrail.yaml and, for a
model_judge check, its instruction in check.md. Guardrails are no part of a release: a push
writes each as its draft with assets.put after the batch, which needs the config_assets:write
scope. Publishing is a step of its own.

An agent has its live revision and at most one draft, which every writer shares. A push of
a changed agent writes that draft and names the draft revision the last pull or push saw: it
is refused when somebody changed the draft since, naming who. 'catalyst agent publish <name>
--revision <n>' makes a draft live, and 'catalyst agent discard <name> --revision <n>' drops it.
A .catalyst-state.json of a CLI from before agent drafts needs one pull before an agent push.
Exit codes: 0 done, 1 refused or failed, 2 usage, 3 a publish waits for an approval.
`;

export async function runCli(argv: string[], runtime: CliRuntimeOptions = {}): Promise<number> {
  const stdout = runtime.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = runtime.stderr ?? ((text: string) => process.stderr.write(text));
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    stdout(
      `${assetHelpText}\n${operationHelpText}\n${namedHelpText}\n${knowledgeHelpText}\n${helpText}`
    );
    return 0;
  }
  if (argv[0] === "--version") {
    stdout(`${RELEASE_VERSION}\n`);
    return 0;
  }
  if (argv[0] === "init")
    return runInit(argv.slice(1), {
      ...runtime,
      cwd: runtime.cwd ?? process.cwd(),
      stdout,
      stderr
    });
  if (argv[0] === "login" || argv[0] === "logout" || argv[0] === "setup") {
    return runLoginCommand(argv[0], argv.slice(1), runtime, stdout, stderr);
  }
  if (argv[0] === "knowledge-base" && (argv[1] === "source" || argv[1] === "sync"))
    return runKnowledgeCommand(argv, {
      ...runtime,
      cwd: runtime.cwd ?? process.cwd(),
      stdout,
      stderr
    });
  if (
    isNamedNoun(argv[0]) &&
    !isNamedCommand(argv) &&
    (argv.length === 1 || argv.includes("--help"))
  ) {
    stdout(namedHelpText);
    return 0;
  }
  if (isNamedCommand(argv)) {
    return runNamedCommand(argv, {
      ...runtime,
      cwd: runtime.cwd ?? process.cwd(),
      stdout,
      stderr
    });
  }
  if (
    argv[0] === "call" ||
    (argv[0] === "connection" && ["secret", "test", "discover", "tools"].includes(argv[1] ?? ""))
  ) {
    return runOperationCommand(argv, {
      ...runtime,
      cwd: runtime.cwd ?? process.cwd(),
      stdout,
      stderr
    });
  }
  if (argv[0] !== "config") {
    const prompt = runtime.prompt ?? (process.stdin.isTTY ? askTerminal : undefined);
    return runAssetCommand(argv, {
      cwd: runtime.cwd ?? process.cwd(),
      ...(runtime.fetchImpl === undefined ? {} : { fetchImpl: runtime.fetchImpl }),
      ...(runtime.env === undefined ? {} : { env: runtime.env }),
      ...(prompt === undefined ? {} : { prompt }),
      stdout,
      stderr
    });
  }
  if (argv.length === 1 || argv[1] === "--help" || argv[1] === "-h") {
    stdout(helpText);
    return 0;
  }
  const command = argv[1]!;
  if (command === "local-key") {
    stderr(
      "'catalyst config local-key' is no longer part of this tool. Run the 'config:local-key' script of the client repository, which calls 'catalyst-local-key'.\n"
    );
    return 2;
  }
  if (!isConfigCommand(command)) {
    stderr(`Unknown config command '${command}'.\n\n${helpText}`);
    return 2;
  }

  const configPrompt = runtime.prompt ?? (process.stdin.isTTY ? askTerminal : undefined);
  try {
    const parsed = parseArgs({
      args: argv.slice(2),
      options: {
        instance: { type: "string" },
        dir: { type: "string" },
        force: { type: "boolean", default: false },
        prune: { type: "boolean", default: false },
        publish: { type: "boolean", default: false },
        only: { type: "string", multiple: true },
        workspace: { type: "string" },
        help: { type: "boolean", short: "h", default: false }
      },
      allowPositionals: true,
      strict: true
    });
    if (parsed.values.help) {
      stdout(helpText);
      return 0;
    }
    if (parsed.values.force && command !== "push") {
      stderr("--force is only valid with 'catalyst config push'.\n");
      return 2;
    }
    if (parsed.values.prune && command !== "push") {
      stderr("--prune is only valid with 'catalyst config push'.\n");
      return 2;
    }
    if (parsed.values.publish && command !== "push") {
      stderr("--publish is only valid with 'catalyst config push'.\n");
      return 2;
    }
    if (parsed.values.only && command !== "push" && command !== "pull") {
      stderr("--only is only valid with 'catalyst config push' or 'catalyst config pull'.\n");
      return 2;
    }
    if (parsed.values.workspace !== undefined && command !== "pull") {
      stderr(
        "--workspace is only valid with 'catalyst config pull', which binds the working copy.\n"
      );
      return 2;
    }
    if (parsed.values.prune && parsed.values.only) {
      stderr("--prune cannot be combined with --only.\n");
      return 2;
    }
    if (command === "show") {
      if (parsed.positionals.length !== 2 || !isShownKind(parsed.positionals[0])) {
        stderr("Usage: catalyst config show <agent|skill|guardrail> <name>\n");
        return 2;
      }
    } else if (parsed.positionals.length > 0) {
      stderr(`Unexpected argument '${parsed.positionals[0]}'.\n`);
      return 2;
    }
    const options: ConfigCommandOptions = {
      cwd: runtime.cwd ?? process.cwd(),
      ...(parsed.values.dir === undefined ? {} : { dir: parsed.values.dir }),
      ...(parsed.values.instance === undefined ? {} : { instance: parsed.values.instance }),
      ...(parsed.values.force ? { force: true } : {}),
      ...(parsed.values.prune ? { prune: true } : {}),
      ...(parsed.values.publish ? { publish: true } : {}),
      ...(parsed.values.only === undefined ? {} : { only: parsed.values.only }),
      ...(parsed.values.workspace === undefined ? {} : { workspace: parsed.values.workspace }),
      ...(command === "show" && isShownKind(parsed.positionals[0])
        ? { assetKind: parsed.positionals[0], assetName: parsed.positionals[1]! }
        : {}),
      ...(runtime.fetchImpl === undefined ? {} : { fetchImpl: runtime.fetchImpl }),
      ...(runtime.env === undefined ? {} : { env: runtime.env }),
      ...(configPrompt === undefined ? {} : { prompt: configPrompt }),
      stdout,
      stderr
    };
    return runConfigCommand(command, options);
  } catch (error) {
    stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

async function runLoginCommand(
  command: "login" | "logout" | "setup",
  args: string[],
  runtime: CliRuntimeOptions,
  stdout: (text: string) => void,
  stderr: (text: string) => void
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        instance: { type: "string" },
        dir: { type: "string" },
        force: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false }
      },
      allowPositionals: command === "setup",
      strict: true
    });
  } catch (error) {
    stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  if (parsed.values.help) {
    stdout(helpText);
    return 0;
  }
  if (parsed.values.force && command !== "setup") {
    stderr(`--force is not an option of 'catalyst ${command}'.\n`);
    return 2;
  }
  const options: ConfigCommandOptions = {
    cwd: runtime.cwd ?? process.cwd(),
    ...(parsed.values.dir === undefined ? {} : { dir: parsed.values.dir }),
    ...(parsed.values.instance === undefined ? {} : { instance: parsed.values.instance }),
    ...(runtime.fetchImpl === undefined ? {} : { fetchImpl: runtime.fetchImpl }),
    ...(runtime.env === undefined ? {} : { env: runtime.env }),
    ...(runtime.sleep === undefined ? {} : { sleep: runtime.sleep }),
    stdout,
    stderr
  };
  if (command === "setup") {
    const [tool, ...extra] = parsed.positionals;
    if (!isLocalAgentTool(tool) || extra.length > 0 || parsed.values.instance === undefined) {
      stderr(`${SETUP_USAGE}\n`);
      return 2;
    }
    return setupCommand({
      ...options,
      tool,
      ...(parsed.values.force ? { force: true } : {}),
      ...(runtime.openUrl === undefined ? {} : { openUrl: runtime.openUrl })
    });
  }
  return command === "login" ? loginCommand(options) : logoutCommand(options);
}

function isShownKind(value: string | undefined): value is AssetKindName {
  return value === "agent" || value === "skill" || value === "guardrail";
}

function isConfigCommand(value: string): value is ConfigCommandName {
  return (
    value === "pull" ||
    value === "push" ||
    value === "diff" ||
    value === "validate" ||
    value === "list" ||
    value === "show"
  );
}

const entryPath = process.argv[1];
// The bin is reached through a node_modules symlink, so compare resolved paths.
if (entryPath && import.meta.url === pathToFileURL(realpathSync(entryPath)).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
