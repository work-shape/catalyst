export const CONNECTION_ACTIONS = [
  "connection.read",
  "connection.use",
  "connection.write",
  "connection.delete",
  "connection.approve",
  // Adding one's own MCP server, a Connection only its owner uses (PMCP). The role `user`
  // holds it by default; it names no Connection.
  "connection.add_own"
] as const;
