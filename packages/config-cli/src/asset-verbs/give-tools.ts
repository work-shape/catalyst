import { settle, revisionNumber, UsageError, AGENT_KIND } from "./support";
import type { Verb } from "./types";

export const giveToolsVerb: Verb = {
  usage: "give-tools <name> --tool <tool-name>... [--if-revision <n>]",
  summary:
    "Give tools to an instance's own agent, live at once; a pending draft keeps its content and gains them (agents.give_tools)",
  named: true,
  options: {
    tool: { type: "string", multiple: true },
    "if-revision": { type: "string" }
  },
  prepare: (values, name) => {
    const toolNames = (values.tool ?? []).map((tool) => tool.trim()).filter(Boolean);
    if (toolNames.length === 0) throw new UsageError("Missing --tool <tool-name>.");
    const expected =
      values["if-revision"] === undefined ? undefined : revisionNumber(values["if-revision"]);
    return async (session) => {
      if (session.kind.kind !== AGENT_KIND) {
        throw new UsageError("'give-tools' is a command of agents only.");
      }
      if (session.scope.workspaceId !== undefined) {
        throw new UsageError(
          "'give-tools' gives tools to an instance's own agent; a workspace's agent takes them with 'put' and 'publish'."
        );
      }
      // The agent as it is live: its id fences a delete and a new agent of the name, and the
      // revision, where --if-revision names none, the live revision it is given over.
      const live = await session.api.read((client) =>
        client.assets.get({ params: { kind: AGENT_KIND, name }, query: {} })
      );
      const outcome = await session.api.change(
        (client, idempotencyKey) =>
          client.agents.give_tools({
            params: { name },
            body: {
              agentId: live.id,
              toolNames,
              expectedLiveRevision: expected ?? live.revision
            },
            idempotencyKey
          }),
        "It may have been applied: run 'show' before sending it again."
      );
      return settle(
        session,
        outcome,
        (output) => [
          output.givenTools.length === 0
            ? `Agent '${name}' has these tools already; nothing was changed.`
            : `Gave agent '${name}' ${output.givenTools.length === 1 ? "1 tool" : `${output.givenTools.length} tools`} as live revision ${output.publishedRevision} in place of revision ${output.replacedRevision}: ${output.givenTools.join(", ")}. A pending draft keeps its content and has them too.`
        ],
        "If you are an instance approver, you can approve it in the Inbox."
      );
    };
  }
};
