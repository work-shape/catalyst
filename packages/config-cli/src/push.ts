import { extraHashes, folderHashes } from "./skill-folder";
import { resolve } from "node:path";
import { ASSET_RELEASE_SYNC_MAX_ITEMS } from "@work-shape/catalyst-api-contract";
import { ConfigApiError, type ConfigApi, type SyncBatch, type SyncOutput } from "./api";
import {
  STATE_FILENAME,
  readManifest,
  readStateFile,
  readWorkingCopy,
  resolveInstance,
  type DeletedAssetBaseline,
  type InstanceBaseline,
  type WorkingCopyBundle
} from "./working-copy";
import { agentPublishRefusalHint, askBeforePublish, waitingPublishLine } from "./publish-question";
import { preflightGuardrails } from "./push-guardrail-preflight";
import { CANONICAL_FORM_VERSION } from "./serialization";
import {
  type ConfigCommandOptions,
  type LocalAsset,
  type RecordedRevision,
  type RemoteAsset,
  assetContents,
  assetEntries,
  assetHash,
  bundleOf,
  byKey,
  batchScope,
  connectApi,
  holdsWholeInstance,
  fetchRemoteAsset,
  formatCounts,
  formatDraftAuthor,
  isRecord,
  listRemoteAssets,
  mapConcurrently,
  parseOnlySelectors,
  recordBaseline,
  resolveWorkingDir,
  selectBundle,
  workingCopyKinds,
  writeError,
  writeOutput
} from "./command-support";

export async function pushConfig(options: ConfigCommandOptions): Promise<number> {
  const workingDir = resolveWorkingDir(options);
  const manifest = await readManifest(workingDir);
  const instance = await resolveInstance(manifest, options);
  const local = await readWorkingCopy(workingDir, manifest);
  const selectors = parseOnlySelectors(options.only);
  if (options.prune && selectors.length > 0) {
    throw new Error("--prune cannot be combined with --only.");
  }
  const bundle = selectBundle(local, selectors, true);
  if (options.force) {
    throw new Error(FORCE_REFUSED_MESSAGE);
  }
  const state = await readStateFile(resolve(workingDir, STATE_FILENAME));
  // A working copy that never pulled from the instance read nothing of it: every asset it
  // pushes is a creation, made against no revision and no default agent, and the instance
  // refuses it where it holds the name. State of an earlier CLI, pulled without revisions,
  // says nothing a push could name.
  const baseline: InstanceBaseline = state.instances[instance.key] ?? {
    lastPulledVersion: 0,
    assets: {},
    defaultAgentName: null
  };
  if (baseline.assets === undefined) {
    throw new Error(
      `No per-asset baseline is recorded for '${instance.key}'. Run 'catalyst config pull' first.`
    );
  }
  const baselineAssets = baseline.assets;
  // Check before hashing: an older hash may differ even without an edit, and its file may
  // omit fields. A scoped pull upgrades only the assets it actually reads again.
  const selectedKeys = new Set(assetEntries(bundle).map((asset) => asset.key));
  const outdated = Object.entries(baselineAssets).filter(
    ([key, base]) =>
      (selectedKeys.has(key) || options.prune) &&
      base.canonicalFormVersion !== CANONICAL_FORM_VERSION
  );
  if (outdated.length > 0) {
    throw new Error(
      `${outdated.map(([key]) => key).join(", ")}: baseline uses an older canonical form. Run 'catalyst config pull' first, then push again. Commit or stash local edits in git first: the pull overwrites the local files.`
    );
  }
  const touched = assetEntries(bundle).filter(
    (asset) => baselineAssets[asset.key]?.hash !== assetHash(asset.contents)
  );
  // A CLI from before agent drafts recorded the live revision of an agent and not the draft
  // revision it saw. Pushed against nothing, the push would write over a draft unseen.
  const undrafted = touched.filter(
    (asset) => asset.kind === "agent" && baselineAssets[asset.key]?.draftRevision === undefined
  );
  if (undrafted.some((asset) => baselineAssets[asset.key] !== undefined)) {
    throw new Error(
      `${STATE_FILENAME} was written before agents had drafts and does not say which draft revision ${undrafted
        .filter((asset) => baselineAssets[asset.key] !== undefined)
        .map((asset) => asset.key)
        .join(
          ", "
        )} was pulled at. Run 'catalyst config pull' once, then push again. Commit or stash local edits in git first: the pull overwrites the local files.`
    );
  }
  const api = await connectApi(instance.url, options, instance);
  // Read to its last page or not at all: a listing that fails stops the push, so a prune
  // never takes an asset it could not list for one that is gone.
  const listing = await listRemoteAssets(api, workingCopyKinds(manifest));
  const touchedKeys = new Set(touched.map((asset) => asset.key));
  const localKeys = new Set(assetEntries(local).map((asset) => asset.key));
  const deleteAssets = options.prune
    ? [...listing.values()].filter((asset) => !localKeys.has(asset.key))
    : [];
  // A working copy of one workspace never names the instance's default agent.
  const changesDefault =
    holdsWholeInstance(instance) &&
    selectors.length === 0 &&
    (bundle.defaultAgentName ?? null) !== baseline.defaultAgentName;
  if (changesDefault && baseline.defaultAgentName === undefined) {
    throw new Error(
      "No default-agent baseline is recorded. Run 'catalyst config pull' before changing the default agent."
    );
  }
  /**
   * The revision an item is made against: the one of the last pull, so a change on the
   * instance since then refuses the push. For an asset this working copy saw deleted it is
   * the revision of that delete, and for one it never saw it is none: a creation.
   */
  const baseOf = (key: string): { id?: string; revision: number } | undefined =>
    baselineAssets[key] ?? baseline.deleted?.[key];
  const selectedRemote = selectors.length
    ? new Map(selectors.flatMap((selector) => listing.get(selector.key) ?? []).map(byKey))
    : listing;
  writeOutput(
    options,
    formatPushPlan(
      await createPushPlan(api, bundle, selectedRemote, touchedKeys, baseline),
      options.prune === true,
      touched.filter((asset) => asset.kind === "guardrail").map((asset) => asset.key)
    )
  );
  if (!touched.length && !deleteAssets.length && !changesDefault) {
    writeOutput(options, "No local changes to push.");
    return 0;
  }
  // An asset to delete that no pull of this working copy has seen was created since. The
  // instance is asked for nothing: a delete names the revision it was decided on.
  const unseen = deleteAssets.filter((asset) => baselineAssets[asset.key] === undefined);
  if (unseen.length > 0) {
    writeError(
      options,
      formatPushConflict(
        unseen.map((asset) => ({ ...asset, currentRevision: asset.revision })),
        false,
        options
      )
    );
    return 1;
  }
  // A revision counts one asset. Where the instance holds another asset under the name than
  // the one that was pulled, or the baseline does not say which asset it was, the number says
  // nothing: the push is refused here, and the instance refuses it again under its own lock.
  const written = [...touched, ...deleteAssets];
  const foreign: AssetConflict[] = written.flatMap((asset): AssetConflict[] => {
    const base = baseOf(asset.key);
    if (base === undefined) return [];
    const address = { kind: asset.kind, name: asset.name };
    if (base.id === undefined) return [{ ...address, baseline: "unbound" }];
    const remote = listing.get(asset.key);
    return remote !== undefined && remote.id !== base.id
      ? [{ ...address, baseline: "replaced" }]
      : [];
  });
  if (foreign.length > 0) {
    writeError(options, formatPushConflict(foreign, false, options));
    return 1;
  }
  // Guardrails are no part of a release: each is written alone, after the batch.
  const isGuardrail = (asset: { kind: string }) => asset.kind === "guardrail";
  const fileSkills = touched.flatMap((asset) =>
    asset.kind === "skill" &&
    asset.folderFiles !== undefined &&
    JSON.stringify(extraHashes(folderHashes(asset.folderFiles))) !==
      JSON.stringify(extraHashes(baselineAssets[asset.key]?.files))
      ? [{ ...asset, folderFiles: asset.folderFiles }]
      : []
  );
  const fileSkillKeys = new Set(fileSkills.map((asset) => asset.key));
  const syncTouched = touched.filter(
    (asset) => !isGuardrail(asset) && !fileSkillKeys.has(asset.key)
  );
  const syncDeletes = deleteAssets.filter((asset) => !isGuardrail(asset));
  const items: SyncBatch["items"] = [
    ...syncTouched.map((asset) => {
      const base = baseOf(asset.key);
      // An agent that is there is written as its draft, against the draft revision last seen.
      const draftRevision = baselineAssets[asset.key]?.draftRevision;
      return {
        type: "put" as const,
        kind: asset.kind,
        config: {
          ...asset.config,
          // Omission preserves stored frontmatter on the server; an empty map clears it.
          ...(asset.kind === "skill" && base !== undefined
            ? { frontmatter: asset.config.frontmatter ?? {} }
            : {})
        },
        expectedRevision: base?.revision ?? null,
        ...(asset.kind === "agent" && draftRevision !== undefined
          ? { expectedDraftRevision: draftRevision }
          : {}),
        ...(base?.id === undefined ? {} : { expectedAssetId: base.id })
      };
    }),
    ...syncDeletes.flatMap((asset) => {
      const base = baselineAssets[asset.key];
      return base === undefined
        ? []
        : [
            {
              type: "delete" as const,
              kind: asset.kind,
              name: asset.name,
              expectedRevision: base.revision,
              ...(base.id === undefined ? {} : { expectedAssetId: base.id })
            }
          ];
    })
  ];
  if (items.length > ASSET_RELEASE_SYNC_MAX_ITEMS) {
    throw new Error(
      `This push changes ${items.length} assets, and one push holds at most ${ASSET_RELEASE_SYNC_MAX_ITEMS}. Push in parts with --only.`
    );
  }
  if (
    !(await preflightGuardrails(api, {
      puts: touched.filter(isGuardrail),
      deletes: deleteAssets.filter(isGuardrail),
      listing,
      baseOf,
      ...(instance.workspace === undefined ? {} : { workspaceId: instance.workspace }),
      options
    }))
  )
    return 1;
  for (const asset of fileSkills) {
    const current = listing.get(asset.key);
    const base = baseOf(asset.key);
    const revision =
      current?.revision ??
      (base === undefined
        ? undefined
        : (await api.getLatestRevision("skill", asset.name))?.revision);
    if ((revision ?? null) !== (base?.revision ?? null)) {
      writeError(
        options,
        formatPushConflict(
          [{ kind: "skill", name: asset.name, currentRevision: current?.revision ?? null }],
          false,
          options
        )
      );
      return 1;
    }
    const checked = await api.read((client) =>
      client.assets.validate({
        params: { kind: "skill" },
        body: { config: { name: asset.name }, files: asset.folderFiles, ...batchScope(instance) }
      })
    );
    if (!checked.valid) {
      writeError(
        options,
        `Validation failed for ${asset.key}: ${checked.issues.map((issue) => `${issue.path?.join(".") ?? ""}: ${issue.message}`).join("; ")}; nothing was applied.`
      );
      return 1;
    }
  }
  /** The agents this push wrote as drafts, which `--publish` makes live. */
  const drafted: PushedDraft[] = [];
  if (items.length > 0 || changesDefault) {
    // The default agent the push is made against, as the revisions are: the one of the last pull.
    const batch: SyncBatch = {
      ...batchScope(instance),
      items,
      ...(changesDefault
        ? {
            defaultAgentName: bundle.defaultAgentName ?? null,
            expectedDefaultAgentName: baseline.defaultAgentName ?? null
          }
        : {})
    };
    const synced = await syncBatch(api, batch, options);
    if (synced === undefined) {
      return 1;
    }
    const result = synced;
    const revisions: Record<string, RecordedRevision> = {};
    for (const item of result.items) {
      if (item.status !== "applied" || item.type !== "put") continue;
      const key = `${item.kind}:${item.name}`;
      if (item.kind !== "agent") {
        revisions[key] = { id: item.id, revision: item.revision };
      } else if (item.draftRevision === undefined) {
        // A new agent is live at its first revision and has no draft.
        revisions[key] = { id: item.id, revision: item.revision, draftRevision: null };
      } else {
        // The live revision stays; the content recorded is the draft's.
        const live = item.publishedRevision ?? baselineAssets[key]?.revision ?? item.revision;
        revisions[key] = {
          id: item.id,
          revision: live,
          draftRevision: item.draftRevision,
          draftPushed: true
        };
        drafted.push({
          key,
          id: item.id,
          name: item.name,
          draftRevision: item.draftRevision,
          live
        });
      }
    }
    const pushed = bundleOf(syncTouched);
    await recordBaseline(
      workingDir,
      instance.key,
      result.version,
      pushed,
      revisions,
      false,
      changesDefault ? (bundle.defaultAgentName ?? null) : baseline.defaultAgentName,
      Object.fromEntries(
        result.items.flatMap((item) =>
          item.status === "applied" && item.type === "delete"
            ? [[`${item.kind}:${item.name}`, { id: item.id, revision: item.revision }]]
            : []
        )
      )
    );
    writeOutput(options, `Pushed ${formatCounts(pushed)}, version ${result.version}.`);
    for (const draft of drafted) {
      writeOutput(
        options,
        `${draft.key}: draft revision ${draft.draftRevision}; live revision ${draft.live} is unchanged until it is published.${options.publish ? "" : ` Publish it with 'catalyst agent publish ${draft.name} --revision ${draft.draftRevision}' or on the agent page.`}`
      );
    }
    for (const warning of result.warnings) writeOutput(options, `Warning: ${warning.message}`);
    if (result.hiddenAgentNames?.length) {
      writeOutput(
        options,
        [
          "Hidden in every workspace until an instance admin sets their availability:",
          ...result.hiddenAgentNames.map((name) => `  agent:${name}`)
        ].join("\n")
      );
    }
  }
  let skillsWritten = false;
  for (const asset of fileSkills) {
    const base = baseOf(asset.key);
    try {
      const outcome = await api.change(
        (client, idempotencyKey) =>
          client.assets.put({
            params: { kind: "skill", name: asset.name },
            body: {
              files: asset.folderFiles,
              expectedRevision: base?.revision ?? null,
              ...batchScope(instance)
            },
            idempotencyKey
          }),
        "It may have been written: run 'catalyst config diff' before pushing again."
      );
      if (outcome.status === "pending_approval") {
        writeError(
          options,
          waitingGuardrail(
            asset.key,
            outcome.run.id,
            skillsWritten || items.length > 0 || changesDefault
          )
        );
        return 1;
      }
      const id = listing.get(asset.key)?.id ?? (await api.getAsset("skill", asset.name))?.id;
      if (id !== undefined)
        await recordBaseline(
          workingDir,
          instance.key,
          outcome.output.version ?? baseline.lastPulledVersion,
          bundleOf([asset]),
          { [asset.key]: { id, revision: outcome.output.revision } },
          false,
          baseline.defaultAgentName
        );
      skillsWritten = true;
      writeOutput(options, `Wrote ${asset.key} at revision ${outcome.output.revision}.`);
      for (const warning of outcome.output.warnings ?? [])
        writeOutput(options, `Warning: ${warning.message}`);
    } catch (error) {
      if (!(error instanceof ConfigApiError)) throw error;
      const conflicts =
        error.code === "REVISION_CONFLICT" || error.code === "CONFLICT"
          ? readConflicts(error.details)
          : [];
      if (conflicts.length)
        writeError(
          options,
          formatPushConflict(
            conflicts,
            false,
            options,
            skillsWritten || items.length > 0 || changesDefault
          )
        );
      else
        writeError(
          options,
          `${asset.key}: ${error.code ?? "refused"}: ${error.message}. ${skillsWritten || items.length > 0 || changesDefault ? "What is reported above was applied; nothing after it." : "Nothing was applied."}`
        );
      return 1;
    }
  }
  const guardrailsWritten = await writeGuardrails(api, {
    workingDir,
    instanceKey: instance.key,
    version: baseline.lastPulledVersion,
    puts: touched.filter(isGuardrail),
    deletes: deleteAssets.filter(isGuardrail),
    baseOf,
    listing,
    afterSync: items.length > 0 || changesDefault || skillsWritten,
    ...(instance.workspace === undefined ? {} : { workspaceId: instance.workspace }),
    options
  });
  if (guardrailsWritten !== 0 || !options.publish || drafted.length === 0) {
    return guardrailsWritten;
  }
  return publishDrafts(api, drafted, {
    workingDir,
    instanceKey: instance.key,
    version: baseline.lastPulledVersion,
    pushed: new Map(syncTouched.map(byKey)),
    ...(instance.workspace === undefined ? {} : { workspaceId: instance.workspace }),
    options
  });
}

/** An agent a push wrote as its draft, and the live revision it left alone. */
interface PushedDraft {
  key: string;
  id: string;
  name: string;
  draftRevision: number;
  live: number;
}

/**
 * `push --publish`: publishes each draft the push wrote, by the draft revision it was given.
 * An instance's own agent is published without a question, unless a guardrail on
 * `agent.before_publish` holds it for an approval. A workspace's agent asks first, as an App
 * does, and without a terminal is not published. A service principal publishes nothing
 * (AP-10). Each publish is recorded as the agent's new live revision when it is answered.
 * Answers 0 when all were published, 3 when one waits for an approval, 1 otherwise.
 */
async function publishDrafts(
  api: ConfigApi,
  drafts: readonly PushedDraft[],
  input: {
    workingDir: string;
    instanceKey: string;
    version: number;
    pushed: ReadonlyMap<string, LocalAsset>;
    workspaceId?: string;
    options: ConfigCommandOptions;
  }
): Promise<number> {
  const { options } = input;
  const scope = input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId };
  const left = (from: number) =>
    drafts
      .slice(from)
      .map(
        (draft) =>
          `  catalyst agent publish ${draft.name} --revision ${draft.draftRevision}${input.workspaceId === undefined ? "" : ` --workspace ${input.workspaceId}`}`
      );
  const unpublished = (from: number) => {
    const commands = left(from);
    if (commands.length > 0) {
      writeError(
        options,
        ["Not published; each stays a draft until it is:", ...commands].join("\n")
      );
    }
  };
  for (const [index, draft] of drafts.entries()) {
    if (input.workspaceId !== undefined) {
      // A workspace's agent keeps the question and the approval of its publish (WS-PUB-1b).
      const answer = await askBeforePublish(options, {
        kind: "agent",
        command: "agent",
        name: draft.name,
        revision: draft.draftRevision,
        yes: false
      });
      if (answer !== "answered") {
        unpublished(index);
        return 1;
      }
    }
    let outcome;
    try {
      outcome = await api.change(
        (client, idempotencyKey) =>
          client.assets.publish({
            params: { kind: "agent", name: draft.name },
            body: { revision: draft.draftRevision, ...scope },
            idempotencyKey
          }),
        `It may have been published: run 'catalyst agent show ${draft.name}' before sending it again.`
      );
    } catch (error) {
      if (!(error instanceof ConfigApiError)) throw error;
      writeError(options, publishRefusal(draft, error));
      unpublished(index);
      return 1;
    }
    if (outcome.status === "pending_approval") {
      writeError(options, `${draft.key}: ${waitingPublishLine(outcome.run)}`);
      unpublished(index + 1);
      return 3;
    }
    // What was pushed is live now: the baseline names the new live revision and no draft.
    const asset = input.pushed.get(draft.key);
    if (asset !== undefined) {
      await recordBaseline(
        input.workingDir,
        input.instanceKey,
        input.version,
        bundleOf([asset]),
        {
          [draft.key]: {
            id: draft.id,
            revision: outcome.output.publishedRevision,
            draftRevision: null
          }
        },
        false
      );
    }
    writeOutput(
      options,
      `Published draft revision ${draft.draftRevision} of agent '${draft.name}' as live revision ${outcome.output.publishedRevision}${outcome.output.replacedRevision === undefined ? "" : ` in place of revision ${outcome.output.replacedRevision}`}.`
    );
  }
  return 0;
}

/** Why the instance refused to publish a pushed draft, and what publishes it instead. */
function publishRefusal(draft: PushedDraft, error: ConfigApiError): string {
  const hint = agentPublishRefusalHint(error);
  return [
    `${draft.key}: nothing was published; draft revision ${draft.draftRevision} stays a draft.`,
    `The instance refused it (${error.code ?? `HTTP ${error.status}`}): ${error.message}`,
    ...(hint === undefined ? [] : [hint])
  ].join("\n");
}

/**
 * Sends the batch of agents and skills, checked first. Answers the result where it was
 * applied, and nothing where the instance refused it or holds it for an approval, which it has
 * reported.
 */
async function syncBatch(
  api: ConfigApi,
  batch: SyncBatch,
  options: ConfigCommandOptions
): Promise<SyncOutput | undefined> {
  try {
    // Asked first: an instance of an earlier release has no check, and says so here before
    // anything is written under rules this CLI does not expect.
    const checked = await checkSyncOnThisRelease(api, batch);
    const outcome = await api.syncAssets(batch);
    if (outcome.status === "pending_approval") {
      writeError(
        options,
        `The push waits for an approval on the instance and nothing was applied yet (Operation Run ${outcome.operationRunId}). When it is approved, run 'catalyst config pull' to record the new revisions.`
      );
      return undefined;
    }
    const warnings = [...(checked.warnings ?? []), ...outcome.output.warnings];
    return {
      ...outcome.output,
      warnings: warnings.filter(
        (warning, index) =>
          warnings.findIndex(
            (other) => other.code === warning.code && other.message === warning.message
          ) === index
      )
    };
  } catch (error) {
    const draftConflict = error instanceof ConfigApiError ? readDraftConflict(error) : undefined;
    if (draftConflict) {
      writeError(options, formatPushConflict([draftConflict], false, options));
      return undefined;
    }
    const refusal = error instanceof ConfigApiError ? readRefusedBatch(error) : undefined;
    if (!refusal) {
      throw error;
    }
    if (refusal.conflicts.length > 0 || refusal.defaultAgentConflict) {
      writeError(
        options,
        formatPushConflict(refusal.conflicts, refusal.defaultAgentConflict, options)
      );
      return undefined;
    }
    writeError(
      options,
      formatRefusal(
        refusal.validation ? "Validation failed" : "Push refused; nothing was applied",
        refusal
      )
    );
    return undefined;
  }
}

/**
 * Writes the changed guardrails one by one with `assets.put`, each as its draft against the
 * revision of its last pull, and deletes the pruned ones with `assets.delete`. Each write is
 * recorded in the baseline when it is answered, so a refusal on the way leaves the ones before
 * it recorded and stops the rest.
 */
async function writeGuardrails(
  api: ConfigApi,
  input: {
    workingDir: string;
    instanceKey: string;
    version: number;
    puts: readonly LocalAsset[];
    deletes: readonly RemoteAsset[];
    baseOf: (key: string) => { id?: string; revision: number } | undefined;
    listing: ReadonlyMap<string, RemoteAsset>;
    afterSync: boolean;
    /** The workspace a bound root writes for: it owns the guardrails the push creates. */
    workspaceId?: string;
    options: ConfigCommandOptions;
  }
): Promise<number> {
  const { options } = input;
  const owner = input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId };
  let written = input.afterSync;
  const record = (
    asset: LocalAsset | undefined,
    revisions: Record<string, { id: string; revision: number }> | undefined,
    tombstones: Record<string, DeletedAssetBaseline> = {}
  ) =>
    recordBaseline(
      input.workingDir,
      input.instanceKey,
      input.version,
      bundleOf(asset ? [asset] : []),
      revisions ?? {},
      false,
      undefined,
      tombstones
    );
  try {
    for (const asset of input.puts) {
      const base = input.baseOf(asset.key);
      const outcome = await api.change(
        (client, idempotencyKey) =>
          client.assets.put({
            params: { kind: asset.kind, name: asset.name },
            body: {
              config: { ...asset.config },
              expectedRevision: base?.revision ?? null,
              ...owner
            },
            idempotencyKey
          }),
        "It may have been written: run 'catalyst config diff' before pushing again."
      );
      if (outcome.status === "pending_approval") {
        writeError(options, waitingGuardrail(asset.key, outcome.run.id, written));
        return 1;
      }
      // The answer carries the revision and not the asset: an asset the listing held keeps its
      // id, and one created here is read once for it.
      const id =
        input.listing.get(asset.key)?.id ?? (await api.getAsset(asset.kind, asset.name))?.id;
      if (id !== undefined) {
        await record(asset, { [asset.key]: { id, revision: outcome.output.revision } });
      }
      written = true;
      writeOutput(
        options,
        `Wrote ${asset.key} as draft revision ${outcome.output.revision}; it checks nothing until it is published.`
      );
    }
    for (const asset of input.deletes) {
      const base = input.baseOf(asset.key);
      if (base === undefined) continue;
      const outcome = await api.change(
        (client, idempotencyKey) =>
          client.assets.delete({
            params: { kind: asset.kind, name: asset.name },
            body: { expectedRevision: base.revision, ...owner },
            idempotencyKey
          }),
        "It may have been applied: run 'catalyst config diff' before pushing again."
      );
      if (outcome.status === "pending_approval") {
        writeError(options, waitingGuardrail(asset.key, outcome.run.id, written));
        return 1;
      }
      await record(undefined, undefined, {
        [asset.key]: { id: asset.id, revision: outcome.output.revision }
      });
      written = true;
      writeOutput(
        options,
        `Deleted ${asset.key}; its delete is revision ${outcome.output.revision}.`
      );
    }
    return 0;
  } catch (error) {
    if (!(error instanceof ConfigApiError)) throw error;
    const conflicts = error.code === "REVISION_CONFLICT" ? readConflicts(error.details) : [];
    if (conflicts.length > 0) {
      writeError(options, formatPushConflict(conflicts, false, options, written));
      return 1;
    }
    const refusal = readRefusedBatch(error);
    if (!refusal) throw error;
    writeError(
      options,
      formatRefusal(
        refusal.validation
          ? "Validation failed"
          : written
            ? "Push refused; what is reported above was applied, nothing after it"
            : "Push refused; nothing was applied",
        refusal
      )
    );
    return 1;
  }
}

function waitingGuardrail(key: string, operationRunId: string, written: boolean): string {
  return `The write of ${key} waits for an approval on the instance (Operation Run ${operationRunId})${written ? "; what is reported above was applied" : " and nothing was applied yet"}. When it is approved, run 'catalyst config pull' to record the new revisions.`;
}

interface PushPlan {
  added: number;
  updated: number;
  unchanged: number;
  remoteOnly: string[];
}

/**
 * What a push would do to each local asset. Whether a touched asset differs from the
 * instance's is read from the baseline where the instance still holds the pulled revision,
 * and from the instance's content only where it does not.
 */
async function createPushPlan(
  api: ConfigApi,
  local: WorkingCopyBundle,
  remote: ReadonlyMap<string, RemoteAsset>,
  touchedKeys: Set<string>,
  baseline: InstanceBaseline | undefined
): Promise<PushPlan> {
  const localAssets = assetEntries(local);
  const differs = await mapConcurrently(localAssets, async (asset) => {
    const remoteAsset = remote.get(asset.key);
    if (!touchedKeys.has(asset.key) || !remoteAsset) {
      return false;
    }
    const base = baseline?.assets?.[asset.key];
    if (base?.revision === remoteAsset.revision && base.id === remoteAsset.id) {
      return base.hash !== assetHash(asset.contents);
    }
    const fetched = await fetchRemoteAsset(api, remoteAsset.kind, remoteAsset.name);
    return fetched === undefined || assetContents(fetched) !== asset.contents;
  });
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  localAssets.forEach((asset, index) => {
    if (touchedKeys.has(asset.key) && !remote.has(asset.key)) {
      added += 1;
    } else if (differs[index]) {
      updated += 1;
    } else {
      unchanged += 1;
    }
  });
  const localKeys = new Set(localAssets.map((asset) => asset.key));
  return {
    added,
    updated,
    unchanged,
    remoteOnly: [...remote.keys()].filter((key) => !localKeys.has(key)).sort()
  };
}

function formatPushPlan(plan: PushPlan, prune: boolean, guardrailPuts: string[]): string {
  const lines = [
    `Push plan (${prune ? "mirror" : "merge"}):`,
    `  Added: ${plan.added}`,
    `  Updated: ${plan.updated}`,
    `  Unchanged: ${plan.unchanged}`
  ];
  if (prune) {
    lines.push(`  Deleted: ${plan.remoteOnly.length}`);
    if (plan.remoteOnly.length > 0) {
      lines.push("Assets to delete:", ...plan.remoteOnly.map((key) => `- ${key}`));
    }
  } else if (plan.remoteOnly.length > 0) {
    lines.push(
      "Warning: these assets exist only on the instance and will be kept:",
      ...plan.remoteOnly.map((key) => `- ${key}`),
      "Use --prune to delete them."
    );
  }
  if (guardrailPuts.length > 0) {
    lines.push(
      "Guardrails to write one by one, each as its draft:",
      ...guardrailPuts.map((key) => `- ${key}`)
    );
  }
  return lines.join("\n");
}

/** What `push --force` answers. The flag is gone: a push never overwrites what it did not read. */
const FORCE_REFUSED_MESSAGE =
  "'catalyst config push --force' no longer exists: a push names the revision each asset was pulled at and never overwrites a change it did not read. Where a push reports a conflict, commit or stash local edits, run 'catalyst config pull --only <kind>:<name>' for the assets it names, review with 'catalyst config diff', re-apply the edits and push again.";

/**
 * One asset a push was made against another revision of, as the instance told it. A key that
 * may not read the asset is told its name only.
 */
interface AssetConflict {
  kind: string;
  name: string;
  /**
   * The baseline says nothing a push could name for the asset: `replaced` where the instance
   * holds another asset under the name than the one that was pulled, `unbound` where an
   * earlier CLI recorded the revision without the asset it counts.
   */
  baseline?: "replaced" | "unbound";
  /** The revision the instance holds, or null where it holds no such asset. */
  currentRevision?: number | null;
  /** The instance holds the delete of the asset as its latest revision. */
  deleted?: boolean;
  changedBy?: string;
  changedAt?: string;
  /**
   * An agent whose draft another write changed since the last pull or push: the draft
   * revision it is at now, or null where it was published or discarded since.
   */
  draft?: { revision: number | null };
}

/**
 * An agent draft that moved since this working copy saw it: the instance refuses the whole
 * push with `draft_changed`, and names the agent, the draft revision it is at and its author.
 */
export function readDraftConflict(error: ConfigApiError): AssetConflict | undefined {
  const details = isRecord(error.details) ? error.details : undefined;
  if (error.code !== "REVISION_CONFLICT" || details?.reason !== "draft_changed") return undefined;
  const author = isRecord(details.author) ? details.author : undefined;
  const revision =
    typeof details.currentDraftRevision === "number" ? details.currentDraftRevision : null;
  return {
    kind: typeof details.kind === "string" ? details.kind : "agent",
    name: typeof details.name === "string" ? details.name : "(unnamed)",
    draft: { revision },
    ...(author
      ? {
          changedBy: formatDraftAuthor({
            release: author.release === true,
            ...(typeof author.userId === "string" ? { userId: author.userId } : {}),
            ...(typeof author.displayLabel === "string"
              ? { displayLabel: author.displayLabel }
              : {}),
            ...(typeof author.conversationId === "string"
              ? { conversationId: author.conversationId }
              : {})
          })
        }
      : {}),
    ...(typeof details.changedAt === "string" ? { changedAt: details.changedAt } : {})
  };
}

/**
 * The revision of the delete of each named asset, where the key may read its history. A push
 * that creates the asset again names it.
 */
export async function readTombstones(
  api: ConfigApi,
  keys: readonly string[]
): Promise<Record<string, DeletedAssetBaseline | undefined>> {
  const revisions = await mapConcurrently(keys, async (key) => {
    const separator = key.indexOf(":");
    const latest = await api
      .getLatestRevision(key.slice(0, separator), key.slice(separator + 1))
      .catch(() => undefined);
    return latest?.operation === "delete"
      ? { id: latest.assetId, revision: latest.revision }
      : undefined;
  });
  return Object.fromEntries(keys.map((key, index) => [key, revisions[index]]));
}

/** The conflicts the details of a refusal name, each as the key may know it. */
function readConflicts(details: unknown): AssetConflict[] {
  const conflicts = isRecord(details) && Array.isArray(details.conflicts) ? details.conflicts : [];
  return conflicts.flatMap((conflict) =>
    isRecord(conflict) && typeof conflict.kind === "string" && typeof conflict.name === "string"
      ? [
          {
            kind: conflict.kind,
            name: conflict.name,
            ...(typeof conflict.currentRevision === "number" || conflict.currentRevision === null
              ? { currentRevision: conflict.currentRevision }
              : {}),
            ...(conflict.deleted === true ? { deleted: true } : {}),
            ...(typeof conflict.changedBy === "string" ? { changedBy: conflict.changedBy } : {}),
            ...(typeof conflict.changedAt === "string" ? { changedAt: conflict.changedAt } : {})
          }
        ]
      : []
  );
}

/** A batch the instance did not apply, as the command reports it. */
interface RefusedBatch {
  message: string;
  /** The answer is about the definitions, not about rights or revisions. */
  validation: boolean;
  conflicts: AssetConflict[];
  defaultAgentConflict: boolean;
  /** One line per refused item and per issue of the set. */
  lines: string[];
}

/** Reads the error of a refused sync or check. Any other error is not one. */
export function readRefusedBatch(error: ConfigApiError): RefusedBatch | undefined {
  const details = isRecord(error.details) ? error.details : {};
  const defaultAgentConflict =
    error.code === "CONFLICT" && details.reason === "default_agent_changed";
  if (details.reason !== "sync_refused" && !defaultAgentConflict && error.status !== 422) {
    return undefined;
  }
  const refused = (Array.isArray(details.items) ? details.items : []).flatMap((item) =>
    isRecord(item) && isRecord(item.error) ? [{ item, refusal: item.error }] : []
  );
  const label = (item: Record<string, unknown>) =>
    `${String(item.kind)}${typeof item.name === "string" ? ` '${item.name}'` : typeof item.index === "number" ? ` #${item.index + 1}` : ""}`;
  const issues = (Array.isArray(details.issues) ? details.issues : []).flatMap((issue) =>
    isRecord(issue) && typeof issue.message === "string" ? [issue] : []
  );
  return {
    message: error.message,
    validation: error.status === 422,
    defaultAgentConflict,
    conflicts: readConflicts(details),
    lines: [
      ...refused.map(({ item, refusal }) => `${label(item)}: ${String(refusal.message)}`),
      ...issues.map((issue) => {
        const path =
          Array.isArray(issue.path) && issue.path.length > 0
            ? ` (${issue.path.map(String).join(".")})`
            : "";
        return `config${path}: ${String(issue.message)}`;
      })
    ]
  };
}

/**
 * Asks the instance whether it would apply the batch. An instance that does not know the
 * check is of an earlier release, whose sync does not write a release as this CLI sends it.
 */
export async function checkSyncOnThisRelease(api: ConfigApi, batch: SyncBatch) {
  try {
    return await api.checkSync(batch);
  } catch (error) {
    if (error instanceof ConfigApiError && isMissingCheck(error)) {
      throw new Error(
        "This instance is on an earlier release than this CLI: 'config push' and 'config validate' need the instance on the release of this CLI or later. Upgrade the instance, or use the CLI of its release.",
        { cause: error }
      );
    }
    throw error;
  }
}

/** A 404 that is no refusal of the batch: the instance has no such operation. */
function isMissingCheck(error: ConfigApiError): boolean {
  return (
    error.status === 404 && !(isRecord(error.details) && error.details.reason === "sync_refused")
  );
}

export function formatRefusal(title: string, refusal: RefusedBatch): string {
  if (refusal.lines.length === 0) {
    // The instance bounds a batch by its caller. Where that refuses a push, parts fit.
    const hint = /^A batch holds at most/u.test(refusal.message)
      ? " Push in parts with --only."
      : "";
    return `${title}: ${refusal.message}${hint}`;
  }
  return `${title}:\n${refusal.lines.map((line) => `- ${line}`).join("\n")}`;
}

function formatPushConflict(
  conflicts: readonly AssetConflict[],
  defaultAgentConflict: boolean,
  options: ConfigCommandOptions,
  /** Writes of this push were applied before the conflict, as reported above it. */
  applied = false
): string {
  const selectors = conflicts.map((asset) => `${asset.kind}:${asset.name}`);
  const argumentsList = [
    "catalyst config pull",
    ...(options.dir ? ["--dir", shellQuote(options.dir)] : []),
    ...(options.instance ? ["--instance", shellQuote(options.instance)] : []),
    // A full pull refreshes the manifest's default-agent pointer as well as assets.
    ...(defaultAgentConflict
      ? []
      : selectors.flatMap((selector) => ["--only", shellQuote(selector)]))
  ];
  return [
    applied
      ? "Push conflict; what is reported above was applied, nothing after it."
      : "Push conflict; nothing was applied.",
    ...conflicts.map((asset) => `- ${asset.kind}:${asset.name}: ${describeConflict(asset)}`),
    ...(defaultAgentConflict
      ? ["- default agent changed on the instance; a full pull is required."]
      : []),
    defaultAgentConflict
      ? "Commit or stash local edits in git first: a full pull overwrites the local working copy."
      : "Commit or stash local edits in git first: pull overwrites the local files for these assets.",
    argumentsList.join(" "),
    "Review with 'catalyst config diff', re-apply local edits, and push again."
  ].join("\n");
}

/** What the instance holds of one conflicting asset, in the words of what the key may read. */
function describeConflict(asset: AssetConflict): string {
  if (asset.draft !== undefined) {
    return asset.draft.revision === null
      ? "the draft this working copy last saw was published or discarded since"
      : `its draft changed since the last pull: draft revision ${asset.draft.revision}, written by ${asset.changedBy ?? "unknown actor"} at ${asset.changedAt ?? "unknown time"}. A pull records it, and the push after it writes over that draft`;
  }
  if (asset.baseline === "replaced") {
    return "the instance holds another asset under this name than the one this working copy pulled. The working copy was pulled from another database, or the asset was replaced there";
  }
  if (asset.baseline === "unbound") {
    return "the baseline was written by an earlier CLI and does not say which asset its revision counts, so it cannot be pushed against";
  }
  if (asset.currentRevision === undefined) {
    return "changed on the instance since the last pull";
  }
  if (asset.currentRevision === null) {
    return "not on the instance";
  }
  const by = `by ${asset.changedBy ?? "unknown actor"} at ${asset.changedAt ?? "unknown time"}`;
  return asset.deleted
    ? `deleted at revision ${asset.currentRevision} ${by}; the pull records that delete, and the next push may create the asset again`
    : `revision ${asset.currentRevision}, changed ${by}`;
}

function shellQuote(value: string): string {
  return /^[a-zA-Z0-9_:./-]+$/u.test(value) ? value : "'" + value.replaceAll("'", "'\"'\"'") + "'";
}
