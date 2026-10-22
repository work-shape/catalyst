import type { AppPublishReview } from "@work-shape/catalyst-api-contract";
import { ConfigApiError, type ConfigApi } from "./api";

// What one Publish of an App's draft makes live with it (DP-3): the pending Workflows its
// actions reach, children first, read from `apps.publish_review`. The publish names each with
// the revision shown here, and the instance publishes them with the App or none of them.

/** The Workflows a publish names, and the lines that say so before the question. */
export interface PublishTogether {
  workflows: { name: string; revision: number }[];
  lines: string[];
}

const NONE: PublishTogether = { workflows: [], lines: [] };

/**
 * The pending Workflows the App's draft reaches. Only a publish of the draft names them, and
 * one who may not write the App reads no review: the publish then names none, and the
 * instance refuses an App whose Workflow is not live.
 */
export async function appPublishTogether(api: ConfigApi, app: string): Promise<PublishTogether> {
  let review: AppPublishReview;
  try {
    review = await api.read((client) => client.apps.publish_review({ params: { app } }));
  } catch (error) {
    if (error instanceof ConfigApiError && error.status === 403) return NONE;
    throw error;
  }
  const pending = review.workflows.filter((workflow) => workflow.pending);
  if (pending.length === 0) return NONE;
  const named = pending.map(
    (workflow) =>
      `  Workflow '${workflow.title}' (${workflow.name}): ${
        workflow.publishedRevision === undefined
          ? `new, revision ${workflow.draftRevision}`
          : `revision ${workflow.draftRevision} in place of ${workflow.publishedRevision}`
      }${workflow.lastChangedBy ? `, last changed by ${workflow.lastChangedBy}` : ""}${
        workflow.lastTestRun ? `, last test run ${workflow.lastTestRun.status}` : ", not tested"
      }`
  );
  const refusals = pending.flatMap((workflow) =>
    workflow.refusals.map((refusal) => `  Workflow '${workflow.name}': ${refusal.message}`)
  );
  return {
    workflows: pending.map(({ name, draftRevision }) => ({ name, revision: draftRevision })),
    lines: [
      "Publishes together, Workflows first and the App last, or none of them:",
      ...named,
      `  App '${review.app.title}' (${app})`,
      ...(refusals.length > 0 ? ["Would refuse it now:", ...refusals] : [])
    ]
  };
}
