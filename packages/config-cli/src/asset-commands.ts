import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  MAX_LIST_LIMIT,
  type AssetSummary,
  type ConfigAssetRevision,
  type PlatformContext
} from "@work-shape/catalyst-api-contract";
import type { OperationOutcome } from "@work-shape/catalyst-api-client";
import { ConfigApiError, type ConfigApi } from "./api";
import {
  APP_VERBS,
  AppUsageError,
  isAppVerb,
  runAppCommand,
  type AppCommandOptions
} from "./app-commands";
import { readAssetSource } from "./asset-sources";
import { runFollowCommand } from "./follow-commands";
import {
  formatAsset,
  formatAssetList,
  formatContext,
  formatDryRun,
  formatHistory,
  formatKinds,
  formatRefusal,
  formatReferences,
  formatWarnings,
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
import { askBeforePublish, waitingPublishLine } from "./publish-question";

// `catalyst context`, `kinds`, `references` and `catalyst <kind> <verb>`: one command per
// operation of the instance, for every kind it registers. A command reads its arguments, sends
// the one call and prints the answer; the instance decides every right, revision and check,
// and its refusal is printed as it gave it.

type AssetKind = PlatformContext["kinds"][number];

/** Exit codes. A call that waits for somebody else's approval changed nothing yet. */
const EXIT = { done: 0, refused: 1, usage: 2, pending: 3 } as const;

const OPTIONS = {
  instance: { type: "string" },
  dir: { type: "string" },
  json: { type: "boolean", default: false },
  workspace: { type: "string" },
  prefix: { type: "string" },
  text: { type: "string" },
  revision: { type: "string" },
  files: { type: "boolean", default: false },
  from: { type: "string" },
  "if-revision": { type: "string" },
  to: { type: "string" },
  mode: { type: "string" },
  personal: { type: "boolean", default: false },
  "available-in": { type: "string", multiple: true },
  none: { type: "boolean", default: false },
  field: { type: "string" },
  asset: { type: "string" },
  confirm: { type: "string" },
  yes: { type: "boolean", default: false },
  withdraw: { type: "string" },
  published: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false }
} as const;

function parseCommandLine(args: string[]) {
  return parseArgs({ args, options: OPTIONS, allowPositionals: true, strict: true });
}

type Values = ReturnType<typeof parseCommandLine>["values"];
type OptionName = keyof typeof OPTIONS;

interface Session {
  api: ConfigApi;
  kind: AssetKind;
  values: Values;
  /** The workspace the call addresses. Left out, it addresses the instance's own assets. */
  scope: { workspaceId?: string };
  options: ConfigCommandOptions;
}

/**
 * What a command line asks. `prepare` reads and checks the arguments before anything is sent,
 * and answers the call to make once the instance is reached.
 */
interface Verb {
  usage: string;
  summary: string;
  /** Whether the verb names one asset. */
  named: boolean;
  /** Options beside `--instance`, `--dir`, `--workspace` and `--json`. */
  flags: readonly OptionName[];
  prepare(values: Values, name: string, cwd: string): (session: Session) => Promise<number>;
}

const COMMON_FLAGS: readonly OptionName[] = ["instance", "dir", "workspace", "json", "help"];

const VERBS: Record<string, Verb> = {
  list: {
    usage: "list [--prefix <text>] [--text <text>]",
    summary: "List the assets of the kind you may read (assets.list)",
    named: false,
    flags: ["prefix", "text"],
    prepare: (values) => async (session) => {
      const items: AssetSummary[] = [];
      let cursor: string | undefined;
      do {
        const page = await session.api.read((client) =>
          client.assets.list({
            params: { kind: session.kind.kind },
            query: {
              limit: MAX_LIST_LIMIT,
              ...session.scope,
              ...(values.prefix === undefined ? {} : { prefix: values.prefix }),
              ...(values.text === undefined ? {} : { text: values.text }),
              ...(cursor === undefined ? {} : { cursor })
            }
          })
        );
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      return print(session, items, () => formatAssetList(session.kind, items));
    }
  },
  show: {
    usage: "show <name> [--revision draft|published|<n>] [--files]",
    summary: "Print one asset, or one revision of it (assets.get)",
    named: true,
    flags: ["revision", "files"],
    prepare: (values, name) => async (session) => {
      const asset = await session.api.read((client) =>
        client.assets.get({
          params: { kind: session.kind.kind, name },
          query: {
            ...session.scope,
            ...(values.revision === undefined ? {} : { revision: values.revision }),
            ...(values.files ? { files: "true" as const } : {})
          }
        })
      );
      return print(session, asset, () => formatAsset(asset));
    }
  },
  history: {
    usage: "history <name>",
    summary: "List the revisions of one asset, newest first (assets.revisions.list)",
    named: true,
    flags: [],
    prepare: (_values, name) => async (session) => {
      const revisions: ConfigAssetRevision[] = [];
      let cursor: string | undefined;
      do {
        const page = await session.api.read((client) =>
          client.assets.revisions.list({
            params: { kind: session.kind.kind, name },
            query: {
              limit: MAX_LIST_LIMIT,
              ...session.scope,
              ...(cursor === undefined ? {} : { cursor })
            }
          })
        );
        revisions.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      return print(session, revisions, () => formatHistory(revisions));
    }
  },
  validate: {
    usage: "validate --from <file-or-folder>",
    summary:
      "Check a definition against the instance without writing it (assets.validate); a folder of files is checked against the limits of one write",
    named: false,
    flags: ["from"],
    prepare: (values, _name, cwd) => {
      const from = fromPath(values, cwd, "--from <file-or-folder>");
      return async (session) => {
        // What put reads, validate reads. The instance checks a definition without writing
        // it; the files of a kind whose revision holds files it checks only as it writes them.
        const source = await readAssetSource(from, session.kind.representation);
        if ("files" in source) return filesRead(session, from, source.files.length);
        const result = await session.api.read((client) =>
          client.assets.validate({
            params: { kind: session.kind.kind },
            body: { config: source.config, ...session.scope }
          })
        );
        writeOutput(
          session.options,
          session.values.json
            ? JSON.stringify(result, null, 2)
            : result.valid
              ? ["Valid.", ...formatWarnings(result.warnings ?? [])].join("\n")
              : [
                  "Not valid:",
                  ...result.issues.map(
                    (issue) =>
                      `- ${issue.path?.length ? `${issue.path.join(".")}: ` : ""}${issue.message}`
                  )
                ].join("\n")
        );
        return result.valid ? EXIT.done : EXIT.refused;
      };
    }
  },
  put: {
    usage: "put <name> --from <file-or-folder> --if-revision <n|new>",
    summary:
      "Create an asset (--if-revision new) or replace it at the revision you read (assets.put)",
    named: true,
    flags: ["from", "if-revision"],
    prepare: (values, name, cwd) => {
      const expectedRevision = ifRevision(values["if-revision"], true);
      const from = fromPath(values, cwd, "--from <file-or-folder>");
      return async (session) => {
        const source = await readAssetSource(from, session.kind.representation);
        if ("config" in source && source.config.name !== undefined && source.config.name !== name) {
          throw new UsageError(
            `The definition names '${String(source.config.name)}', and the command '${name}'.`
          );
        }
        const body =
          "config" in source
            ? { config: { ...source.config, name }, expectedRevision, ...session.scope }
            : { files: source.files, expectedRevision, ...session.scope };
        const outcome = await session.api.change(
          (client, idempotencyKey) =>
            client.assets.put({ params: { kind: session.kind.kind, name }, body, idempotencyKey }),
          `It may have been written: run 'catalyst ${kindNoun(session.kind)} show ${name}' before sending it again.`
        );
        return settle(session, outcome, (output) => [
          `Wrote ${session.kind.kind} '${name}' at revision ${output.revision}.${session.kind.lifecycle === "draft_published" ? " It is a draft until it is published." : ""}`,
          ...formatWarnings(output.warnings)
        ]);
      };
    }
  },
  publish: {
    usage: "publish <name> --revision <n> [--confirm <blocked>]",
    summary:
      "Make one revision the one its users are served (assets.publish). A guardrail shows its dry run first; an App or a Workflow asks you first",
    named: true,
    flags: ["revision", "confirm", "yes"],
    prepare: (values, name) => {
      const revision = revisionNumber(required(values.revision, "--revision <n>"));
      return async (session) => {
        if (session.kind.kind === GUARDRAIL_KIND) {
          const proceed = await guardrailDryRunBeforePublish(session, name, revision);
          if (proceed !== undefined) return proceed;
        } else if (values.confirm !== undefined) {
          throw new UsageError("--confirm answers the dry run of a guardrail's publish.");
        }
        let unattended = false;
        if (session.kind.actions.approve !== undefined) {
          const asked = {
            kind: session.kind.kind,
            command: kindNoun(session.kind),
            name,
            revision
          };
          const answer = await askBeforePublish(session.options, { ...asked, yes: values.yes });
          if (answer === "refused") return EXIT.refused;
          unattended = answer === "unattended";
        } else if (values.yes) {
          throw new UsageError(
            `A ${session.kind.kind} is published without a question; --yes answers none.`
          );
        }
        const outcome = await session.api.change(
          (client, idempotencyKey) =>
            client.assets.publish({
              params: { kind: session.kind.kind, name },
              body: { revision, ...session.scope },
              idempotencyKey,
              ...(unattended ? { unattended } : {})
            }),
          "It may have been applied: run 'show' before sending it again."
        );
        return settle(
          session,
          outcome,
          (output) => [
            `Published revision ${output.publishedRevision} of ${session.kind.kind} '${name}'${output.replacedRevision === undefined ? "" : ` in place of revision ${output.replacedRevision}`}.`
          ],
          session.kind.actions.approve === undefined
            ? undefined
            : "If you are an instance approver, you can approve it in the Inbox."
        );
      };
    }
  },
  test: {
    usage:
      "test <name> [--revision <n>] (--text <content> [--field <field>] | --from <file> [--field <field>] | --asset <kind>:<name>[@<n>])",
    summary:
      "Check a guardrail's draft, or one revision, on sample content or on an asset; keeps no hit (guardrails.test)",
    named: true,
    flags: ["revision", "text", "from", "field", "asset"],
    prepare: (values, name, cwd) => {
      const revision = values.revision === undefined ? undefined : revisionNumber(values.revision);
      const given = [values.text, values.from, values.asset].filter((value) => value !== undefined);
      if (given.length !== 1) {
        throw new UsageError("Give the content to check: one of --text, --from or --asset.");
      }
      if (values.asset !== undefined && values.field !== undefined) {
        throw new UsageError("--field names a field of sample content, not of an asset.");
      }
      const asset = values.asset === undefined ? undefined : assetReference(values.asset);
      return async (session) => {
        requireGuardrail(session, "test");
        const text =
          values.from === undefined
            ? values.text
            : await readFile(fromPath(values, cwd, "--from <file>"), "utf8");
        const body = {
          ...(revision === undefined ? {} : { revision }),
          ...(asset ? { asset } : { sample: { [values.field ?? "content"]: text ?? "" } })
        };
        const answer = await session.api.read((client) =>
          client.guardrails.test({ params: { name }, body })
        );
        return print(session, answer, () =>
          [
            `Revision ${answer.revision} of guardrail '${name}' on '${answer.event}': ${answer.outcome}${answer.reason === "" ? "" : ` (${answer.reason})`}.`,
            ...(answer.appliesToAsset === false
              ? ["Its filter does not take this asset: where it enforces, it would not check it."]
              : []),
            "Nothing was kept: a test records no hit."
          ].join("\n")
        );
      };
    }
  },
  "dry-run": {
    usage: "dry-run <name> [--revision <n>]",
    summary:
      "Count what a guardrail's draft, or one revision, would have answered in the last 14 days, without names (guardrails.dry_run)",
    named: true,
    flags: ["revision"],
    prepare: (values, name) => {
      const revision = values.revision === undefined ? undefined : revisionNumber(values.revision);
      return async (session) => {
        requireGuardrail(session, "dry-run");
        const answer = await guardrailDryRun(session, name, revision);
        return print(session, answer, () => formatDryRun(name, answer));
      };
    }
  },
  unpublish: {
    usage: "unpublish <name>",
    summary: "Stop a published guardrail from enforcing; its draft stays (guardrails.unpublish)",
    named: true,
    flags: [],
    prepare: (_values, name) => async (session) => {
      requireGuardrail(session, "unpublish");
      const outcome = await session.api.change(
        (client, idempotencyKey) =>
          client.guardrails.unpublish({ params: { name }, idempotencyKey }),
        "It may have been applied: run 'show' before sending it again."
      );
      return settle(session, outcome, (output) => [
        `Guardrail '${name}' no longer enforces: revision ${output.unpublishedRevision} was taken back. Its draft is at revision ${output.draftRevision}.`
      ]);
    }
  },
  "discard-draft": {
    usage: "discard-draft <name> --if-revision <n>",
    summary: "Move the draft back to the published revision (assets.discard_draft)",
    named: true,
    flags: ["if-revision"],
    prepare: (values, name) => {
      const expectedRevision = ifRevision(values["if-revision"], false);
      return async (session) => {
        const outcome = await session.api.change(
          (client, idempotencyKey) =>
            client.assets.discard_draft({
              params: { kind: session.kind.kind, name },
              body: { expectedRevision, ...session.scope },
              idempotencyKey
            }),
          "It may have been applied: run 'show' before sending it again."
        );
        return settle(session, outcome, (output) => [
          `The draft of ${session.kind.kind} '${name}' is revision ${output.draftRevision} again.`
        ]);
      };
    }
  },
  delete: {
    usage: "delete <name> --if-revision <n>",
    summary: "Delete one asset and keep its revisions (assets.delete)",
    named: true,
    flags: ["if-revision"],
    prepare: (values, name) => {
      const expectedRevision = ifRevision(values["if-revision"], false);
      return async (session) => {
        const outcome = await session.api.change(
          (client, idempotencyKey) =>
            client.assets.delete({
              params: { kind: session.kind.kind, name },
              body: { expectedRevision, ...session.scope },
              idempotencyKey
            }),
          "It may have been applied: run 'history' before sending it again."
        );
        return settle(session, outcome, (output) => [
          `Deleted ${session.kind.kind} '${name}'; its delete is revision ${output.revision}.`,
          ...formatWarnings(output.warnings)
        ]);
      };
    }
  },
  revert: {
    usage: "revert <name> --to <n> --if-revision <n>",
    summary: "Make an earlier revision the content again (assets.revert)",
    named: true,
    flags: ["to", "if-revision"],
    prepare: (values, name) => {
      const revision = revisionNumber(required(values.to, "--to <n>"));
      const expectedRevision = ifRevision(values["if-revision"], false);
      return async (session) => {
        const outcome = await session.api.change(
          (client, idempotencyKey) =>
            client.assets.revert({
              params: { kind: session.kind.kind, name },
              body: { revision, expectedRevision, ...session.scope },
              idempotencyKey
            }),
          "It may have been applied: run 'history' before sending it again."
        );
        return settle(session, outcome, (output) => [
          `Reverted ${session.kind.kind} '${name}' to the content of revision ${revision}; it is revision ${output.revision} now.`,
          ...formatWarnings(output.warnings)
        ]);
      };
    }
  },
  "set-availability": {
    usage:
      "set-availability <name> --mode all|selected [--personal] [--available-in <workspace-id>]...",
    summary: "Set the workspaces one asset is offered in (assets.set_availability)",
    named: true,
    flags: ["mode", "personal", "available-in"],
    prepare: (values, name) => {
      const { mode } = values;
      if (mode !== "all" && mode !== "selected") {
        throw new UsageError("--mode is 'all' or 'selected'.");
      }
      const body = {
        mode: mode === "all" ? ("all" as const) : ("selected" as const),
        personalWorkspaces: values.personal,
        collaborationWorkspaceIds: values["available-in"] ?? []
      };
      return async (session) => {
        const outcome = await session.api.change(
          (client, idempotencyKey) =>
            client.assets.set_availability({
              params: { kind: session.kind.kind, name },
              body,
              idempotencyKey
            }),
          "It may have been applied: run 'show' before sending it again."
        );
        return settle(session, outcome, (output) => [
          `${session.kind.kind} '${name}' is offered in ${output.mode === "all" ? "every workspace" : `${output.personalWorkspaces ? "personal workspaces and " : ""}${output.collaborationWorkspaceIds.length} shared workspaces`}.`
        ]);
      };
    }
  },
  "set-default": {
    usage: "set-default <name> | set-default --none",
    summary: "Set or clear the instance's default asset of the kind (assets.set_default)",
    named: false,
    flags: ["none"],
    prepare: (values, name) => {
      if (values.none === (name !== "")) {
        throw new UsageError("Name the asset, or pass --none to clear the default.");
      }
      const chosen = values.none ? null : name;
      return async (session) => {
        const outcome = await session.api.change(
          (client, idempotencyKey) =>
            client.assets.set_default({
              params: { kind: session.kind.kind },
              body: { name: chosen },
              idempotencyKey
            }),
          "It may have been applied: run 'list' before sending it again."
        );
        return settle(session, outcome, () => [
          chosen === null
            ? `The instance has no default ${session.kind.kind} now.`
            : `'${chosen}' is the instance's default ${session.kind.kind} now.`
        ]);
      };
    }
  }
};

const GUARDRAIL_KIND = "guardrail";

function requireGuardrail(session: Session, verb: string): void {
  if (session.kind.kind !== GUARDRAIL_KIND) {
    throw new UsageError(`'${verb}' is a command of guardrails only.`);
  }
}

/** `--asset <kind>:<name>[@<n>]`: the asset a test reads, at its live revision unless named. */
function assetReference(value: string): { kind: string; name: string; revision?: number } {
  const match = /^([a-z][a-z0-9_-]*):([^@]+)(?:@(\d+))?$/u.exec(value);
  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new UsageError(`'${value}' names no asset: write <kind>:<name>, or <kind>:<name>@<n>.`);
  }
  return {
    kind: match[1].replaceAll("-", "_"),
    name: match[2],
    ...(match[3] === undefined ? {} : { revision: revisionNumber(match[3]) })
  };
}

function guardrailDryRun(session: Session, name: string, revision: number | undefined) {
  return session.api.read((client) =>
    client.guardrails.dry_run({
      params: { name },
      body: revision === undefined ? {} : { revision }
    })
  );
}

/**
 * The dry run a guardrail's publish shows first. A first publish of a guardrail that stops
 * actions (it blocks or holds them for an approval) goes ahead only with `--confirm` naming
 * the actions it would have stopped and those it could not check: a dry run that checked
 * nothing does not say that the guardrail stops nothing. Answers an exit code where the
 * publish stops here, and nothing where it goes ahead.
 */
async function guardrailDryRunBeforePublish(
  session: Session,
  name: string,
  revision: number
): Promise<number | undefined> {
  const answer = await guardrailDryRun(session, name, revision);
  if (!session.values.json) writeError(session.options, formatDryRun(name, answer));
  const stops = answer.outcome === "block" || answer.outcome === "require_approval";
  const stopped = answer.wouldBlock.actions + answer.wouldRequireApproval.actions;
  const unchecked = stops ? answer.notEvaluable : 0;
  const named = stopped + unchecked;
  const confirmed = session.values.confirm;
  if (answer.published || named === 0) {
    if (confirmed !== undefined) {
      throw new UsageError(
        "--confirm answers a first publish that would stop actions or could not check them, and this is none."
      );
    }
    return undefined;
  }
  if (confirmed === String(named)) return undefined;
  const actions = (count: number) => `${count} action${count === 1 ? "" : "s"}`;
  const what = `${actions(stopped)} it would have stopped${unchecked > 0 ? ` and ${actions(unchecked)} it could not check` : ""}`;
  writeError(
    session.options,
    confirmed === undefined
      ? `This first publish acts on ${what} in the last ${answer.days} days. Publish it with --confirm ${named}, or publish a draft with the outcome 'warn' first.`
      : `--confirm ${confirmed} does not name the ${named}: ${what}. Nothing was published.`
  );
  return EXIT.refused;
}

/** The options of the App commands beside the common ones. */
const APP_FLAGS = {
  pull: ["revision", "published"],
  push: [],
  publish: ["revision", "yes"],
  status: []
} as const satisfies Record<keyof typeof APP_VERBS, readonly OptionName[]>;

/** The words before the kind that are commands of their own. */
const INSTANCE_COMMANDS = ["context", "kinds", "references", "operation", "requests"] as const;

/** Runs `catalyst <argv>` for every command but `config`. */
export async function runAssetCommand(
  argv: readonly string[],
  base: Omit<AppCommandOptions, "dir" | "instance">
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
  const options: AppCommandOptions = {
    ...base,
    ...(values.dir === undefined ? {} : { dir: values.dir }),
    ...(values.instance === undefined ? {} : { instance: values.instance })
  };
  const instanceCommand = INSTANCE_COMMANDS.find((command) => command === noun);
  const [verbName = "", name = "", ...extra] = positionals;
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
      } else if (positionals.length > 0) {
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
      return await runInstanceCommand(instanceCommand, values, options, name);
    }
    if ((noun === "app" || noun === "apps") && isAppVerb(verbName)) {
      refuseFlags(values, [...COMMON_FLAGS, ...APP_FLAGS[verbName]], verbName);
      return await runAppCommand(verbName, positionals.slice(1), values, options);
    }
    const verb = VERBS[verbName];
    if (verb === undefined) throw new UsageError(`Unknown command '${noun} ${verbName}'.`);
    refuseFlags(values, [...COMMON_FLAGS, ...verb.flags], verbName);
    if (verb.named && name === "") throw new UsageError(`Usage: catalyst ${noun} ${verb.usage}`);
    if (extra.length > 0 || (!verb.named && verbName !== "set-default" && name !== "")) {
      throw new UsageError(`Unexpected argument '${extra[0] ?? name}'.`);
    }
    const call = verb.prepare(values, name, options.cwd);
    const { api, workspace } = await openInstance(options);
    const context = await api.read((client) => client.platform.context.get());
    const workspaceId = values.workspace ?? workspace;
    return await call({
      api,
      kind: findKind(context.kinds, noun),
      values,
      scope: workspaceId === undefined ? {} : { workspaceId },
      options
    });
  } catch (error) {
    if (error instanceof UsageError || error instanceof AppUsageError) {
      writeError(options, error.message);
      return EXIT.usage;
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
  if (command === "references") {
    const references = await api.read((client) => client.platform.references.get());
    out(references, () => formatReferences(references));
  } else {
    const context = await api.read((client) => client.platform.context.get());
    if (command === "kinds") out(context.kinds, () => formatKinds(context.kinds));
    else out(context, () => formatContext(context));
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

/** What `validate` says of a folder of files: read, within one write, not yet checked. */
function filesRead(session: Session, from: string, files: number): number {
  const noun = kindNoun(session.kind);
  const draft = session.kind.lifecycle === "draft_published" ? " as a draft" : "";
  return print(session, { files, checkedByInstance: false }, () =>
    [
      `Read ${files} files from '${from}', within what one write carries.`,
      `The instance checks the files of a ${session.kind.kind} as it writes them: 'catalyst ${noun} put <name> --from ${from} --if-revision <n|new>' writes them${draft}.`
    ].join("\n")
  );
}

/** Prints what a changing call answered, or that it waits and has changed nothing yet. */
function settle<Output>(
  session: Session,
  outcome: OperationOutcome<Output, { id: string; status?: string; approvalRequestId?: string }>,
  lines: (output: Output) => string[],
  approvalHint?: string
): number {
  if (outcome.status === "pending_approval") {
    const text = waitingPublishLine(outcome.run, approvalHint);
    if (session.values.json)
      writeOutput(
        session.options,
        JSON.stringify({ status: "pending_approval", run: outcome.run }, null, 2)
      );
    else writeError(session.options, text);
    return EXIT.pending;
  }
  if (session.values.json) writeOutput(session.options, JSON.stringify(outcome.output, null, 2));
  else writeOutput(session.options, lines(outcome.output).join("\n"));
  return EXIT.done;
}

function print(session: Session, value: unknown, text: () => string): number {
  writeOutput(session.options, session.values.json ? JSON.stringify(value, null, 2) : text());
  return EXIT.done;
}

/** `--if-revision`: the revision the caller read, or `new` where it creates the asset. */
function ifRevision(value: string | undefined, creates: true): number | null;
function ifRevision(value: string | undefined, creates: false): number;
function ifRevision(value: string | undefined, creates: boolean): number | null {
  const named = required(value, creates ? "--if-revision <n|new>" : "--if-revision <n>");
  if (creates && named === "new") return null;
  return revisionNumber(named);
}

function revisionNumber(value: string): number {
  if (!/^[1-9]\d{0,8}$/u.test(value)) throw new UsageError(`'${value}' is no revision number.`);
  return Number(value);
}

/** `--from`, against the folder the command runs in. */
function fromPath(values: Values, cwd: string, flag: string): string {
  return resolve(cwd, required(values.from, flag));
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value === "") throw new UsageError(`Missing ${flag}.`);
  return value;
}

function refuseFlags(values: Values, allowed: readonly OptionName[], command: string): void {
  for (const [flag, value] of Object.entries(values)) {
    const given = value !== undefined && value !== false;
    if (given && !allowed.some((name) => name === flag)) {
      throw new UsageError(`--${flag} is not an option of '${command}'.`);
    }
  }
}

/** A command line this tool cannot run. Nothing was sent. */
class UsageError extends Error {}

export const assetHelpText = formatAssetHelp(Object.values(VERBS));
