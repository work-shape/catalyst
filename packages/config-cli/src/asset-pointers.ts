import type { OperationInput } from "@work-shape/catalyst-api-client";
import type { ConfigApi } from "./api";

/** A pointer changes only the asset and availability read before the changing call. */
export async function setAvailability(
  api: ConfigApi,
  kind: string,
  name: string,
  body: OperationInput<"assets.set_availability">["body"],
  scope: { workspaceId?: string }
) {
  const asset = await api.read((client) =>
    client.assets.get({ params: { kind, name }, query: scope })
  );
  return api.change(
    (client, idempotencyKey) =>
      client.assets.set_availability({
        params: { kind, name },
        body: {
          ...body,
          expectedAssetId: asset.id,
          expectedAvailability: asset.availability ?? null
        },
        idempotencyKey
      }),
    "It may have been applied: run 'show' before sending it again."
  );
}

export async function setDefault(
  api: ConfigApi,
  kind: string,
  name: string | null,
  scope: { workspaceId?: string },
  /** A Shared Workspace whose own default this sets, instead of the instance's. */
  defaultOf?: string
) {
  // A workspace's owner may set its default without the right to read the agent, so the
  // workspace form compares nothing; the store checks the agent is available there.
  const asset =
    name === null || defaultOf !== undefined
      ? undefined
      : await api.read((client) => client.assets.get({ params: { kind, name }, query: scope }));
  return api.change(
    (client, idempotencyKey) =>
      client.assets.set_default({
        params: { kind },
        body: {
          name,
          ...(asset === undefined ? {} : { expectedAssetId: asset.id }),
          ...(defaultOf === undefined ? {} : { workspaceId: defaultOf })
        },
        idempotencyKey
      }),
    "It may have been applied: run 'list' before sending it again."
  );
}
