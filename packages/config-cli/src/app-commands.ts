import { resolve } from "node:path";
import yaml from "js-yaml";
import {
  MAX_LIST_LIMIT,
  type Asset,
  type ConfigAssetRevision,
  type PlatformContext
} from "@work-shape/catalyst-api-contract";
import { ConfigApiError, type ConfigApi } from "./api";
import { publishFileChanges } from "./publish-file-changes";
import { appPublishData } from "./app-publish-data";
import {
  APP_STATE_FILE,
  localChanges,
  readAppFolder,
  readAppState,
  writeAppState,
  type AppFolderState
} from "./app-folder";
import { folderIsEmpty, writeFolderFiles } from "./asset-folder";
import { formatRefusal, formatWarnings } from "./asset-output";
import { connectApi, resolveWorkingDir, type ConfigCommandOptions } from "./command-support";
import { askBeforePublish, waitingPublishLine } from "./publish-question";
import { readManifestIfPresent, resolveInstance } from "./working-copy";

// `catalyst app pull|push|publish|status`: an App as a folder on this machine. Each command
// is built from the asset operations every kind has (`assets.get`, `assets.put`,
// `assets.publish`, `assets.revisions.list`); the instance decides every right, revision and
// build, and its refusal is printed as it gave it. An App belongs to one workspace, named by
// `--workspace`, by the folder's last pull, or by the instance's `workspace` in `catalyst.yaml`.

type AssetKind = PlatformContext["kinds"][number];

const EXIT = { done: 0, refused: 1, usage: 2, pending: 3 } as const;

const APP_KIND = "app";

/** What the App commands read from the command line, parsed by the asset commands. */
interface AppCommandValues {
  workspace?: string;
  revision?: string;
  published: boolean;
  audience?: string;
  yes: boolean;
  json: boolean;
}

export type AppCommandOptions = ConfigCommandOptions;

/** A command line the App commands cannot run. Nothing was sent. */
export class AppUsageError extends Error {}

export const APP_VERBS = {
  pull: {
    usage: "pull <app> [dir] [--published | --revision <n>]",
    summary:
      "Write the App's draft, or another revision, into a folder with app.yaml at its root (assets.get)"
  },
  push: {
    usage: "push [dir]",
    summary:
      "Send the folder as the App's next draft revision, or create the App; build errors name file:line (assets.put)"
  },
  publish: {
    usage: "publish <app> [--revision <n>] [--audience self|workspace|instance] [--yes]",
    summary:
      "Choose who may use the App, show what the revision makes live, then ask before publishing it (assets.publish)"
  },
  status: {
    usage: "status <app> [dir]",
    summary: "The draft and the published revision, and what a pulled folder changed"
  }
} as const;

type AppVerb = keyof typeof APP_VERBS;

export function isAppVerb(value: string): value is AppVerb {
  return Object.hasOwn(APP_VERBS, value);
}

export async function runAppCommand(
  verb: AppVerb,
  positionals: readonly string[],
  values: AppCommandValues,
  options: AppCommandOptions
): Promise<number> {
  switch (verb) {
    case "pull": {
      const [app, dir, ...extra] = positionals;
      if (app === undefined) throw new AppUsageError(`Usage: catalyst app ${APP_VERBS.pull.usage}`);
      refuseExtra(extra);
      if (values.published && values.revision !== undefined) {
        throw new AppUsageError("Pass --published or --revision, not both.");
      }
      return pull(app, resolve(options.cwd, dir ?? app), values, options);
    }
    case "push": {
      const [dir, ...extra] = positionals;
      refuseExtra(extra);
      refuseRevisionFlags(values, "push");
      return push(resolve(options.cwd, dir ?? "."), values, options);
    }
    case "publish": {
      const [app, ...extra] = positionals;
      if (app === undefined) {
        throw new AppUsageError(`Usage: catalyst app ${APP_VERBS.publish.usage}`);
      }
      refuseExtra(extra);
      if (values.published) throw new AppUsageError("--published is not an option of 'publish'.");
      return publish(app, values, options);
    }
    case "status": {
      const [app, dir, ...extra] = positionals;
      if (app === undefined) {
        throw new AppUsageError(`Usage: catalyst app ${APP_VERBS.status.usage}`);
      }
      refuseExtra(extra);
      refuseRevisionFlags(values, "status");
      return status(
        app,
        dir === undefined ? undefined : resolve(options.cwd, dir),
        values,
        options
      );
    }
  }
}

async function pull(
  app: string,
  directory: string,
  values: AppCommandValues,
  options: AppCommandOptions
): Promise<number> {
  const previous = await readAppState(directory);
  if (previous === undefined && !(await folderIsEmpty(directory))) {
    throw new AppUsageError(
      `'${directory}' holds files and no pulled App. Pull into an empty or new folder.`
    );
  }
  if (previous !== undefined && previous.app !== app) {
    throw new AppUsageError(`'${directory}' holds the App '${previous.app}', not '${app}'.`);
  }
  if (previous !== undefined) {
    const changes = await localChanges(directory, previous);
    const touched = [...changes.changed, ...changes.added, ...changes.removed];
    if (touched.length > 0) {
      throw new AppUsageError(
        [
          `'${directory}' has local changes a pull would overwrite. Push them, or pull into another folder to compare:`,
          ...touched.sort().map((path) => `- ${path}`)
        ].join("\n")
      );
    }
  }
  if (values.revision !== undefined) revisionNumber(values.revision);
  const target = await openApp(options, values, previous);
  const revision = values.published ? "published" : (values.revision ?? "draft");
  const asset = await target.api.read((client) =>
    client.assets.get({
      params: { kind: APP_KIND, name: app },
      query: { workspaceId: target.workspaceId, revision, files: "true" as const }
    })
  );
  if (asset.filesOmitted || asset.files === undefined) {
    throw new Error(
      `The files of '${app}' are larger together than one read answers, so they cannot be pulled with this CLI.`
    );
  }
  const contentRevision = asset.contentRevision ?? asset.revision;
  const hashes = await writeFolderFiles(directory, asset.files, previous);
  await writeAppState(directory, {
    instance: target.url,
    workspaceId: target.workspaceId,
    app,
    assetId: asset.id,
    revision: contentRevision,
    files: hashes
  });
  const which =
    contentRevision === asset.draftRevision
      ? "the draft"
      : contentRevision === asset.publishedRevision
        ? "the published revision"
        : "revision";
  writeOut(
    options,
    values.json
      ? JSON.stringify({ app, revision: contentRevision, directory, files: hashes }, null, 2)
      : `Pulled ${which} ${contentRevision} of App '${app}' into ${directory} (${asset.files.length} files).${contentRevision !== asset.draftRevision ? ` The draft is revision ${asset.draftRevision ?? asset.revision}; a push from this folder is refused until it is pulled from the draft.` : ""}`
  );
  return EXIT.done;
}

async function push(
  directory: string,
  values: AppCommandValues,
  options: AppCommandOptions
): Promise<number> {
  const state = await readAppState(directory);
  const target = await openApp(options, values, state);
  const kind = target.kinds.find((candidate) => candidate.kind === APP_KIND);
  if (kind === undefined) {
    throw new Error("The instance has no Apps you can reach: its kinds do not include 'app'.");
  }
  const read = await readAppFolder(
    directory,
    kind.limits,
    new Set(Object.keys(state?.files ?? {}))
  );
  const name = state?.app ?? appIdOf(read.files);
  if (state === undefined && name === undefined) {
    throw new AppUsageError(
      "app.yaml names no `id`. The id is the App's name on the instance: add `id: <name>` to app.yaml."
    );
  }
  const app = name ?? "";
  // The id is the App's name and does not change. A pulled folder whose app.yaml names another
  // id would otherwise write that manifest into the App it was pulled from. An app.yaml that
  // does not parse is left to the build, which names the line.
  const declared = state === undefined ? undefined : declaredIdOf(read.files);
  if (state !== undefined && declared !== undefined && declared !== state.app) {
    throw new AppUsageError(
      `app.yaml names the id '${declared}', and '${directory}' holds the App '${state.app}'. An App keeps its id: set \`id: ${state.app}\` again, or copy the files without ${APP_STATE_FILE} into a new folder to create the App '${declared}'.`
    );
  }
  const expectedRevision = state?.revision ?? null;
  if (state !== undefined && state.workspaceId !== target.workspaceId) {
    throw new AppUsageError(
      `'${directory}' was pulled from workspace ${state.workspaceId}, and the command names ${target.workspaceId}.`
    );
  }
  let outcome;
  try {
    outcome = await target.api.change(
      (client, idempotencyKey) =>
        client.assets.put({
          params: { kind: APP_KIND, name: app },
          body: { files: read.files, expectedRevision, workspaceId: target.workspaceId },
          idempotencyKey
        }),
      `It may have been written: run 'catalyst app status ${app}' before pushing again.`
    );
  } catch (error) {
    // A create refused because the id is taken answers 409; a draft that moved answers 412.
    if (
      error instanceof ConfigApiError &&
      (error.status === 412 || (error.status === 409 && expectedRevision === null))
    ) {
      writeErr(
        options,
        [
          formatRefusal(error),
          expectedRevision === null
            ? `An App named '${app}' exists already. If it is yours, pull it into an empty folder and copy your files there.`
            : `The draft moved since revision ${expectedRevision} was pulled. Nothing was written. Pull the App into another folder, carry your changes over, and push from there.`
        ].join("\n")
      );
      return EXIT.refused;
    }
    throw error;
  }
  if (outcome.status === "pending_approval") {
    return pendingApproval(outcome.run, values.json, options);
  }
  const output = outcome.output;
  const asset = await target.api.read((client) =>
    client.assets.get({
      params: { kind: APP_KIND, name: app },
      query: { workspaceId: target.workspaceId }
    })
  );
  await writeAppState(directory, {
    instance: target.url,
    workspaceId: target.workspaceId,
    app,
    assetId: asset.id,
    revision: output.revision,
    files: read.hashes
  });
  writeOut(
    options,
    values.json
      ? JSON.stringify({ ...output, leftOut: read.leftOut }, null, 2)
      : [
          `${expectedRevision === null ? "Created" : "Pushed"} App '${app}' at draft revision ${output.revision} (${read.files.length} files, built). Publish it with 'catalyst app publish ${app}'.`,
          ...(read.leftOut.length === 0 ? [] : [`Left out: ${read.leftOut.join(", ")}`]),
          ...formatWarnings(output.warnings)
        ].join("\n")
  );
  return EXIT.done;
}

async function publish(
  app: string,
  values: AppCommandValues,
  options: AppCommandOptions
): Promise<number> {
  if (values.revision !== undefined) revisionNumber(values.revision);
  const target = await openApp(options, values, undefined);
  let audience = readAudience(values.audience);
  const get = (revision: string, files = false) =>
    target.api.read((client) =>
      client.assets.get({
        params: { kind: APP_KIND, name: app },
        query: {
          workspaceId: target.workspaceId,
          ...(audience ? { audience } : {}),
          revision,
          ...(files ? { files: "true" as const } : {})
        }
      })
    );
  let candidate = await get(values.revision ?? "draft");
  const offered = candidate.appAudience;
  if (!audience) {
    if (values.yes || !options.prompt)
      throw new AppUsageError(
        "Choose who may use the App with --audience self|workspace|instance. Nothing was published."
      );
    const choices = offered?.choices ?? ["self", "workspace"];
    const labels = choices.map((choice) =>
      choice === "self"
        ? "self = Only me"
        : choice === "workspace"
          ? `workspace = ${offered?.workspaceName ?? "Owning workspace"}`
          : "instance = Whole instance"
    );
    audience = readAudience(await options.prompt(`For whom? ${labels.join("; ")}: `));
    if (!audience || !choices.includes(audience))
      throw new AppUsageError("Choose one of the offered audiences. Nothing was published.");
    candidate = await get(values.revision ?? "draft");
  }
  if (offered && !offered.choices.includes(audience))
    throw new AppUsageError("You may not publish to that audience. Nothing was published.");
  const number = candidate.contentRevision ?? candidate.revision;
  if (values.revision !== undefined && number !== revisionNumber(values.revision)) {
    throw new Error(`The instance answered revision ${number} for --revision ${values.revision}.`);
  }
  if (
    candidate.publishedRevision === number &&
    (offered?.live ?? (offered?.selected === undefined ? "workspace" : offered.selected)) ===
      audience &&
    (audience !== "self" || offered?.liveLabel === offered?.label)
  ) {
    writeOut(
      options,
      values.json
        ? JSON.stringify(
            {
              draftRevision: candidate.draftRevision ?? candidate.revision,
              publishedRevision: number,
              alreadyPublished: true
            },
            null,
            2
          )
        : `Revision ${number} of App '${app}' is the published one already.`
    );
    return EXIT.done;
  }
  const live = candidate.publishedRevision === undefined ? undefined : await get("published");
  const review = publishReview(candidate, live);
  const storedData = await appPublishData(
    target.api,
    app,
    candidate,
    candidate.appAudience
      ? `${candidate.appAudience.label}${candidate.appAudience.people === undefined ? "" : ` (${candidate.appAudience.people} people)`}`
      : undefined
  );
  const question = [formatReview(app, review), storedData].filter(Boolean).join("\n");
  const say = (text: string) => (values.json ? writeErr(options, text) : writeOut(options, text));
  const narrative = values.yes ? undefined : candidate.publishNarrative;
  say(narrative ? [narrative.summary, ...narrative.warnings].join("\n") : question);
  const answer = await askBeforePublish(options, {
    kind: APP_KIND,
    command: APP_KIND,
    name: app,
    revision: number,
    yes: values.yes,
    ...(narrative
      ? {
          details: async () => {
            const detailed = await get(String(number), true);
            const before =
              candidate.publishedRevision === undefined
                ? undefined
                : await get(String(candidate.publishedRevision), true);
            say(
              [
                question,
                ...publishFileChanges(detailed, before),
                ...(detailed.filesOmitted || before?.filesOmitted
                  ? ["Some files are omitted from this review."]
                  : [])
              ].join("\n")
            );
          }
        }
      : {})
  });
  if (answer === "refused") return EXIT.refused;
  const outcome = await target.api.change(
    (client, idempotencyKey) =>
      client.assets.publish({
        params: { kind: APP_KIND, name: app },
        body: { revision: number, workspaceId: target.workspaceId, audience },
        idempotencyKey,
        ...(answer === "unattended" ? { unattended: true } : {})
      }),
    `It may have been applied: run 'catalyst app status ${app}' before sending it again.`
  );
  if (outcome.status === "pending_approval") {
    return pendingApproval(
      outcome.run,
      values.json,
      options,
      "If you are an instance approver, you can approve it in the Inbox."
    );
  }
  writeOut(
    options,
    values.json
      ? JSON.stringify(outcome.output, null, 2)
      : `Published revision ${outcome.output.publishedRevision} of App '${app}'${outcome.output.replacedRevision === undefined ? "" : ` in place of revision ${outcome.output.replacedRevision}`}.`
  );
  return EXIT.done;
}

async function status(
  app: string,
  directory: string | undefined,
  values: AppCommandValues,
  options: AppCommandOptions
): Promise<number> {
  const state = directory === undefined ? undefined : await readAppState(directory);
  if (directory !== undefined && state === undefined) {
    throw new AppUsageError(`'${directory}' holds no pulled App (no ${APP_STATE_FILE}).`);
  }
  if (state !== undefined && state.app !== app) {
    throw new AppUsageError(`'${directory}' holds the App '${state.app}', not '${app}'.`);
  }
  const target = await openApp(options, values, state);
  const asset = await target.api.read((client) =>
    client.assets.get({
      params: { kind: APP_KIND, name: app },
      query: { workspaceId: target.workspaceId }
    })
  );
  const draft = asset.draftRevision ?? asset.revision;
  const revisions = await revisionsDownTo(
    target.api,
    app,
    target.workspaceId,
    asset.publishedRevision ?? draft
  );
  const by = (revision: number | undefined) =>
    revisions.find((entry) => entry.revision === revision);
  const local =
    directory === undefined || state === undefined
      ? undefined
      : { directory, base: state.revision, ...(await localChanges(directory, state)) };
  const report = {
    app,
    workspaceId: target.workspaceId,
    draftRevision: draft,
    publishedRevision: asset.publishedRevision ?? null,
    kit: kitOf(asset.config),
    ...(local === undefined ? {} : { local })
  };
  if (values.json) {
    writeOut(options, JSON.stringify(report, null, 2));
    return EXIT.done;
  }
  const line = (revision: ConfigAssetRevision | undefined) =>
    revision === undefined
      ? ""
      : ` (${revision.operation} by ${revision.actor?.displayLabel ?? "unknown"}, ${revision.createdAt})`;
  const lines = [
    `App '${app}' in workspace ${target.workspaceId}`,
    `Draft:     revision ${draft}${line(by(draft))}`,
    asset.publishedRevision === undefined
      ? "Published: not published yet"
      : `Published: revision ${asset.publishedRevision}${line(by(asset.publishedRevision))}${asset.publishedRevision === draft ? "; the draft is published" : "; the draft has unpublished changes"}`,
    // A revision exists only once its files built: a push that does not build writes none and
    // prints its errors itself.
    `Build:     draft revision ${draft} built${report.kit === undefined ? "" : ` with kit ${report.kit}`}`
  ];
  if (local !== undefined) {
    const touched = [
      ...local.changed.map((path) => `  changed  ${path}`),
      ...local.added.map((path) => `  added    ${path}`),
      ...local.removed.map((path) => `  removed  ${path}`)
    ];
    lines.push(
      `Folder:    ${local.directory}, pulled at revision ${local.base}${local.base === draft ? "" : `; the draft moved to ${draft} since`}`,
      touched.length === 0 ? "  no local changes" : touched.join("\n")
    );
  }
  writeOut(options, lines.join("\n"));
  return EXIT.done;
}

/** The revisions of an App, newest first, until the one named is among them. */
async function revisionsDownTo(
  api: ConfigApi,
  app: string,
  workspaceId: string,
  oldest: number
): Promise<ConfigAssetRevision[]> {
  const revisions: ConfigAssetRevision[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.read((client) =>
      client.assets.revisions.list({
        params: { kind: APP_KIND, name: app },
        query: { limit: MAX_LIST_LIMIT, workspaceId, ...(cursor === undefined ? {} : { cursor }) }
      })
    );
    revisions.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== undefined && !revisions.some((revision) => revision.revision <= oldest));
  return revisions;
}

/** One action of a manifest as a publish review names it. */
interface ReviewAction {
  name: string;
  change: "new" | "changed" | "unchanged";
}

/**
 * What a publish makes live, read from the manifests the builds of the two revisions
 * validated: the Connections and the hosts outside the instance the revision reaches, as the
 * publish dialog of the interface shows them, and beside them the changing actions it will call
 * live and the hosts and Data Store levels it adds, each against the published revision.
 */
export interface PublishReview {
  revision: number;
  publishedRevision: number | null;
  connections: string[];
  externalHosts: Array<{ host: string; added: boolean }>;
  changingActions: ReviewAction[];
  dataStores: Array<{ name: string; minSchema?: number; added: boolean }>;
}

export function publishReview(candidate: Asset, live: Asset | undefined): PublishReview {
  const next = manifestOf(candidate.config);
  const before = live === undefined ? undefined : manifestOf(live.config);
  const liveHosts = new Set(texts(before?.externalHosts));
  const liveActions = new Map(actionsOf(before).map((action) => [action.name, action.canonical]));
  const liveStores = new Map(dataStoresOf(before).map((store) => [store.name, store.minSchema]));
  return {
    revision: candidate.contentRevision ?? candidate.revision,
    publishedRevision: candidate.publishedRevision ?? null,
    connections: texts(next?.connections),
    externalHosts: texts(next?.externalHosts).map((host) => ({
      host,
      added: !liveHosts.has(host)
    })),
    changingActions: actionsOf(next)
      .filter((action) => action.effect === "changing")
      .map((action) => {
        const was = liveActions.get(action.name);
        return {
          name: action.name,
          change: was === undefined ? "new" : was === action.canonical ? "unchanged" : "changed"
        };
      }),
    dataStores: dataStoresOf(next).map((store) => ({
      ...store,
      added: !liveStores.has(store.name) || liveStores.get(store.name) !== store.minSchema
    }))
  };
}

function formatReview(app: string, review: PublishReview): string {
  const list = (items: string[]) => (items.length === 0 ? "  none" : items.join("\n"));
  return [
    `Publish revision ${review.revision} of App '${app}'${review.publishedRevision === null ? " (its first publish)" : ` in place of revision ${review.publishedRevision}`}.`,
    "Connections it uses:",
    list(review.connections.map((name) => `  ${name}`)),
    "External hosts it calls:",
    list(review.externalHosts.map((entry) => `  ${entry.host}${entry.added ? "  (added)" : ""}`)),
    "Changing actions it calls live:",
    list(
      review.changingActions.map(
        (action) => `  ${action.name}${action.change === "unchanged" ? "" : `  (${action.change})`}`
      )
    ),
    "Data Stores it needs:",
    list(
      review.dataStores.map(
        (store) =>
          `  ${store.name}${store.minSchema === undefined ? "" : ` at schema level ${store.minSchema} or later`}${store.added ? "  (added or raised)" : ""}`
      )
    )
  ].join("\n");
}

interface Target {
  api: ConfigApi;
  url: string;
  workspaceId: string;
  kinds: readonly AssetKind[];
}

/**
 * The instance and workspace a command addresses. The instance is `--instance`, the default
 * of `catalyst.yaml`, or the one the folder was pulled from; a folder is never sent to an
 * instance other than its own, and that is decided before the key is sent anywhere.
 */
async function openApp(
  options: AppCommandOptions,
  values: AppCommandValues,
  state: AppFolderState | undefined
): Promise<Target> {
  const manifest = await readManifestIfPresent(resolveWorkingDir(options));
  const instance = await resolveInstance(manifest, {
    ...options,
    ...(options.instance === undefined && manifest?.defaultInstance === undefined && state
      ? { instance: state.instance }
      : {})
  });
  const { url } = instance;
  if (state !== undefined && state.instance !== url) {
    throw new AppUsageError(
      `The folder was pulled from ${state.instance}, and the command names ${url}. A folder belongs to one instance.`
    );
  }
  const workspaceId = values.workspace ?? state?.workspaceId ?? instance.workspace;
  if (workspaceId === undefined) {
    throw new AppUsageError(
      "Name the workspace the App belongs to: --workspace <id>, or `workspace: <id>` in catalyst.yaml."
    );
  }
  const api = await connectApi(url, options);
  const context = await api.read((client) => client.platform.context.get());
  return { api, url, workspaceId, kinds: context.kinds };
}

/** The `id` of the folder's app.yaml, which is the App's name on the instance. */
function appIdOf(files: ReadonlyArray<{ path: string; text?: string }>): string | undefined {
  const manifest = files.find((file) => file.path === "app.yaml");
  if (manifest?.text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = yaml.load(manifest.text);
  } catch (error) {
    throw new AppUsageError(
      `app.yaml cannot be read: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return isRecord(parsed) && typeof parsed.id === "string" ? parsed.id : undefined;
}

/** The `id` of the folder's app.yaml, or nothing where it names none or does not parse. */
function declaredIdOf(files: ReadonlyArray<{ path: string; text?: string }>): string | undefined {
  try {
    return appIdOf(files);
  } catch {
    return undefined;
  }
}

function manifestOf(config: unknown): Record<string, unknown> | undefined {
  return isRecord(config) && isRecord(config.manifest) ? config.manifest : undefined;
}

function kitOf(config: unknown): string | undefined {
  const kit = manifestOf(config)?.kit;
  return typeof kit === "string" ? kit : undefined;
}

function actionsOf(
  manifest: Record<string, unknown> | undefined
): Array<{ name: string; effect: unknown; canonical: string }> {
  const actions = manifest?.actions;
  return (Array.isArray(actions) ? actions : []).flatMap((action: unknown) =>
    isRecord(action) && typeof action.name === "string"
      ? [{ name: action.name, effect: action.effect, canonical: canonicalJson(action) }]
      : []
  );
}

function dataStoresOf(
  manifest: Record<string, unknown> | undefined
): Array<{ name: string; minSchema?: number }> {
  const stores = manifest?.dataStores;
  return (Array.isArray(stores) ? stores : []).flatMap((store: unknown) =>
    isRecord(store) && typeof store.name === "string"
      ? [
          {
            name: store.name,
            ...(typeof store.minSchema === "number" ? { minSchema: store.minSchema } : {})
          }
        ]
      : []
  );
}

/** JSON with the keys of every object in order, so two equal declarations compare equal. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function revisionNumber(value: string): number {
  if (!/^[1-9]\d{0,8}$/u.test(value)) throw new AppUsageError(`'${value}' is no revision number.`);
  return Number(value);
}

function refuseExtra(extra: readonly string[]): void {
  if (extra.length > 0) throw new AppUsageError(`Unexpected argument '${extra[0]}'.`);
}

function refuseRevisionFlags(values: AppCommandValues, verb: string): void {
  if (values.published) throw new AppUsageError(`--published is not an option of '${verb}'.`);
  if (values.revision !== undefined) {
    throw new AppUsageError(`--revision is not an option of '${verb}'.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeOut(target: Pick<ConfigCommandOptions, "stdout">, text: string): void {
  (target.stdout ?? ((value: string) => process.stdout.write(value)))(`${text}\n`);
}

function writeErr(target: Pick<ConfigCommandOptions, "stderr">, text: string): void {
  (target.stderr ?? ((value: string) => process.stderr.write(value)))(`${text}\n`);
}

/** A held write preserves the request id and the JSON outcome the generic commands return. */
function pendingApproval(
  run: { id: string; status?: string; approvalRequestId?: string },
  json: boolean,
  options: ConfigCommandOptions,
  hint?: string
): number {
  if (json) writeOut(options, JSON.stringify({ status: "pending_approval", run }, null, 2));
  else writeErr(options, waitingPublishLine(run, hint));
  return EXIT.pending;
}

function readAudience(value: string | undefined): "self" | "workspace" | "instance" | undefined {
  if (value === undefined) return undefined;
  if (value === "self" || value === "workspace" || value === "instance") return value;
  throw new AppUsageError("--audience must be self, workspace or instance. Nothing was published.");
}
