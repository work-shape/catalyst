import { parseArgs } from "node:util";
import yaml from "js-yaml";
import { apiOperations } from "@work-shape/catalyst-api-contract";
import { z } from "zod";
import {
  isRecord,
  openInstance,
  writeError,
  writeOutput,
  formatCommandError,
  type ConfigCommandOptions
} from "./command-support";
import { call } from "./operation-commands";

export const knowledgeHelpText = `Knowledge Base sources (draft changes take effect at publish):
  knowledge-base source add <kb> --source <id> --connection <name> --folder <id>... [--include <glob>...] [--exclude <glob>...]
  knowledge-base source list <kb>
  knowledge-base source remove <kb> --source <id>
  knowledge-base sync <kb> --source <id> [--full] [--confirm]
  knowledge-base source status <kb> [--source <id>]
  knowledge-base source retry <kb> --source <id> (--item <id>... | --code <code> | --all)
  knowledge-base reindex <kb> [--confirm <token>]
Sync answers its Operation Run immediately. Change-feed sync is not supported yet; use --full.
A first import above 10,000 items stops there and waits; source status shows its count, size
and estimated cost, and sync --confirm lets it go on (needs the right to publish).
Narrowing and removal may be saved as drafts; publishing them is not supported yet.
Reindex embeds every passage again with the model the Knowledge Base is set to. Without
--confirm it states the passages, tokens and cost and starts nothing; search keeps answering
from the old index until the new one is complete.
Options: --instance <url-or-name>, --dir <working-copy>, --json, --help
`;
export async function runKnowledgeCommand(
  argv: readonly string[],
  base: ConfigCommandOptions
): Promise<number> {
  try {
    const source = argv[1] === "source";
    const command = source ? argv[2] : argv[1];
    // `sync --confirm` takes no value; `reindex --confirm <token>` takes the statement's token.
    const confirmSync = command === "sync" && argv.includes("--confirm");
    const parsed = parseArgs({
      args: argv.slice(source ? 3 : 2).filter((arg) => !(confirmSync && arg === "--confirm")),
      options: {
        instance: { type: "string" },
        dir: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        source: { type: "string" },
        connection: { type: "string" },
        folder: { type: "string", multiple: true },
        include: { type: "string", multiple: true },
        exclude: { type: "string", multiple: true },
        full: { type: "boolean" },
        item: { type: "string", multiple: true },
        code: { type: "string" },
        all: { type: "boolean" },
        confirm: { type: "string" }
      },
      allowPositionals: true,
      strict: true
    });
    const { values, positionals } = parsed;
    if (values.help) {
      writeOutput(base, knowledgeHelpText);
      return 0;
    }
    const [name] = positionals;
    if (!name || positionals.length !== 1) throw new Error("Name exactly one Knowledge Base.");
    if (
      !command ||
      !(source ? ["add", "list", "remove", "status", "retry"] : ["sync", "reindex"]).includes(
        command
      )
    )
      throw new Error("Unknown Knowledge Base source command.");
    if (["add", "remove", "retry", "sync"].includes(command) && !values.source)
      throw new Error("Pass --source <id>.");
    const options = { ...base, instance: values.instance, dir: values.dir };
    const { api } = await openInstance(options);
    let result: unknown;
    if (command === "reindex")
      return await reindex(api, name, values.confirm, options, values.json);
    if (command === "add" || command === "remove" || command === "list") {
      const asset = await api.getAsset("knowledge_base", name);
      if (!asset) throw new Error("The Knowledge Base is not available.");
      const config = z.record(z.string(), z.unknown()).parse(asset.config);
      const sources = z.array(z.record(z.string(), z.unknown())).parse(config.sources ?? []);
      if (command === "list") result = sources;
      else {
        const remaining = sources.filter((s) => s.id !== values.source);
        if (command === "add") {
          if (sources.some((s) => s.id === values.source))
            throw new Error(
              "The source id already exists; remove its draft entry before adding a replacement."
            );
          if (!values.connection || !values.folder?.length)
            throw new Error("Pass --connection <name> and --folder <id>.");
          remaining.push({
            id: values.source,
            connection: values.connection,
            folders: values.folder,
            ...(values.include ? { include: values.include } : {}),
            ...(values.exclude ? { exclude: values.exclude } : {})
          });
        } else if (remaining.length === sources.length)
          throw new Error("The source id is not in the draft.");
        result = await call(api, apiOperations["assets.put"], {
          params: { kind: "knowledge_base", name },
          body: { config: { ...config, sources: remaining }, expectedRevision: asset.revision }
        });
      }
    } else if (command === "sync")
      result = await call(api, apiOperations["knowledge_bases.sync"], {
        params: { knowledgeBase: name },
        body: {
          source: values.source,
          ...(values.full ? { mode: "full" } : {}),
          ...(confirmSync ? { confirm: true } : {})
        }
      });
    else if (command === "status") {
      const output = await call(api, apiOperations["knowledge_bases.sources"], {
        params: { knowledgeBase: name }
      });
      const parsed = z
        .object({ sources: z.array(z.object({ id: z.string() }).passthrough()) })
        .parse(output);
      result = {
        sources: values.source
          ? parsed.sources.filter((s) => s.id === values.source)
          : parsed.sources
      };
    } else {
      if (
        Number(Boolean(values.item?.length)) +
          Number(Boolean(values.code)) +
          Number(Boolean(values.all)) !==
        1
      )
        throw new Error("Choose exactly one of --item, --code or --all.");
      result = await call(api, apiOperations["knowledge_bases.retry_documents"], {
        params: { knowledgeBase: name },
        body: {
          source: values.source,
          ...(values.item
            ? { sourceItemIds: values.item }
            : values.code
              ? { failureCode: values.code }
              : { all: true })
        }
      });
    }
    let exit = 0;
    if (isRecord(result) && isRecord(result.run)) {
      // A run that goes on, or one done at once, as a confirmation of a Workflow's import is.
      exit = result.run.status === "running" || result.run.status === "done" ? 0 : 3;
      result = result.run;
    } else if (isRecord(result) && result.status === "done") result = result.output;
    writeOutput(
      options,
      values.json
        ? JSON.stringify(result, null, 2)
        : yaml.dump(result, { lineWidth: -1, noRefs: true }).trimEnd()
    );
    return exit;
  } catch (error) {
    writeError(base, formatCommandError(error));
    return 1;
  }
}

const reindexAnswerSchema = z
  .object({
    started: z.boolean(),
    state: z.string(),
    active: z.object({ model: z.string() }).passthrough().optional(),
    target: z.object({ model: z.string() }).passthrough().optional(),
    progress: z.object({ embedded: z.number(), total: z.number() }).optional(),
    statement: z.object({ confirmation: z.string(), room: z.boolean() }).passthrough().optional(),
    lines: z.array(z.string()).optional()
  })
  .passthrough();

/**
 * `knowledge-base reindex`: the statement first, then a start with its confirmation. A
 * statement is an answer, so it exits 0 too; `--json` says whether it `started`.
 */
async function reindex(
  api: Awaited<ReturnType<typeof openInstance>>["api"],
  name: string,
  confirm: string | undefined,
  options: ConfigCommandOptions,
  json: boolean | undefined
): Promise<number> {
  const raw = await call(api, apiOperations["knowledge_bases.reindex"], {
    params: { knowledgeBase: name },
    body: confirm ? { confirm } : {}
  });
  const answer = reindexAnswerSchema.parse(
    isRecord(raw) && raw.status === "done" && "output" in raw ? raw.output : raw
  );
  const waits = !answer.started && answer.statement !== undefined;
  if (json) {
    writeOutput(options, JSON.stringify(answer, null, 2));
    return 0;
  }
  const progress = answer.progress
    ? ` (${answer.progress.embedded} of ${answer.progress.total} passages)`
    : "";
  const lines = answer.started
    ? [
        ...(answer.lines ?? []),
        `Re-index started${progress}. Search answers from the old index until it switches.`
      ]
    : waits
      ? [
          ...(answer.lines ?? []),
          ...(confirm
            ? ["The confirmation no longer matches: the statement above is current."]
            : []),
          ...(answer.statement?.room
            ? [
                `Start it with: catalyst knowledge-base reindex ${name} --confirm ${answer.statement.confirmation}`
              ]
            : [])
        ]
      : [
          answer.state === "reindexing"
            ? `A re-index to ${answer.target?.model ?? "the set model"} is under way${progress}.`
            : answer.state === "current"
              ? `Search already answers with ${answer.active?.model ?? "the set model"}; nothing to re-index.`
              : "Nothing is embedded yet; the first documents are embedded with the set model."
        ];
  writeOutput(options, lines.join("\n"));
  return 0;
}
