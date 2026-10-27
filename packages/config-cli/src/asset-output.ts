import { isRecord } from "@work-shape/catalyst-asset-schemas";
import yaml from "js-yaml";
import type {
  Asset,
  AssetSummary,
  ConfigAssetReferences,
  ConfigAssetRevision,
  DryRunGuardrailResponse,
  PlatformContext
} from "@work-shape/catalyst-api-contract";
import { ConfigApiError } from "./api";
import { formatDraft } from "./command-support";

// How the asset commands print what the instance answered. Every line is built from the
// answer; nothing here decides anything.

type AssetKind = PlatformContext["kinds"][number];

export function formatContext(context: PlatformContext): string {
  return [
    `Instance: ${context.instance.name} (${context.instance.id})`,
    `Release: ${context.release.version}`,
    `Actions on the whole instance: ${list(context.actions)}`,
    ...(context.assetActions.length === 0
      ? []
      : [`Actions on single assets or workspaces: ${list(context.assetActions)}`]),
    context.workspaces.length === 0 ? "Workspaces: none" : "Workspaces:",
    ...context.workspaces.map(
      (workspace) => `  ${workspace.id}  ${workspace.name}: ${list(workspace.actions)}`
    ),
    `Kinds: ${context.kinds.map((kind) => kind.kind).join(", ")}`
  ].join("\n");
}

export function formatKinds(kinds: readonly AssetKind[]): string {
  return table(
    ["KIND", "COMMAND", "LIFECYCLE", "CONTENT", "RIGHTS"],
    kinds.map((kind) => [
      kind.kind,
      kindNoun(kind),
      kind.lifecycle === "active" ? "live on write" : "draft, then publish",
      kind.representation === "files" ? `folder (${kind.manifestFile ?? "files"})` : "definition",
      Object.values(kind.actions).join(" ")
    ])
  );
}

export function formatReferences(references: ConfigAssetReferences): string {
  return [
    `Models: ${list(references.modelBindings.map((binding) => binding.label ?? binding.id))}`,
    `Model providers: ${list(references.modelProviderIds)}`,
    `Reasoning efforts: ${list(references.reasoningEfforts)}`,
    `Tools: ${list(references.enabledToolNames)}`
  ].join("\n");
}

/** The word a kind is named by on the command line: its id with dashes, such as `data-store`. */
export function kindNoun(kind: AssetKind): string {
  return kind.kind.replaceAll("_", "-");
}

export function formatAssetList(kind: AssetKind, assets: readonly AssetSummary[]): string {
  if (assets.length === 0) return `No ${kind.plural} you may read.`;
  const published = kind.lifecycle === "draft_published";
  // An agent's pending draft, where the caller may read it.
  const drafts = kind.kind === "agent" && assets.some((asset) => asset.agentDraft !== undefined);
  return table(
    [
      "NAME",
      "REVISION",
      ...(published ? ["PUBLISHED"] : []),
      ...(drafts ? ["DRAFT"] : []),
      "SCOPE",
      "TITLE"
    ],
    assets.map((asset) => [
      `${asset.name}${asset.isDefault ? " (default)" : ""}`,
      String(asset.revision),
      ...(published ? [asset.publishedRevision?.toString() ?? "-"] : []),
      ...(drafts ? [asset.agentDraft?.revision.toString() ?? "-"] : []),
      scopeLabel(asset.scope),
      asset.title
    ])
  );
}

export function formatAsset(asset: Asset): string {
  const facts: Array<[string, string | undefined]> = [
    ["kind", asset.kind],
    ["name", asset.name],
    ["id", asset.id],
    ["revision", String(asset.revision)],
    ["published revision", asset.publishedRevision?.toString()],
    ["pending draft", asset.agentDraft && `${formatDraft(asset.agentDraft)}, not live`],
    ["content of revision", asset.contentRevision?.toString()],
    ["scope", scopeLabel(asset.scope)],
    ["default", asset.isDefault ? "yes" : undefined],
    [
      "available in",
      asset.availability &&
        (asset.availability.mode === "all"
          ? "every workspace"
          : list([
              ...(asset.availability.personalWorkspaces ? ["personal workspaces"] : []),
              ...asset.availability.collaborationWorkspaceIds
            ]))
    ],
    ["updated", asset.updatedAt]
  ];
  const lines = facts.flatMap(([label, value]) =>
    value === undefined ? [] : [`${label}: ${value}`]
  );
  lines.push("---", yaml.dump(asset.config, { lineWidth: -1, noRefs: true }).trimEnd());
  if (asset.files !== undefined) {
    lines.push(
      "---",
      asset.filesOmitted
        ? "files (their contents exceed one read; --json lists the index):"
        : "files:",
      ...asset.files.map((file) => `  ${file.path}  ${file.bytes} bytes  ${file.contentType}`)
    );
  }
  return lines.join("\n");
}

export function formatHistory(revisions: readonly ConfigAssetRevision[]): string {
  return table(
    ["REVISION", "OPERATION", "BY", "AT"],
    revisions.map((revision) => [
      String(revision.revision),
      revision.operation,
      revision.actor?.displayLabel ?? "-",
      revision.createdAt
    ])
  );
}

export function formatWarnings(warnings: ReadonlyArray<{ message: string }>): string[] {
  return warnings.map((warning) => `Warning: ${warning.message}`);
}

/**
 * A refusal of the instance as it said it: the code, the message, and each asset, issue or
 * item its details name. Nothing is reworded, so what a person reads is what the instance
 * decided.
 */
export function formatRefusal(error: ConfigApiError): string {
  const head = `Refused by the instance (HTTP ${error.status}${error.code ? ` ${error.code}` : ""}): ${error.message}`;
  return [head, ...detailLines(error.details)].join("\n");
}

function detailLines(details: unknown): string[] {
  if (!isRecord(details)) return [];
  const lines: string[] = [];
  for (const issue of records(details.issues)) {
    lines.push(`- ${issueLocation(issue)}${String(issue.message)}`);
  }
  for (const conflict of records(details.conflicts)) {
    const at =
      typeof conflict.currentRevision === "number"
        ? `is at revision ${conflict.currentRevision}${conflict.deleted ? " (deleted)" : ""}`
        : conflict.currentRevision === null
          ? "is not on the instance"
          : "changed since it was read";
    const by = typeof conflict.changedBy === "string" ? `, by ${conflict.changedBy}` : "";
    lines.push(`- ${String(conflict.kind)} '${String(conflict.name)}' ${at}${by}`);
  }
  for (const asset of records(details.assets)) {
    lines.push(`- ${String(asset.kind)} '${String(asset.name)}' names no revision`);
  }
  for (const item of records(details.items)) {
    if (isRecord(item.error)) {
      lines.push(
        `- ${String(item.kind)} '${String(item.name ?? item.index)}': ${String(item.error.message)}`
      );
    }
  }
  return lines;
}

/**
 * Where an issue lies: a file of a build with its line and column as `file:line:column: `,
 * the way editors and terminals open them, or the path into a definition.
 */
function issueLocation(issue: Record<string, unknown>): string {
  if (typeof issue.file === "string" && issue.file !== "") {
    const line = typeof issue.line === "number" ? `:${issue.line}` : "";
    const column = line && typeof issue.column === "number" ? `:${issue.column}` : "";
    return `${issue.file}${line}${column}: `;
  }
  return Array.isArray(issue.path) && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
}

function scopeLabel(scope: Asset["scope"]): string {
  return scope.kind === "instance" ? "instance" : `workspace ${scope.workspaceId}`;
}

function list(values: readonly string[]): string {
  return values.length === 0 ? "none" : values.join(", ");
}

function table(head: string[], rows: string[][]): string {
  const widths = head.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column]?.length ?? 0))
  );
  return [head, ...rows]
    .map((row) =>
      row
        .map((cell, column) =>
          column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0)
        )
        .join("  ")
    )
    .join("\n");
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** What a guardrail's dry run would have answered, without names, as its publish prints it first. */
export function formatDryRun(name: string, answer: DryRunGuardrailResponse): string {
  const people = (count: { actions: number; people: number }) =>
    `${count.actions} action${count.actions === 1 ? "" : "s"} by ${count.people} ${count.people === 1 ? "person" : "people"}`;
  return [
    `Dry run of revision ${answer.revision} of guardrail '${name}' on '${answer.event}', over the last ${answer.days} days:`,
    `  would have blocked ${people(answer.wouldBlock)}`,
    `  would have asked for an approval on ${people(answer.wouldRequireApproval)}`,
    `  would have warned on ${people(answer.wouldWarn)}`,
    `  ${answer.evaluated} of ${answer.matched} matching actions checked again${answer.limitedTo === undefined ? "" : ` (at most ${answer.limitedTo})`}${answer.notEvaluable > 0 ? `; ${answer.notEvaluable} could not be, as their content or origin is not kept` : ""}.`,
    "No names are shown and nothing was kept."
  ].join("\n");
}
