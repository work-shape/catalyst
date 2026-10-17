import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ConfigApiError } from "./api";
import { createUnifiedDiff } from "./diff";
import { serializeGuardrailFiles } from "./guardrail-files";
import { serializeAgentYaml, serializeSkillPackageForDisplay } from "./serialization";
import {
  MANIFEST_FILENAME,
  STATE_FILENAME,
  agentAssetPath,
  guardrailAssetPath,
  matchesManifestPath,
  readManifest,
  readStateFile,
  readWorkingCopy,
  removeStaleManifestAssets,
  bindManifestWorkspace,
  type CatalystManifest,
  resolveInstance,
  skillAssetPath,
  updateManifestDefaultAgent
} from "./working-copy";
import {
  type ConfigCommandOptions,
  assetEntries,
  assetHash,
  bundleOf,
  byKey,
  byName,
  canonicalBundleFiles,
  batchScope,
  connectApi,
  holdsWholeInstance,
  fetchRemoteAsset,
  formatCommandError,
  formatCount,
  formatCounts,
  formatDraft,
  listRemoteAssets,
  mapConcurrently,
  parseOnlySelectors,
  readDefinition,
  readInstanceOverview,
  readLocalAssetsIfValid,
  recordBaseline,
  replaceGuardrailFolder,
  replaceSkillPackage,
  resolveWorkingDir,
  workingCopyKinds,
  type AssetKindName,
  type FetchedAsset,
  type RemoteAsset,
  writeError,
  writeOutput
} from "./command-support";
import {
  checkSyncOnThisRelease,
  formatRefusal,
  pushConfig,
  readRefusedBatch,
  readTombstones
} from "./push";

export {
  canonicalBundleFiles,
  resolveSkillResourceTarget,
  type ConfigCommandOptions
} from "./command-support";
export { pushConfig } from "./push";

export type ConfigCommandName = "pull" | "push" | "diff" | "validate" | "list" | "show";

export async function runConfigCommand(
  command: ConfigCommandName,
  options: ConfigCommandOptions
): Promise<number> {
  try {
    switch (command) {
      case "pull":
        return await pullConfig(options);
      case "push":
        return await pushConfig(options);
      case "diff":
        return await diffConfig(options);
      case "validate":
        return await validateConfig(options);
      case "list":
        return await listConfig(options);
      case "show":
        return await showConfig(options);
    }
  } catch (error) {
    writeError(options, formatCommandError(error));
    return 1;
  }
}

export async function pullConfig(options: ConfigCommandOptions): Promise<number> {
  const workingDir = resolveWorkingDir(options);
  const { manifest, instance } = await bindWorkspace(workingDir, options);
  const api = await connectApi(instance.url, options, instance);
  const overview = await readInstanceOverview(api, instance);
  const listing = await listRemoteAssets(api, workingCopyKinds(manifest));
  const selectors = parseOnlySelectors(options.only);
  const wanted =
    selectors.length === 0
      ? [...listing.values()]
      : selectors.flatMap((selector) => listing.get(selector.key) ?? []);
  const baseline = (await readStateFile(resolve(workingDir, STATE_FILENAME))).instances[
    instance.key
  ];
  const local = await readLocalAssetsIfValid(workingDir, manifest);
  // An asset that is at the revision of the last pull, with a local file that still holds
  // what was pulled, is not read again: the file is what the instance holds.
  const pulled = await mapConcurrently(wanted, async (remote) => {
    const base = baseline?.assets?.[remote.key];
    const mine = local.get(remote.key);
    if (
      base &&
      mine &&
      // The same asset, not only the same number: after a database was replaced another
      // asset of the name can be at the revision the last pull recorded.
      base.id === remote.id &&
      base.revision === remote.revision &&
      assetHash(mine.contents) === base.hash &&
      // What this working copy pushed as an agent's draft is not its live revision.
      base.draftPushed !== true
    ) {
      return readDefinition(remote, mine.config);
    }
    // Deleted since it was listed: it is not on the instance.
    return fetchRemoteAsset(api, remote.kind, remote.name);
  });
  const present = pulled.flatMap((asset) => (asset ? [asset] : []));
  const selected = bundleOf(present);
  const listed = new Map(wanted.map(byKey));
  // An agent is pulled at its live revision, with the draft revision the pull saw: the next
  // push names it.
  const revisions = Object.fromEntries(
    present.map((asset) => [
      asset.key,
      {
        id: asset.id,
        revision: asset.revision,
        ...(asset.kind === "agent"
          ? { draftRevision: listed.get(asset.key)?.draft?.revision ?? null }
          : {})
      }
    ])
  );
  const selectedKeys = new Set(present.map((asset) => asset.key));
  const absentSelectors = selectors.filter((selector) => !selectedKeys.has(selector.key));
  const agents = selected.agents.sort(byName);
  const skills = selected.skills.sort(byName);
  const guardrails = selected.guardrails.sort(byName);
  const provenance = {
    instance: instance.key,
    ...(overview.version === undefined ? {} : { version: overview.version })
  };
  const agentTargets = agents.map((agent) => ({
    agent,
    path: agentAssetPath(workingDir, agent.name)
  }));
  const skillTargets = skills.map((skill) => ({
    skill,
    path: skillAssetPath(workingDir, skill.name)
  }));
  const guardrailTargets = guardrails.map((guardrail) => ({
    guardrail,
    path: guardrailAssetPath(workingDir, guardrail.name)
  }));
  assertPullTargetsMatchManifest(workingDir, manifest, [
    ...agentTargets.map((target) => ({ kind: "agent" as const, path: target.path })),
    ...skillTargets.map((target) => ({ kind: "skill" as const, path: target.path })),
    ...guardrailTargets.map((target) => ({ kind: "guardrail" as const, path: target.path }))
  ]);
  const desiredPaths = new Set([
    ...agentTargets.map((target) => target.path),
    ...skillTargets.map((target) => target.path),
    ...guardrailTargets.map((target) => target.path)
  ]);

  for (const { agent, path } of agentTargets) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, serializeAgentYaml(agent, provenance), "utf8");
  }
  for (const { skill, path } of skillTargets) {
    await replaceSkillPackage(path, skill, provenance);
  }
  for (const { guardrail, path } of guardrailTargets) {
    await replaceGuardrailFolder(path, guardrail);
  }
  for (const selector of absentSelectors) {
    const path = assetPath(workingDir, selector.kind, selector.name);
    if (!matchesManifestPath(workingDir, path, manifestGlobs(manifest, selector.kind))) {
      throw new Error(`Selected asset path is not matched by catalyst.yaml: ${selector.key}`);
    }
    // An agent is one file; a skill and a guardrail are each a folder.
    await rm(selector.kind === "agent" ? path : dirname(path), {
      recursive: selector.kind !== "agent",
      force: true
    });
  }
  // A working copy of one Namespace or one workspace never names the instance's default agent.
  const fullInstancePull = selectors.length === 0 && holdsWholeInstance(instance);
  if (selectors.length === 0) {
    await removeStaleManifestAssets(workingDir, manifest, desiredPaths);
  }
  if (fullInstancePull) {
    await updateManifestDefaultAgent(
      resolve(workingDir, MANIFEST_FILENAME),
      overview.defaultAgentName
    );
  }
  // A name the last pull knew, or this one asked for, that the instance no longer lists was
  // deleted there. The revision of that delete is what a later push names to create it again.
  const goneKeys =
    selectors.length === 0
      ? Object.keys(baseline?.assets ?? {}).filter((key) => !listing.has(key))
      : absentSelectors.map((selector) => selector.key);
  await recordBaseline(
    workingDir,
    instance.key,
    overview.version ?? 0,
    selected,
    revisions,
    selectors.length === 0,
    fullInstancePull ? (overview.defaultAgentName ?? null) : undefined,
    await readTombstones(api, goneKeys)
  );
  writeOutput(
    options,
    `Pulled ${formatCounts(selected)}${overview.version === undefined ? "" : `, version ${overview.version}`}.${selectors.length === 0 ? "" : " Scoped pull; selected asset baselines updated."}`
  );
  const drafts = pendingDrafts(present.flatMap((asset) => listed.get(asset.key) ?? []));
  if (drafts.length > 0) {
    writeOutput(
      options,
      [
        "Pending agent drafts, not live; the working copy holds each agent's live revision:",
        ...drafts
      ].join("\n")
    );
  }
  return 0;
}

/** One line per pending agent draft of the listing: revision, author and time. */
function pendingDrafts(assets: Iterable<RemoteAsset>): string[] {
  return [...assets].flatMap((asset) =>
    asset.draft === undefined ? [] : [`  ${asset.key}: ${formatDraft(asset.draft)}`]
  );
}

/**
 * The manifest and the instance a pull reads, with the root bound to the workspace `--workspace`
 * names where it is not yet. A root is bound once and stays: one bound elsewhere, one of a
 * Namespace and one that holds the instance's own assets already are refused, so a pull
 * never mixes the assets of two owners in one working copy.
 */
async function bindWorkspace(workingDir: string, options: ConfigCommandOptions) {
  const manifest = await readManifest(workingDir);
  const instance = await resolveInstance(manifest, options);
  const wanted = options.workspace;
  if (wanted === undefined || instance.workspace === wanted) return { manifest, instance };
  if (instance.workspace !== undefined) {
    throw new Error(
      `This working copy is bound to workspace '${instance.workspace}'. Pull another workspace into a directory of its own.`
    );
  }
  if (instance.namespace !== undefined) {
    throw new Error(
      `This working copy belongs to Namespace '${instance.namespace}'. Pull a workspace into a directory of its own.`
    );
  }
  const baseline = (await readStateFile(resolve(workingDir, STATE_FILENAME))).instances[
    instance.key
  ];
  if (baseline !== undefined) {
    throw new Error(
      `This working copy holds the instance's own assets of '${instance.key}'. Pull a workspace into a directory of its own.`
    );
  }
  if (manifest.instances[instance.key] === undefined) {
    throw new Error(
      `Name the instance in ${MANIFEST_FILENAME} to bind it to a workspace: '${instance.key}' is not one of its instances.`
    );
  }
  await bindManifestWorkspace(resolve(workingDir, MANIFEST_FILENAME), instance.key, wanted);
  const bound = await readManifest(workingDir);
  const boundInstance = await resolveInstance(bound, options);
  if (boundInstance.workspace !== wanted) {
    throw new Error(
      `Could not bind instance '${instance.key}' in ${MANIFEST_FILENAME}: add 'workspace: ${wanted}' to that instance yourself, beside its url.`
    );
  }
  writeOutput(options, `Bound this working copy to workspace '${wanted}'.`);
  return { manifest: bound, instance: boundInstance };
}

/** Where a pull writes an asset of the kind: the canonical layout. */
function assetPath(workingDir: string, kind: AssetKindName, name: string): string {
  switch (kind) {
    case "agent":
      return agentAssetPath(workingDir, name);
    case "skill":
      return skillAssetPath(workingDir, name);
    case "guardrail":
      return guardrailAssetPath(workingDir, name);
  }
}

function manifestGlobs(manifest: CatalystManifest, kind: AssetKindName): string[] {
  switch (kind) {
    case "agent":
      return manifest.agents;
    case "skill":
      return manifest.skills;
    case "guardrail":
      return manifest.guardrails ?? [];
  }
}

function assertPullTargetsMatchManifest(
  workingDir: string,
  manifest: CatalystManifest,
  targets: Array<{ kind: AssetKindName; path: string }>
): void {
  const unmatched = targets.filter(
    (target) => !matchesManifestPath(workingDir, target.path, manifestGlobs(manifest, target.kind))
  );
  if (unmatched.length > 0) {
    throw new Error(
      "Pulled assets use the canonical layout (agents/*.agent.yaml, skills/*/SKILL.md and guardrails/*/guardrail.yaml), but one or more target paths are not matched by catalyst.yaml. Use the canonical layout or adjust the manifest globs before pulling."
    );
  }
}

export async function diffConfig(options: ConfigCommandOptions): Promise<number> {
  const workingDir = resolveWorkingDir(options);
  const manifest = await readManifest(workingDir);
  const instance = await resolveInstance(manifest, options);
  const local = await readWorkingCopy(workingDir, manifest);
  const api = await connectApi(instance.url, options, instance);
  const overview = await readInstanceOverview(api, instance);
  const remoteAssets = await listRemoteAssets(api, workingCopyKinds(manifest));
  const baseline = (await readStateFile(resolve(workingDir, STATE_FILENAME))).instances[
    instance.key
  ];
  if (baseline?.assets === undefined) {
    writeOutput(
      options,
      "No per-asset baseline is available. Run 'catalyst config pull' first; local and remote changes cannot yet be distinguished."
    );
    return 1;
  }
  const localAssets = new Map(assetEntries(local).map(byKey));
  const keys = [
    ...new Set([...localAssets.keys(), ...remoteAssets.keys(), ...Object.keys(baseline.assets)])
  ].sort();
  const output: string[] = [];
  for (const key of keys) {
    const localAsset = localAssets.get(key);
    const remoteAsset = remoteAssets.get(key);
    const base = baseline.assets[key];
    const localChanged = localAsset
      ? assetHash(localAsset.contents) !== base?.hash
      : base !== undefined;
    const remoteChanged =
      (remoteAsset?.revision ?? null) !== (base?.revision ?? null) ||
      // Another asset under the name, whatever its number.
      (remoteAsset !== undefined && base !== undefined && remoteAsset.id !== base.id);
    // An agent is compared against its live revision: what this working copy pushed as its
    // draft differs from it until the draft is published.
    const pushedDraft = base?.draftPushed === true && localAsset !== undefined;
    const draft = remoteAsset?.draft;
    if (!localChanged && !remoteChanged && !pushedDraft && draft === undefined) {
      continue;
    }
    const status =
      localChanged && remoteChanged
        ? "conflict"
        : remoteChanged
          ? "remote newer"
          : localChanged
            ? "changed locally"
            : pushedDraft
              ? "pushed as a draft, not live"
              : undefined;
    if (status !== undefined) output.push(`${key}: ${status}`);
    if (draft !== undefined) output.push(`${key}: pending ${formatDraft(draft)}; not live`);
    if ((localChanged || pushedDraft) && !remoteChanged) {
      // The content of the instance's asset is read for the assets changed locally and for
      // no other: the list answers revisions, which is all the rest of the comparison needs.
      const fetched = remoteAsset
        ? await fetchRemoteAsset(api, remoteAsset.kind, remoteAsset.name)
        : undefined;
      const localFiles = canonicalBundleFiles(bundleOf(localAsset ? [localAsset] : []));
      const remoteFiles = canonicalBundleFiles(bundleOf(fetched ? [fetched] : []));
      for (const path of [...new Set([...localFiles.keys(), ...remoteFiles.keys()])].sort()) {
        const diff = createUnifiedDiff(
          { path, contents: remoteFiles.get(path) },
          { path, contents: localFiles.get(path) }
        );
        if (diff) {
          output.push(diff.trimEnd());
        }
      }
    }
  }
  if (baseline.defaultAgentName !== undefined) {
    const localChanged = (local.defaultAgentName ?? null) !== baseline.defaultAgentName;
    const remoteChanged = (overview.defaultAgentName ?? null) !== baseline.defaultAgentName;
    if (localChanged || remoteChanged) {
      output.push(
        `default agent: ${localChanged && remoteChanged ? "conflict" : remoteChanged ? "remote newer" : "changed locally"}`
      );
    }
  }
  writeOutput(options, output.length ? output.join("\n") : "No differences.");
  return output.length ? 1 : 0;
}

export async function validateConfig(options: ConfigCommandOptions): Promise<number> {
  const workingDir = resolveWorkingDir(options);
  const manifest = await readManifest(workingDir);
  const instance = await resolveInstance(manifest, options);
  const bundle = await readWorkingCopy(workingDir, manifest);
  const api = await connectApi(instance.url, options, instance);
  const listing = await listRemoteAssets(api, workingCopyKinds(manifest));
  const deleted = (await readStateFile(resolve(workingDir, STATE_FILENAME))).instances[instance.key]
    ?.deleted;
  // The whole working copy, each asset against the revision the instance holds now: the
  // check says whether a push of everything would be accepted, whatever was pulled last. An
  // asset the instance does not list is a creation, made against the delete this working copy
  // saw of it where there was one. Guardrails are no part of the batch: a push writes each
  // alone, and the instance checks it then.
  const items = assetEntries(bundle)
    .filter((asset) => asset.kind !== "guardrail")
    .map((asset) => ({
      type: "put" as const,
      kind: asset.kind,
      config: { ...asset.config },
      expectedRevision: listing.get(asset.key)?.revision ?? deleted?.[asset.key]?.revision ?? null
    }));
  const guardrails = bundle.guardrails.length;
  const unchecked =
    guardrails === 0
      ? ""
      : ` ${formatCount(guardrails, "guardrail")} ${guardrails === 1 ? "is" : "are"} checked by the instance when a push writes ${guardrails === 1 ? "it" : "them"}.`;
  try {
    if (items.length > 0 || bundle.defaultAgentName !== undefined) {
      const checked = await checkSyncOnThisRelease(api, {
        ...batchScope(instance),
        items,
        ...(bundle.defaultAgentName === undefined
          ? {}
          : { defaultAgentName: bundle.defaultAgentName })
      });
      for (const warning of checked.warnings ?? [])
        writeOutput(options, `Warning: ${warning.message}`);
    }
    writeOutput(options, `Valid: ${formatCounts({ ...bundle, guardrails: [] })}.${unchecked}`);
    return 0;
  } catch (error) {
    const refusal = error instanceof ConfigApiError ? readRefusedBatch(error) : undefined;
    if (!refusal) {
      throw error;
    }
    writeError(options, formatRefusal("Validation failed", refusal));
    return 1;
  }
}

export async function listConfig(options: ConfigCommandOptions): Promise<number> {
  const workingDir = resolveWorkingDir(options);
  const manifest = await readManifest(workingDir);
  const instance = await resolveInstance(manifest, options);
  const local = await readWorkingCopy(workingDir, manifest);
  const api = await connectApi(instance.url, options, instance);
  const version = String((await readInstanceOverview(api, instance)).version ?? "-");
  const remote = await listRemoteAssets(api, workingCopyKinds(manifest));
  const localKeys = new Set(assetEntries(local).map((asset) => asset.key));
  const rows = [
    ...[...remote.values()].map((asset) => ({
      ...asset,
      version,
      status: localKeys.has(asset.key) ? "-" : "missing locally"
    })),
    ...assetEntries(local)
      .filter((asset) => !remote.has(asset.key))
      .map((asset) => ({ ...asset, version: "-", status: "missing remotely" }))
  ].sort((left, right) => left.key.localeCompare(right.key));
  writeOutput(
    options,
    [
      "KIND\tNAME\tREMOTE VERSION\tSTATUS",
      ...rows.map((row) => `${row.kind}\t${row.name}\t${row.version}\t${row.status}`)
    ].join("\n")
  );
  return 0;
}

export async function showConfig(options: ConfigCommandOptions): Promise<number> {
  if (!options.assetKind || !options.assetName) {
    throw new Error("Usage: catalyst config show <agent|skill|guardrail> <name>");
  }
  const workingDir = resolveWorkingDir(options);
  const manifest = await readManifest(workingDir);
  const instance = await resolveInstance(manifest, options);
  const api = await connectApi(instance.url, options, instance);
  const remote = await fetchRemoteAsset(api, options.assetKind, options.assetName);
  if (!remote) {
    throw new Error(`Remote ${options.assetKind} '${options.assetName}' was not found.`);
  }
  writeOutput(options, displayedAsset(remote).trimEnd());
  return 0;
}

function displayedAsset(asset: FetchedAsset): string {
  switch (asset.kind) {
    case "agent":
      return serializeAgentYaml(asset.config);
    case "skill":
      return serializeSkillPackageForDisplay(asset.config);
    case "guardrail": {
      // Shown as the skill package is: the root file, then the file beside it under its name.
      const files = serializeGuardrailFiles(asset.config);
      return files.checkMd === undefined
        ? files.yaml
        : `${files.yaml.trimEnd()}\n\n===== check.md =====\n\n${files.checkMd}`;
    }
  }
}
