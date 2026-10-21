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
  scope: { workspaceId?: string }
) {
  const asset =
    name === null
      ? undefined
      : await api.read((client) => client.assets.get({ params: { kind, name }, query: scope }));
  return api.change(
    (client, idempotencyKey) =>
      client.assets.set_default({
        params: { kind },
        body: { name, ...(asset === undefined ? {} : { expectedAssetId: asset.id }) },
        idempotencyKey
      }),
    "It may have been applied: run 'list' before sending it again."
  );
}
