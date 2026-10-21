import { parseArgs } from "node:util";
import { loginCommand, logoutCommand } from "../login";
import { isLocalAgentTool, SETUP_USAGE, setupCommand } from "../setup";
import type { ConfigCommandOptions } from "../commands";
import type { CliRuntimeOptions } from "../cli-runtime";
import type { CommandGroup } from "./types";

const helpText = `Usage: catalyst login --instance <name-or-url>
       catalyst logout --instance <name-or-url>
       catalyst setup <claude-code|codex|other> --instance <url> [--force]

Login:
  login      Show a connect code, wait until you confirm it on the instance at
             /settings/you/api-keys, and save the personal API key it issues, readable by
             you alone
  logout     Forget the saved key of an instance; revoke it at /settings/you/api-keys
  setup      Connect a local agent: log in as 'login' does unless a working key is saved,
             then write the Catalyst skill for Claude Code, Codex or another tool. --force
             replaces a different skill file there and keeps it as SKILL.md.bak

`;
export const authGroup: CommandGroup = {
  names: ["login", "logout", "setup"],
  matches: (argv) => isLoginCommand(argv[0]),
  help: helpText,
  run: (argv, runtime) => {
    const command = argv[0];
    if (!isLoginCommand(command)) return Promise.resolve(2);
    return runLoginCommand(command, argv.slice(1), runtime, runtime.stdout, runtime.stderr);
  }
};

function isLoginCommand(value: string | undefined): value is Parameters<typeof runLoginCommand>[0] {
  return value === "login" || value === "logout" || value === "setup";
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
