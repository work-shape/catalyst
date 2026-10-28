export const PROJECT_ACTIONS = [
  // A project's rights come from membership of its workspace alone (PRJ-1): no grant row, no
  // role default and no bundle carries them, and its audience narrows them further.
  "project.read",
  "project.write",
  "project.delete"
] as const;

/** The kind of a project's definition: a named folder of chat work in one workspace. */
export const PROJECT_ASSET_KIND = "project";

/**
 * Who reads a project, its files and every conversation in it: every member of its workspace,
 * or its creator alone. The same pair a conversation's visibility holds.
 */
export const PROJECT_AUDIENCES = ["workspace", "private"] as const;
export type ProjectAudience = (typeof PROJECT_AUDIENCES)[number];

/** Who made a version of a project file: a person on the page, an agent in a chat, an upload. */
export const PROJECT_FILE_ORIGINS = ["person", "agent", "upload"] as const;

/** What a change did to a project's folder (PRJ-2). */
export const PROJECT_FILE_CHANGES = [
  "created",
  "updated",
  "deleted",
  "restored",
  "unchanged",
  "conflict_copy"
] as const;

/** What a write of an agent in the folder did: it neither deletes nor restores. */
export const PROJECT_FOLDER_WRITE_CHANGES = [
  "created",
  "updated",
  "unchanged",
  "conflict_copy"
] as const satisfies readonly (typeof PROJECT_FILE_CHANGES)[number][];

/** The longest title of a project, in characters. */
export const PROJECT_TITLE_MAX_LENGTH = 120;
/** The longest description of a project, in characters. */
export const PROJECT_DESCRIPTION_MAX_LENGTH = 500;

/**
 * The name the server makes of a title: lowercase words joined by hyphens, then a hyphen and a
 * random suffix. A person never types it, and it never changes.
 */
export const PROJECT_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const PROJECT_NAME_MAX_LENGTH = 64;
