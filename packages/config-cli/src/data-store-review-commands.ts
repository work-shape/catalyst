import { parseArgs } from "node:util";
import yaml from "js-yaml";
import { apiOperations } from "@work-shape/catalyst-api-contract";
import {
  formatCommandError,
  openInstance,
  writeError,
  writeOutput,
  type ConfigCommandOptions
} from "./command-support";
import { call } from "./operation-commands";

// The faces of "Prüfen" on a store's page: the fields that wait for a person, and a person's
// decision on one. Rights, the citation check and the audit stay in the instance.

export const dataStoreReviewHelpText = `Data Store review (the fields of records that wait for a person):
  data-store review list <store> [--table <name>] [--cursor <cursor>] [--limit <n>]
  data-store review decide <store> --table <name> --key <key> --field <name> --action confirm|correct|assign [--value <json>] [--knowledge-base <id> --document <id>]
list prints one page of candidates, each with its reason and the document and page it cites; follow nextCursor for the next page.
A candidate's value is what its document reads; a corrected one also prints correctedValue, the person's value, with decidedBy, decidedByName and decidedAt.
decide confirms a candidate, corrects it to --value (read as JSON, otherwise as text), or assigns the cited document to the object --key.
Where the candidates of a field disagree, name the document you decide with --knowledge-base and --document. assign always needs both.
Options: --instance <url-or-name>, --dir <working-copy>, --json, --help
`;

const ACTIONS = ["confirm", "correct", "assign"] as const;
type Action = (typeof ACTIONS)[number];

const isAction = (value: string | undefined): value is Action =>
  ACTIONS.some((action) => action === value);

/** A value as typed: JSON where it reads as JSON, so `150` is a number and `"150"` text. */
function valueOf(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function runDataStoreReviewCommand(
  argv: readonly string[],
  base: ConfigCommandOptions
): Promise<number> {
  try {
    const command = argv[2];
    const { values, positionals } = parseArgs({
      args: argv.slice(3),
      options: {
        instance: { type: "string" },
        dir: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        table: { type: "string" },
        cursor: { type: "string" },
        limit: { type: "string" },
        key: { type: "string" },
        field: { type: "string" },
        action: { type: "string" },
        value: { type: "string" },
        "knowledge-base": { type: "string" },
        document: { type: "string" }
      },
      allowPositionals: true,
      strict: true
    });
    if (values.help || command === undefined) {
      writeOutput(base, dataStoreReviewHelpText);
      return 0;
    }
    if (command !== "list" && command !== "decide")
      throw new Error("Unknown review command. See 'catalyst data-store review --help'.");
    const [store] = positionals;
    if (!store || positionals.length !== 1) throw new Error("Name exactly one Data Store.");
    const citation = values["knowledge-base"] ?? values.document;
    if (citation !== undefined && (!values["knowledge-base"] || !values.document))
      throw new Error("Pass --knowledge-base <id> and --document <id> together.");
    const options = { ...base, instance: values.instance, dir: values.dir };
    let result: unknown;
    if (command === "list") {
      const limit = values.limit === undefined ? undefined : Number(values.limit);
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
        throw new Error("Pass --limit as a whole number above 0.");
      const { api } = await openInstance(options);
      result = await call(api, apiOperations["data_stores.records_flagged"], {
        params: { store },
        query: {
          ...(values.table ? { table: values.table } : {}),
          ...(values.cursor ? { cursor: values.cursor } : {}),
          ...(limit === undefined ? {} : { limit })
        }
      });
    } else {
      const { table, key, field, action } = values;
      if (!table || !key || !field) throw new Error("Pass --table, --key and --field.");
      if (!isAction(action)) throw new Error("Pass --action confirm, correct or assign.");
      if (action === "correct" && values.value === undefined)
        throw new Error("Pass the corrected value with --value.");
      if (action !== "correct" && values.value !== undefined)
        throw new Error("--value belongs to --action correct.");
      if (action === "assign" && citation === undefined)
        throw new Error("assign names the document: pass --knowledge-base and --document.");
      const { api } = await openInstance(options);
      result = await call(api, apiOperations["data_stores.records_decide"], {
        params: { store },
        body: {
          table,
          key,
          field,
          action,
          ...(values.value === undefined ? {} : { value: valueOf(values.value) }),
          ...(values["knowledge-base"] && values.document
            ? { knowledgeBaseId: values["knowledge-base"], documentId: values.document }
            : {})
        }
      });
    }
    writeOutput(
      options,
      values.json
        ? JSON.stringify(result, null, 2)
        : yaml.dump(result, { lineWidth: -1, noRefs: true }).trimEnd()
    );
    return 0;
  } catch (error) {
    writeError(base, formatCommandError(error));
    return 1;
  }
}
