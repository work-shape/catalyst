import { workflowPublishReview } from "../workflow-publish-review";
import { kindNoun } from "../asset-output";
import { writeOutput } from "../command-support";
import { agentPublishRefusalHint, askBeforePublish } from "../publish-question";
import {
  settle,
  revisionNumber,
  required,
  ExplainedRefusal,
  UsageError,
  EXIT,
  GUARDRAIL_KIND,
  AGENT_KIND
} from "./support";
import { guardrailDryRunBeforePublish } from "./guardrails";
import type { Verb } from "./types";

export const publishVerb: Verb = {
  usage: "publish <name> --revision <n> [--yes] [--confirm <blocked>]",
  summary:
    "Make one revision the one its users are served (assets.publish). A guardrail shows its dry run first; an App, a Workflow or a workspace's agent asks you first. A publish that hands a source's data to people who may not use the source waits in the Inbox until a person who may change the source approves it",
  named: true,
  options: {
    revision: { type: "string" },
    confirm: { type: "string" },
    yes: { type: "boolean", default: false }
  },
  prepare: (values, name) => {
    const revision = revisionNumber(required(values.revision, "--revision <n>"));
    return async (session) => {
      if (session.kind.kind === GUARDRAIL_KIND) {
        const proceed = await guardrailDryRunBeforePublish(session, name, revision);
        if (proceed !== undefined) return proceed;
      } else if (values.confirm !== undefined && session.kind.kind !== "knowledge_base") {
        throw new UsageError("--confirm answers the dry run of a guardrail's publish.");
      }
      if (session.kind.kind === "knowledge_base") {
        const asset = await session.api.read((client) =>
          client.assets.get({
            params: { kind: session.kind.kind, name },
            query: { revision: String(revision), ...session.scope }
          })
        );
        for (const line of asset.publishQuestion ?? []) writeOutput(session.options, line);
      }
      let unattended = false;
      let dataStores: { name: string; revision: number }[] = [];
      // A workspace's agent keeps the question of its publish; the instance's own does not.
      const agent = session.kind.kind === AGENT_KIND;
      const asks = agent
        ? session.scope.workspaceId !== undefined
        : session.kind.actions.approve !== undefined;
      if (asks) {
        // A Workflow's publish names the Data Stores it publishes first, as its page does (LIVE-2).
        const review =
          session.kind.kind === "workflow" && (values.yes || session.options.prompt)
            ? await workflowPublishReview({
                api: session.api,
                options: session.options,
                scope: session.scope,
                name,
                revision,
                json: values.json,
                yes: values.yes
              })
            : undefined;
        dataStores = review?.dataStores ?? [];
        const asked = {
          kind: session.kind.kind,
          command: kindNoun(session.kind),
          name,
          revision
        };
        const answer = await askBeforePublish(session.options, {
          ...asked,
          yes: values.yes,
          ...(review?.details ? { details: review.details } : {})
        });
        if (answer === "refused") return EXIT.refused;
        unattended = answer === "unattended";
      } else if (values.yes && session.kind.kind === "data_store") {
        // As for other publishes, --yes sends an unattended request; a held one exits 3.
        unattended = true;
      } else if (values.yes) {
        throw new UsageError(
          agent
            ? "An instance's own agent is published without a question; --yes answers none."
            : `A ${session.kind.kind} is published without a question; --yes answers none.`
        );
      }
      const outcome = await session.api
        .change(
          (client, idempotencyKey) =>
            client.assets.publish({
              params: { kind: session.kind.kind, name },
              body: {
                revision,
                ...session.scope,
                ...(dataStores.length > 0 ? { dataStores } : {}),
                ...(session.kind.kind === "knowledge_base" && values.confirm
                  ? { confirmProcessing: values.confirm }
                  : {})
              },
              idempotencyKey,
              ...(unattended ? { unattended } : {})
            }),
          "It may have been applied: run 'show' before sending it again."
        )
        .catch((error: unknown) => {
          const hint = agent ? agentPublishRefusalHint(error) : undefined;
          if (hint === undefined) throw error;
          throw new ExplainedRefusal(error, hint);
        });
      return settle(
        session,
        outcome,
        (output) => [
          // The Data Stores a Workflow's publish made live first (LIVE-2), as an App's do.
          ...(output.publishedWith ?? []).map(
            (member) =>
              `Published revision ${member.publishedRevision} of ${member.kind === "data_store" ? "Data Store" : "Workflow"} '${member.name}'.`
          ),
          // An agent's first version without a draft replaces nothing: it is offered as made.
          output.replacedRevision !== undefined && (agent || session.kind.kind === "skill")
            ? `Published draft revision ${output.draftRevision} of ${session.kind.kind} '${name}' as live revision ${output.publishedRevision}${output.replacedRevision === undefined ? "" : ` in place of revision ${output.replacedRevision}`}.`
            : `Published revision ${output.publishedRevision} of ${session.kind.kind} '${name}'${output.replacedRevision === undefined ? "" : ` in place of revision ${output.replacedRevision}`}.`
        ],
        asks ? "If you are an instance approver, you can approve it in the Inbox." : undefined
      );
    };
  }
};
