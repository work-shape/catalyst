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

// The test copy of a store (ADR-0031): the scratch database a draft's calls reach, built from
// the draft's migrations and seed files. Rights and the audit stay in the instance.

export const dataStoreTestCopyHelpText = `Data Store test copy (the scratch database a draft of the store reaches):
  data-store test-copy reset <store>
  data-store test-copy delete <store>
reset drops the copy and builds it again from the draft's migrations and seed/ files; it prints the copy's level, seed files and size.
delete drops it until a draft's next changing call to the store makes it again.
Both need data_store.write on the store. The copy never holds a live row.
Options: --instance <url-or-name>, --dir <working-copy>, --json, --help
`;

export async function runDataStoreTestCopyCommand(
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
        help: { type: "boolean", short: "h" }
      },
      allowPositionals: true,
      strict: true
    });
    if (values.help || command === undefined) {
      writeOutput(base, dataStoreTestCopyHelpText);
      return 0;
    }
    if (command !== "reset" && command !== "delete")
      throw new Error("Unknown test-copy command. See 'catalyst data-store test-copy --help'.");
    const [store] = positionals;
    if (!store || positionals.length !== 1) throw new Error("Name exactly one Data Store.");
    const options = { ...base, instance: values.instance, dir: values.dir };
    const { api } = await openInstance(options);
    const result = await call(
      api,
      apiOperations[
        command === "reset" ? "data_stores.test_copy_reset" : "data_stores.test_copy_delete"
      ],
      { params: { store } }
    );
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
