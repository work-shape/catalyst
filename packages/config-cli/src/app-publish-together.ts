import type { AppPublishReview } from "@work-shape/catalyst-api-contract";
import { ConfigApiError, type ConfigApi } from "./api";

// What one Publish of an App's draft makes live with it (DP-3, GOLIVE-1): the Data Stores it
// binds whose draft is not published, with the migrations each would apply, those live that
// still apply migrations, which the publish waits for, and the pending Workflows its actions
// reach, children first, read from `apps.publish_review`. The publish names each it makes live
// with the revision shown here: the instance publishes the stores and applies their migrations
// first, then the Workflows and the App, or neither the App nor its Workflows.

/** The stores and Workflows a publish names, and the lines that say so before the question. */
export interface PublishTogether {
  workflows: { name: string; revision: number }[];
  dataStores: { name: string; revision: number }[];
  lines: string[];
}

const NONE: PublishTogether = { workflows: [], dataStores: [], lines: [] };

const migrationCount = (count: number) => `${count} migration${count === 1 ? "" : "s"}`;

/**
 * The pending Data Stores and Workflows of the App's draft. Only a publish of the draft names
 * them, and one who may not write the App reads no review: the publish then names none, and
 * the instance refuses an App whose Workflow is not live or whose store is below its level.
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
  const stores = review.dataStores;
  if (pending.length === 0 && stores.length === 0) return NONE;
  // A store that is live and still applying migrations is waited for, not published again.
  const storeLines = stores.map(
    (store) =>
      `  Data Store '${store.title}' (${store.name}): ${
        !store.pending
          ? `live at revision ${store.draftRevision}, still applying migrations: the publish waits for it`
          : store.publishedRevision === undefined
            ? `new, revision ${store.draftRevision}`
            : `revision ${store.draftRevision} in place of ${store.publishedRevision}`
      }, at level ${store.liveLevel}${
        store.pendingMigrations.length > 0
          ? `, applies ${migrationCount(store.pendingMigrations.length)}: ${store.pendingMigrations.join(", ")}`
          : ""
      }`
  );
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
  const refusals = [
    ...stores.flatMap((store) =>
      store.refusals.map((refusal) => `  Data Store '${store.name}': ${refusal.message}`)
    ),
    ...pending.flatMap((workflow) =>
      workflow.refusals.map((refusal) => `  Workflow '${workflow.name}': ${refusal.message}`)
    )
  ];
  return {
    workflows: pending.map(({ name, draftRevision }) => ({ name, revision: draftRevision })),
    dataStores: stores
      .filter((store) => store.pending)
      .map(({ name, draftRevision }) => ({ name, revision: draftRevision })),
    lines: [
      stores.length > 0
        ? "Publishes together: the Data Stores and their migrations first, then the Workflows and the App, or neither the App nor its Workflows:"
        : "Publishes together, Workflows first and the App last, or none of them:",
      ...storeLines,
      ...named,
      `  App '${review.app.title}' (${app})`,
      ...(refusals.length > 0 ? ["Would refuse it now:", ...refusals] : [])
    ]
  };
}
