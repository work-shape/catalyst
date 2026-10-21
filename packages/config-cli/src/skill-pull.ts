import { realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { ASSET_GET_FILES_MAX_BYTES } from "@work-shape/catalyst-api-contract";
import type { ConfigApi } from "./api";
import {
  folderIsEmpty,
  localChanges,
  readFolderState,
  replaceFolder,
  refuseLinks
} from "./asset-folder";

const SKILL_STATE_FILE = ".catalyst-skill.json";

/** One authorized read supplies a skill's whole folder. No file in it is ever run. */
export async function pullSkill(input: {
  api: ConfigApi;
  instance: string;
  workspaceId?: string;
  skill: string;
  directory: string;
}) {
  const { api, instance, workspaceId, skill, directory } = input;
  const previous = await pullableFolder(input);
  const asset = await api.read((client) =>
    client.assets.get({
      params: { kind: "skill", name: skill },
      query: { ...(workspaceId === undefined ? {} : { workspaceId }), files: "true" }
    })
  );
  if (asset.filesOmitted || asset.files === undefined) {
    throw new Error(
      `The skill '${skill}' cannot be pulled in one read. SKILL_MAX_BYTES must not exceed ASSET_GET_FILES_MAX_BYTES (${ASSET_GET_FILES_MAX_BYTES} bytes).`
    );
  }
  const revision = asset.contentRevision ?? asset.revision;
  const files = await replaceFolder(
    directory,
    asset.files,
    SKILL_STATE_FILE,
    {
      instance,
      workspaceId: workspaceId ?? "",
      skill,
      assetId: asset.id,
      revision
    },
    async () => {
      const current = await pullableFolder(input);
      if (JSON.stringify(current) !== JSON.stringify(previous))
        throw new Error(
          `'${directory}' changed during the pull. Pull into another folder to compare.`
        );
    }
  );
  return { skill, revision, directory, files };
}

/** Check again after the read and staging: a person may edit while the call is in flight. */
async function pullableFolder(input: {
  instance: string;
  workspaceId?: string;
  skill: string;
  directory: string;
}) {
  const { instance, workspaceId, skill, directory } = input;
  await refuseLinks(directory, false);
  await refuseLinks(join(directory, SKILL_STATE_FILE));
  const previous = await readFolderState(directory, SKILL_STATE_FILE, "skill");
  if (previous === undefined && !(await folderIsEmpty(directory))) {
    throw new Error(
      `'${directory}' holds files and no pulled skill. Pull into an empty or new folder.`
    );
  }
  await refuseLinks(directory);
  const target = await realpath(directory).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  });
  const cwd = await realpath(process.cwd());
  if (target !== undefined && (cwd === target || cwd.startsWith(`${target}${sep}`)))
    throw new Error(
      `'${directory}' contains the current working directory. Pull into another folder.`
    );
  if (previous !== undefined) {
    if (
      previous.name !== skill ||
      previous.instance !== instance ||
      previous.workspaceId !== (workspaceId ?? "")
    ) {
      throw new Error(
        `'${directory}' holds skill '${previous.name}' from another skill or scope. Pull into another folder.`
      );
    }
    const changes = await localChanges(directory, previous, SKILL_STATE_FILE);
    const touched = [...changes.changed, ...changes.added, ...changes.removed];
    if (touched.length > 0)
      throw new Error(
        [
          `'${directory}' has local changes a pull would overwrite. Pull into another folder to compare:`,
          ...touched.sort().map((path) => `- ${path}`)
        ].join("\n")
      );
  }
  return previous;
}
