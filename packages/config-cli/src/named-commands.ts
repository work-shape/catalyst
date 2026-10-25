import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import yaml from "js-yaml";
import { apiOperations, MAX_LIST_LIMIT, type Operation } from "@work-shape/catalyst-api-contract";
import { ConfigApiError, toConfigApiError } from "./api";
import { formatRefusal } from "./asset-output";
import {
  formatCommandError,
  isRecord,
  openInstance,
  writeError,
  type ConfigCommandOptions
} from "./command-support";
import { readStdin, type CommandInput } from "./input";
import { call, printCall } from "./operation-commands";

interface NamedCommand {
  operation: Operation;
  usage: string;
  param?: string;
  optionalName?: boolean;
  listField?: "apps";
  from?: boolean;
  /** What `--from` must hold, for the usage error when it does not. */
  fromShape?: string;
}

// Each face names an existing operation. Rights, policy and execution stay in the instance.
const commands: Readonly<Record<string, NamedCommand>> = {
  "workflow test": {
    operation: apiOperations["workflows.test"],
    usage: "workflow test <name> [--from <file|->]",
    param: "workflow",
    from: true,
    fromShape: 'Workflow test input must be a JSON object: {"input": {...}}.'
  },
  "workflow runs": {
    operation: apiOperations["workflows.list_runs"],
    usage: "workflow runs <name>",
    param: "workflow"
  },
  "workflow run": {
    operation: apiOperations["workflows.get_run"],
    usage: "workflow run <run-id>",
    param: "runId"
  },
  "workflow steps": {
    operation: apiOperations["workflows.list_step_runs"],
    usage: "workflow steps <run-id>",
    param: "runId"
  },
  "workflow cancel": {
    operation: apiOperations["workflows.cancel_run"],
    usage: "workflow cancel <run-id>",
    param: "runId"
  },
  "guardrail hits": {
    operation: apiOperations["guardrails.list_hits"],
    usage: "guardrail hits <name>",
    param: "name"
  },
  "knowledge-base check": {
    operation: apiOperations["knowledge_bases.check"],
    usage: "knowledge-base check <name>",
    param: "knowledgeBase"
  },
  "data-store describe": {
    operation: apiOperations["data_stores.describe"],
    usage: "data-store describe <name>",
    param: "store"
  },
  "data-store used-by": {
    operation: apiOperations["data_stores.used_by"],
    usage: "data-store used-by <name>",
    param: "store"
  },
  "app actions": {
    operation: apiOperations["apps.actions.list"],
    usage: "app actions [<name>]",
    optionalName: true,
    listField: "apps"
  },
  "keys list": { operation: apiOperations["me.api_keys.list"], usage: "keys list" },
  "instance workspaces": {
    operation: apiOperations["instance.workspaces.list"],
    usage: "instance workspaces"
  },
  "limits show": { operation: apiOperations["usage.limits.get"], usage: "limits show" },
  "limits set": {
    operation: apiOperations["usage.limits.set"],
    usage: "limits set --from <file|->",
    from: true,
    fromShape:
      'Limit input must be a JSON object: {"level": "user", "target": "<user id>", "limits": {"monthly": 50}}; "limits": null removes the value.'
  }
};

export function namedCommandNames(): string[] {
  return Object.keys(commands);
}

export function isNamedCommand(argv: readonly string[]): boolean {
  return Object.hasOwn(commands, `${argv[0]} ${argv[1]}`);
}

/** `keys` and `instance`: the words that only lead named operations, for their help. */
export function isNamedNoun(noun: string | undefined): boolean {
  return Object.keys(commands).some((command) => command.split(" ")[0] === noun);
}

class UsageError extends Error {}

export async function runNamedCommand(
  argv: readonly string[],
  base: ConfigCommandOptions & { stdin?: CommandInput }
): Promise<number> {
  try {
    const command = commands[`${argv[0]} ${argv[1]}`];
    if (!command) throw new UsageError("Unknown command. See 'catalyst --help'.");
    let parsed;
    try {
      parsed = parseArgs({
        args: argv.slice(2),
        options: {
          instance: { type: "string" },
          dir: { type: "string" },
          json: { type: "boolean" },
          help: { type: "boolean", short: "h" },
          from: { type: "string" }
        },
        allowPositionals: true,
        strict: true
      });
    } catch {
      throw new UsageError(`Usage: catalyst ${command.usage}`);
    }
    const { values, positionals } = parsed;
    if (values.help) {
      base.stdout?.(`Usage: catalyst ${command.usage}\n${command.operation.summary}\n`);
      return 0;
    }
    const [name] = positionals;
    const count = command.param ? 1 : 0;
    if (
      (command.optionalName ? positionals.length > 1 : positionals.length !== count) ||
      (name !== undefined && name === "") ||
      (!command.from && values.from !== undefined)
    ) {
      throw new UsageError(`Usage: catalyst ${command.usage}`);
    }
    let body: unknown;
    if (command.from) {
      const source = values.from;
      const text =
        source === undefined
          ? "{}"
          : source === "-"
            ? await readStdin(base.stdin ?? process.stdin)
            : await readFile(resolve(base.cwd, source), "utf8");
      try {
        const input: unknown = JSON.parse(text);
        // This is the operation's request body, not the generic call envelope.
        body = command.operation.body?.parse(input);
      } catch {
        throw new UsageError(command.fromShape ?? `Usage: catalyst ${command.usage}`);
      }
    }
    const options = { ...base, instance: values.instance, dir: values.dir };
    const { api } = await openInstance(options);
    const params =
      command.param !== undefined && name !== undefined ? { [command.param]: name } : undefined;
    const query: Record<string, string> =
      command.optionalName && name !== undefined ? { app: name } : {};
    let result: unknown;
    const listField =
      command.operation.response.kind === "page"
        ? "items"
        : name === undefined
          ? command.listField
          : undefined;
    if (listField !== undefined) {
      const items: unknown[] = [];
      let cursor: string | undefined;
      do {
        const page = await call(api, command.operation, {
          params,
          query: { ...query, limit: MAX_LIST_LIMIT, ...(cursor === undefined ? {} : { cursor }) }
        });
        if (!isRecord(page) || !Array.isArray(page[listField]))
          throw new Error("Invalid list response.");
        items.push(...page[listField]);
        cursor = typeof page.nextCursor === "string" ? page.nextCursor : undefined;
      } while (cursor !== undefined);
      result = listField === "apps" ? { apps: items, truncated: false } : items;
    } else {
      result = await call(api, command.operation, { params, query, body });
    }
    return await printCall(
      options,
      command.operation,
      result,
      values.json
        ? undefined
        : (value) => yaml.dump(value, { lineWidth: -1, noRefs: true }).trimEnd()
    );
  } catch (error) {
    const converted = toConfigApiError(error);
    writeError(
      base,
      converted instanceof ConfigApiError ? formatRefusal(converted) : formatCommandError(converted)
    );
    return error instanceof UsageError ? 2 : 1;
  }
}

export const namedHelpText = `Named operations (readable output by default; --json for JSON):
${Object.values(commands)
  .map((command) => `  ${command.usage} (${command.operation.id})`)
  .join("\n")}

Workflow test --from reads the request body {"input": {...}}; omitted, it sends {}.
Lists read every page. instance workspaces shows Shared Workspaces for agent availability
and needs config_assets:write and agent.write; it is not the membership list.
Options: --instance <name-or-url>, --dir <working-copy-dir>, --json, --help
Exit codes: 0 done, 1 refused or failed, 2 usage, 3 waits for approval.
`;
