import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import yaml from "js-yaml";
import {
  CONNECTION_NAME_MAX_LENGTH,
  CONNECTION_NAME_PATTERN
} from "@work-shape/catalyst-asset-schemas";
import type { ConnectorTypeOffers } from "@work-shape/catalyst-api-contract";
import { ConfigApiError } from "../api";
import { refuseLinks } from "../asset-folder";
import { formatRefusal } from "../asset-output";
import { UsageError } from "../asset-verbs/support";
import { formatCommandError, isRecord, openInstance, resolveWorkingDir } from "../command-support";
import type { CommandGroup } from "./types";

const help = `Catalogue:
  catalogue list                         Entries and parts this instance offers
  connection init <name> --from <entry> [--part tools|source]
                                         Write connections/<name>/connection.yaml
Options: --instance <name-or-url>, --dir <working-copy-dir>, --json, --help
Init chooses the sole offered part when --part is omitted. It writes locally only,
keeps every operation disabled and unexposed, and never overwrites a file.
Fill in settings, review operations and use connection put to create the Connection.
Secrets are entered on the instance, never in connection.yaml.
`;

type Entry = ConnectorTypeOffers["entries"][number];
type Part = Entry["parts"][number];

export const catalogueGroup: CommandGroup = {
  names: ["catalogue list", "connection init"],
  matches: (argv) => argv[0] === "catalogue" || (argv[0] === "connection" && argv[1] === "init"),
  help,
  run: async (argv, runtime) => {
    try {
      const { values, positionals } = parseArgs({
        args: argv.slice(2),
        options: {
          instance: { type: "string" },
          dir: { type: "string" },
          from: { type: "string" },
          part: { type: "string" },
          json: { type: "boolean" },
          help: { type: "boolean", short: "h" }
        },
        strict: true,
        allowPositionals: true
      });
      if (values.help || (argv[0] === "catalogue" && argv.length === 1)) {
        runtime.stdout(help);
        return 0;
      }
      const lists = argv[0] === "catalogue" && argv[1] === "list";
      const [name] = positionals;
      if (lists) {
        if (positionals.length !== 0 || values.from !== undefined || values.part !== undefined)
          throw new UsageError("Usage: catalyst catalogue list");
      } else if (
        argv[0] !== "connection" ||
        argv[1] !== "init" ||
        positionals.length !== 1 ||
        name === undefined ||
        name.length > CONNECTION_NAME_MAX_LENGTH ||
        !CONNECTION_NAME_PATTERN.test(name) ||
        !values.from ||
        (values.part !== undefined && values.part !== "tools" && values.part !== "source")
      ) {
        throw new UsageError(
          "Usage: catalyst connection init <name> --from <entry> [--part tools|source]"
        );
      }
      const options = { ...runtime, instance: values.instance, dir: values.dir };
      const { api } = await openInstance(options);
      const { entries } = await api.read((client) => client.connections.connector_types());
      if (lists) {
        runtime.stdout(
          values.json
            ? `${JSON.stringify(entries, null, 2)}\n`
            : entries
                .map(
                  (entry) =>
                    `${entry.id}\t${entry.offered ? "offered" : "not offered"}\t${entry.parts.map((part) => part.part).join(", ")}`
                )
                .join("\n") + "\n"
        );
        return 0;
      }
      const entry = entries.find((entry) => entry.id === values.from);
      if (entry === undefined)
        throw new Error(`Unknown catalogue entry '${values.from}'. Run 'catalyst catalogue list'.`);
      if (!entry.offered)
        throw new Error(
          `Catalogue entry '${entry.id}' is not offered by this instance. Ask the operator to name it in catalogue.entries.`
        );
      const part =
        values.part === undefined && entry.parts.length === 1
          ? entry.parts[0]
          : entry.parts.find((part) => part.part === values.part);
      if (part === undefined)
        throw new Error(
          values.part === undefined
            ? `Catalogue entry '${entry.id}': choose --part tools or --part source.`
            : `Catalogue entry '${entry.id}': the '${values.part}' part is not offered on this instance.`
        );
      // The command line checked this before contacting the instance.
      if (name === undefined) throw new UsageError("Missing Connection name.");
      const root = resolveWorkingDir(options);
      const path = join(root, "connections", name, "connection.yaml");
      await refuseLinks(root, false);
      await refuseLinks(join(root, "connections"), false);
      await refuseLinks(dirname(path));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(
        path,
        yaml.dump(definition(entry, part, name), { lineWidth: -1, noRefs: true }),
        { flag: "wx" }
      );
      const settings = part.fields
        .filter(
          (field) => !field.optional && field.setting !== undefined && field.default === undefined
        )
        .map((field) => field.setting);
      runtime.stdout(
        values.json
          ? `${JSON.stringify({ path, settings }, null, 2)}\n`
          : `Wrote ${path}.\n${settings.length ? `Fill in settings: ${settings.join(", ")}.\n` : ""}Review operations, then run 'catalyst connection put ${name} --from ${path} --if-revision new'.\n`
      );
      return 0;
    } catch (error) {
      runtime.stderr(
        `${error instanceof ConfigApiError ? formatRefusal(error) : formatCommandError(error)}\n`
      );
      return error instanceof UsageError ||
        (error instanceof TypeError &&
          "code" in error &&
          String(error.code).startsWith("ERR_PARSE_ARGS"))
        ? 2
        : 1;
    }
  }
};

function definition(entry: Entry, part: Part, name: string) {
  const settings = structuredClone(part.settings);
  for (const field of part.fields) {
    if (field.setting === undefined || field.default === undefined) continue;
    let target = settings;
    const keys = field.setting.split(".");
    const last = keys.pop();
    for (const key of keys) {
      const value = Object.hasOwn(target, key) ? target[key] : undefined;
      const child = isRecord(value) ? value : {};
      Object.defineProperty(target, key, {
        value: child,
        enumerable: true,
        writable: true,
        configurable: true
      });
      target = child;
    }
    if (last !== undefined)
      Object.defineProperty(target, last, {
        value: field.default,
        enumerable: true,
        writable: true,
        configurable: true
      });
  }
  return {
    name,
    displayName: name,
    service: entry.service,
    catalogue: { entry: entry.id, part: part.part, version: entry.version },
    connectorType: part.connectorType,
    authScheme: part.authScheme,
    credentialMode: "shared",
    settings,
    operations: part.operations.map((operation) => ({
      ...operation.declaration,
      name: operation.name,
      effect: operation.effect,
      exposure: [],
      enabled: false
    })),
    enabled: true,
    origin: "runtime"
  };
}
