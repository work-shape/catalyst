import { workflowPublishReview } from "../workflow-publish-review";
import { writeOutput } from "../command-support";
import {
  OVERTAKEN_LINE,
  agentPublishRefusalHint,
  alreadyLiveLine,
  isAlreadyLive
} from "../publish-question";
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

/** The answer of a publish of the live revision with nothing newer beside it. */
const ALREADY_LIVE: unique symbol = Symbol("already live");

export const publishVerb: Verb = {
  usage: "publish <name> --revision <n> [--yes] [--confirm <blocked>]",
  summary:
    "Make one revision the one its users are served (assets.publish), live at once. A guardrail shows its dry run first; --yes is accepted and changes nothing. A guardrail of the instance can hold a publish for an approval, and a publish that hands a source's data to people who may not use the source waits in the Inbox until a person who may change the source approves it",
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
      // A publish is its person's own and goes live at once: nothing asks first (PUB-LIVE-1).
      // A Workflow's publish names the Data Stores it publishes first, as its page does (LIVE-2).
      const review =
        session.kind.kind === "workflow"
          ? await workflowPublishReview({
              api: session.api,
              options: session.options,
              scope: session.scope,
              name,
              revision,
              json: values.json
            })
          : undefined;
      const dataStores = review?.dataStores ?? [];
      const agent = session.kind.kind === AGENT_KIND;
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
              idempotencyKey
            }),
          "It may have been applied: run 'show' before sending it again."
        )
        .catch((error: unknown) => {
          // Nothing to do is no failure: the revision is live and no request was filed.
          if (isAlreadyLive(error)) return ALREADY_LIVE;
          const hint = agent ? agentPublishRefusalHint(error) : undefined;
          if (hint === undefined) throw error;
          throw new ExplainedRefusal(error, hint);
        });
      if (typeof outcome === "symbol") {
        const line = alreadyLiveLine(session.kind.kind, name, revision);
        if (session.values.json)
          writeOutput(
            session.options,
            JSON.stringify({ status: "already_live", liveRevision: revision }, null, 2)
          );
        else writeOutput(session.options, line);
        return EXIT.done;
      }
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
        session.kind.actions.approve !== undefined || agent
          ? "If you are an instance approver, you can approve it in the Inbox."
          : undefined,
        OVERTAKEN_LINE
      );
    };
  }
};
