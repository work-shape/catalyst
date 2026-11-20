/**
 * The icons an agent's author may give one of the agent's own starters, by name. The interface
 * draws each on a tile in the colour of the icon's family. A name outside this list is refused when an agent is
 * written; a starter without one shows the icon of an author's request.
 */
export const STARTER_ICON_NAMES = [
  "file-text",
  "file-signature",
  "file-check",
  "file-search",
  "files",
  "folder",
  "clipboard-list",
  "stamp",
  "scale",
  "pencil",
  "book-open",
  "presentation",
  "banknote",
  "euro",
  "hand-coins",
  "receipt",
  "calculator",
  "percent",
  "chart",
  "trending-up",
  "home",
  "building",
  "landmark",
  "key",
  "map-pin",
  "hammer",
  "ruler",
  "users",
  "handshake",
  "message-square",
  "message-circle-question",
  "mail",
  "phone",
  "graduation-cap",
  "calendar",
  "list-checks",
  "list-todo",
  "target",
  "shield-check",
  "lightbulb",
  "sparkles",
  "search",
  "globe"
] as const;

export type StarterIconName = (typeof STARTER_ICON_NAMES)[number];

export function isStarterIconName(value: unknown): value is StarterIconName {
  return (STARTER_ICON_NAMES as readonly unknown[]).includes(value);
}
