import { parseArgs } from "node:util";
import { runConfigCommand, type ConfigCommandName, type ConfigCommandOptions } from "../commands";
import type { AssetKindName } from "../command-support";
import { askTerminal } from "../cli-runtime";
import type { CommandGroup, CommandRuntime } from "./types";

const commands = {
  pull: `Sync remote config assets into the local working copy. An agent is pulled
             at its live revision; each pending draft is listed with its author`,
  push: `Merge local config assets into the remote instance. A changed agent that
             exists is written as its draft: "draft revision n", nothing live yet`,
  diff: `Show local changes, remote newer assets, and conflicts, each agent against
             its live revision, and name each pending agent draft`,
  validate: `Validate local assets and remote references`,
  list: `List local and remote config assets and their sync status`,
  show: `Print a remote asset: show <agent|skill|guardrail> <name>`
} satisfies Record<ConfigCommandName, string>;
const names = Object.keys(commands);
const helpText = `Usage: catalyst config <command> [options]

Sync local config assets with a live Catalyst instance.

Commands:
${Object.entries(commands)
  .map(([name, summary]) => `  ${name.padEnd(11)}${summary}`)
  .join("\n")}

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

export const configGroup: CommandGroup = {
  names: names.map((name) => `config ${name}`),
  matches: (argv) => argv[0] === "config",
  help: helpText,
  run: runConfig
};

async function runConfig(argv: string[], runtime: CommandRuntime): Promise<number> {
  const { stdout, stderr } = runtime;
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

function isShownKind(value: string | undefined): value is AssetKindName {
  return value === "agent" || value === "skill" || value === "guardrail";
}

function isConfigCommand(value: string): value is ConfigCommandName {
  return names.some((name) => name === value);
}
