export const AGENT_ACTIONS = [
  "agent.read",
  "agent.write",
  "agent.publish",
  // Decides a held publish of an agent a workspace owns (WS-PUB-1b).
  "agent.approve",
  "agent.delete",
  // Converse with the agent where it is available (AGENT-USE-1).
  "agent.use"
] as const;
