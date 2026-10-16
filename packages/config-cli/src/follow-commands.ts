import { MAX_LIST_LIMIT, type ApprovalRequestView } from "@work-shape/catalyst-api-contract";
import type { ConfigApi } from "./api";
import type { ConfigCommandOptions } from "./command-support";

const EXIT = { done: 0, refused: 1, pending: 3 } as const;

/** Follow the caller's durable call or approval requests; the server enforces ownership. */
export async function runFollowCommand(
  api: ConfigApi,
  command: "operation" | "requests",
  input: { runId: string; json: boolean; withdraw?: string },
  options: ConfigCommandOptions
): Promise<number> {
  const { runId, json, withdraw } = input;
  const out = (value: unknown, text: () => string) =>
    (options.stdout ?? ((value: string) => process.stdout.write(value)))(
      `${json ? JSON.stringify(value, null, 2) : text()}\n`
    );
  if (command === "operation") {
    const run = await api.read((client) => client.operations.get_run({ params: { runId } }));
    out(run, () =>
      [
        `${run.id}: ${run.operation} — ${run.status}`,
        ...(run.decision
          ? [
              `Decision: ${run.decision.mode} by ${run.decision.byLabel ?? run.decision.by} at ${run.decision.at}`,
              ...(run.decision.comment ? [run.decision.comment] : [])
            ]
          : []),
        ...(run.error ? [`${run.error.code}: ${run.error.message}`] : [])
      ].join("\n")
    );
    if (run.status === "pending_approval" || run.status === "pending_confirmation")
      return EXIT.pending;
    if (run.status === "failed" || run.status === "denied" || run.status === "expired")
      return EXIT.refused;
  } else if (command === "requests") {
    if (withdraw !== undefined) {
      const requestId = withdraw;
      const request = await api.change(
        (client) => client.approval_requests.withdraw({ params: { requestId } }),
        "Read your requests before trying the withdrawal again."
      );
      out(request, () => `${request.id}: ${request.status}`);
    } else {
      const items: ApprovalRequestView[] = [];
      let cursor: string | undefined;
      do {
        const page = await api.read((client) =>
          client.approval_requests.list_mine({
            query: { limit: MAX_LIST_LIMIT, ...(cursor === undefined ? {} : { cursor }) }
          })
        );
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      out(items, () =>
        [
          "ID\tSTATUS\tSUMMARY\tDECISION",
          ...items.map(
            (request) =>
              `${request.id}\t${request.status}\t${request.summary}\t${request.decision?.decidedByLabel ?? ""}${request.decision?.comment ? `: ${request.decision.comment}` : ""}`
          )
        ].join("\n")
      );
    }
  }
  return EXIT.done;
}
