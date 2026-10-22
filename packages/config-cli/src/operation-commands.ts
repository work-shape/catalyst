import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { apiOperations, type Operation } from "@work-shape/catalyst-api-contract";
import type { ApiClient } from "@work-shape/catalyst-api-client";
import { ConfigApiError, redactSecret, toConfigApiError, type ConfigApi } from "./api";
import { formatRefusal } from "./asset-output";
import {
  formatCommandError,
  isRecord,
  openInstance,
  writeError,
  writeOutput,
  type ConfigCommandOptions
} from "./command-support";
import { connectConnection } from "./connection-sign-in";
import { readSecret, readStdin, type CommandInput } from "./input";

const requestSchema = z.strictObject({
  params: z.record(z.string(), z.string()).optional(),
  query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  body: z.unknown().optional(),
  file: z.string().optional()
});
type CallInput = Omit<z.infer<typeof requestSchema>, "file"> & {
  file?: File;
  idempotencyKey?: string;
};
type Options = ConfigCommandOptions & {
  stdin?: CommandInput;
  /** Opens an address in the person's browser. Tests pass one that records it. */
  openUrl?: (address: string) => void;
};
class UsageError extends Error {}

export async function runOperationCommand(argv: readonly string[], base: Options): Promise<number> {
  const secretCommand = argv[0] === "connection" && argv[1] === "secret";
  let secret: string | undefined;
  try {
    let parsed;
    try {
      parsed = parseArgs({
        args: argv.slice(1),
        options: {
          instance: { type: "string" },
          dir: { type: "string" },
          from: { type: "string" },
          json: { type: "boolean" },
          "no-browser": { type: "boolean" },
          help: { type: "boolean", short: "h" }
        },
        allowPositionals: true,
        strict: true
      });
    } catch {
      // Unknown flags or extra arguments might contain a pasted secret. Never repeat them.
      throw new UsageError("Invalid command options. See 'catalyst --help'.");
    }
    const { values, positionals } = parsed;
    if (values.help) {
      writeOutput(base, operationHelpText);
      return 0;
    }
    const options: Options = { ...base, dir: values.dir, instance: values.instance };
    if (values["no-browser"] && !(argv[0] === "connection" && argv[1] === "connect"))
      throw new UsageError("--no-browser belongs to 'catalyst connection connect'.");
    const stdin = base.stdin ?? process.stdin;
    if (argv[0] === "call") {
      if (positionals.length !== 1)
        throw new UsageError("Usage: catalyst call <operation> [--from <file|->]");
      const operation = Object.values(apiOperations).find((entry) => entry.id === positionals[0]);
      if (!operation) throw new UsageError("Unknown catalog operation. Use its API operation id.");
      const source = values.from;
      const text =
        source !== undefined && source !== "-"
          ? await readFile(resolve(base.cwd, source), "utf8")
          : source === "-" || !stdin.isTTY
            ? await readStdin(stdin)
            : "";
      let input;
      try {
        input = requestSchema.parse(text.trim() === "" ? {} : JSON.parse(text));
      } catch {
        throw new UsageError(
          "Input must be JSON with params, query, body, or file (an upload path)."
        );
      }
      if (
        operation.id === "connections.set_secret" &&
        isRecord(input.body) &&
        typeof input.body.value === "string"
      )
        secret = input.body.value;
      const { file, ...request } = input;
      const upload =
        file === undefined
          ? undefined
          : new File([await readFile(resolve(base.cwd, file))], basename(file));
      const { api } = await openInstance(options);
      return await printCall(
        options,
        operation,
        await call(api, operation, {
          ...request,
          ...(upload === undefined ? {} : { file: upload })
        })
      );
    }
    if (values.from !== undefined)
      throw new UsageError("Connection commands read secrets only from stdin or a hidden prompt.");
    const [verb, name] = positionals;
    if (secretCommand) {
      if (positionals.length !== 3 || positionals[1] !== "set" || !positionals[2]) {
        throw new UsageError(
          "Usage: catalyst connection secret set <name> (value from stdin or hidden prompt only)"
        );
      }
      const connectionName = positionals[2];
      const { api } = await openInstance(options);
      const detail = await api.read((client) =>
        client.connections.get({ params: { name: connectionName } })
      );
      // The secret is for the Connection as it stands before the prompt: a change of its
      // addresses or client while the secret is typed refuses the write.
      const { revision } = await api.read((client) =>
        client.assets.get({ params: { kind: "connection", name: connectionName }, query: {} })
      );
      const value = await readSecret(stdin, (text) =>
        (options.stderr ?? process.stderr.write.bind(process.stderr))(text)
      );
      secret = value;
      if (value.length === 0) throw new UsageError("The secret must not be empty.");
      const state = await api
        .change(
          (client, idempotencyKey) =>
            client.connections.set_secret({
              params: { name: connectionName },
              body: {
                value,
                expectedVersion: detail.secret.version ?? null,
                expectedRevision: revision
              },
              idempotencyKey
            }),
          "Read the connection's secret state before trying again."
        )
        .catch(async (error: unknown) => {
          if (
            !(error instanceof ConfigApiError) ||
            error.status !== 409 ||
            error.code !== "OUTPUT_NOT_RETAINED"
          )
            throw error;
          return (
            await api.read((client) => client.connections.get({ params: { name: connectionName } }))
          ).secret;
        });
      writeOutput(options, JSON.stringify(state, null, 2));
      return 0;
    }
    if (verb === "connect") {
      if (positionals.length !== 2 || !name)
        throw new UsageError("Usage: catalyst connection connect <name> [--no-browser]");
      const { api } = await openInstance(options);
      return await connectConnection(api, name, { ...options, openBrowser: !values["no-browser"] });
    }
    const operation =
      verb === "test"
        ? apiOperations["connections.test"]
        : verb === "discover"
          ? apiOperations["connections.discover"]
          : verb === "disconnect"
            ? apiOperations["connections.disconnect"]
            : apiOperations["connections.list_tools"];
    if (
      (verb === "tools" && positionals.length !== 1) ||
      (verb !== "tools" && (positionals.length !== 2 || !name))
    ) {
      throw new UsageError(
        "Usage: catalyst connection test|discover|disconnect <name>, or catalyst connection tools"
      );
    }
    const { api } = await openInstance(options);
    return await printCall(
      options,
      operation,
      await call(api, operation, name === undefined ? {} : { params: { name } })
    );
  } catch (error) {
    const converted = toConfigApiError(error);
    const message =
      converted instanceof ConfigApiError
        ? formatRefusal(converted)
        : formatCommandError(converted);
    writeError(base, secret === undefined ? message : redactSecret(message, secret));
    return error instanceof UsageError ? 2 : 1;
  }
}

/** The catalog chooses the existing client method; the server chooses whether it may run. */
export async function call(
  api: ConfigApi,
  operation: Operation,
  input: CallInput
): Promise<unknown> {
  const invoke = (client: ApiClient, idempotencyKey?: string): unknown => {
    let method: unknown = client;
    for (const segment of operation.id.split("."))
      method = isRecord(method) ? method[segment] : undefined;
    if (!isMethod(method))
      throw new Error("The API client has no method for this catalog operation.");
    return method({ ...input, ...(idempotencyKey === undefined ? {} : { idempotencyKey }) });
  };
  return operation.effect === "reading"
    ? api.read(async (client) => invoke(client))
    : api.change(
        async (client, key) => invoke(client, key),
        "Check the operation's state before trying again."
      );
}

function isMethod(value: unknown): value is (input: CallInput) => unknown {
  return typeof value === "function";
}

export async function printCall(
  options: Options,
  operation: Operation,
  result: unknown,
  format?: (value: unknown) => string
): Promise<number> {
  const render = format ?? ((value: unknown) => JSON.stringify(value, null, 2));
  if (isRecord(result) && operation.accepted) {
    if (result.status === "pending_approval") {
      if (format === undefined) {
        writeOutput(options, render({ status: result.status, run: result.run }));
      } else {
        const id = isRecord(result.run) ? result.run.id : "unknown";
        writeError(
          options,
          `Waits for an approval on the instance; nothing has changed yet (Operation Run ${id}).`
        );
      }
      return 3;
    }
    writeOutput(options, render(result.output ?? null));
  } else if (result instanceof Blob) {
    writeOutput(
      options,
      JSON.stringify({
        contentType: result.type,
        base64: Buffer.from(await result.arrayBuffer()).toString("base64")
      })
    );
  } else if (isStream(result)) {
    try {
      for await (const event of result) writeOutput(options, JSON.stringify(event));
    } catch (error) {
      throw toConfigApiError(error);
    }
  } else {
    writeOutput(options, render(result ?? null));
  }
  return 0;
}

function isStream(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function"
  );
}

export const operationHelpText = `Operations (JSON output; the instance decides every right):
  call <operation> [--from <file|->]  API client input as JSON: params, query, body, file
                                    Default: stdin (or {} at a terminal)
  connection secret set <name>      Secret from stdin or a hidden terminal prompt only
  connection test <name>            Check the Connection (connections.test)
  connection discover <name>        Queue discovery (connections.discover)
  connection tools                 List available tools (connections.list_tools)
  connection connect <name>         Sign the Connection in with OAuth: opens the provider's page
                                    in the browser and waits until the sign-in is in; prints
                                    the binding's state, never a token (connections.oauth_start)
                                    --no-browser prints the address without opening it
  connection disconnect <name>      End the sign-in and revoke it at the provider
                                    (connections.disconnect)

Multi-line secrets (such as PEM keys) must use stdin, e.g. connection secret set <name> < key.pem.
The hidden prompt accepts one line; Enter submits it.
A sign-in needs a person's key and their signed-in browser; a service principal's key is
refused.

Options: --instance <name-or-url>, --dir <working-copy-dir>, --json, --help
Exit codes: 0 done, 1 refused or failed, 2 usage, 3 waits for approval.
`;
