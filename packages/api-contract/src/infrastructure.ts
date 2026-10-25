import {
  INFRASTRUCTURE_SECRET_STATES,
  INFRASTRUCTURE_WITHHELD_FIELDS,
  PROVIDER_CHECK_ERROR_CLASSES,
  PROVIDER_PORTS,
  providerRegionSchema
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { timestampSchema } from "./shared";

/** What a row stands for: one of the provider ports, or the database of the instance. */
export const infrastructureClassSchema = z.enum([...PROVIDER_PORTS, "database", "workers"]);
export type InfrastructureClass = z.infer<typeof infrastructureClassSchema>;

/**
 * Who set a provider up. Today every one comes from the release config, which the operator
 * owns. `instance` is for a provider that an admin adds in the running product.
 */
export const infrastructureOriginSchema = z.enum(["operator", "instance"]);
export type InfrastructureOrigin = z.infer<typeof infrastructureOriginSchema>;

/**
 * Why a check counts as failed. A provider's own classes, and `no_report`: the worker that
 * checks the provider has stopped reporting, and `checkedAt` is when it last did.
 */
export const INFRASTRUCTURE_CHECK_ERROR_CLASSES = [
  ...PROVIDER_CHECK_ERROR_CLASSES,
  "no_report"
] as const;

/** The last check of a provider. It carries a class of failure and never a provider's text. */
export const infrastructureCheckSchema = z.discriminatedUnion("status", [
  /** No check of it has ended yet. */
  z.object({ status: z.literal("pending") }),
  /** The process that holds the provider, which is not the API, has not reported a check. */
  z.object({ status: z.literal("not_checked") }),
  z.object({ status: z.literal("ok"), checkedAt: timestampSchema }),
  z.object({
    status: z.literal("failed"),
    checkedAt: timestampSchema,
    errorClass: z.enum(INFRASTRUCTURE_CHECK_ERROR_CLASSES)
  })
]);
export type InfrastructureCheck = z.infer<typeof infrastructureCheckSchema>;

/**
 * A secret a provider takes. `name` is the name the release config declares, shown while it is
 * set. One that is missing is told by `field`, the key of the config that names it: what stands
 * there resolves to nothing, so it is not known to be a name and is not repeated.
 */
export const infrastructureSecretSchema = z.object({
  name: z.string().optional(),
  field: z.string().optional(),
  state: z.enum(INFRASTRUCTURE_SECRET_STATES)
});
export type InfrastructureSecret = z.infer<typeof infrastructureSecretSchema>;

/**
 * One thing the instance runs on, as an operator reads it. It holds the names of the secrets
 * and whether each is set: never a value, a connection string, a key or a path on the host.
 */
export const infrastructureProviderSchema = z.object({
  /** Where the entry sits in the release config, such as `models.azure-eu` or `mail`. */
  id: z.string(),
  class: infrastructureClassSchema,
  /** The name of the entry among several of its class: a model entry, `files`, `workspaces`. */
  name: z.string().optional(),
  /** The adapter that serves it, such as `openai-compatible`, `s3` or `postgres`. */
  type: z.string(),
  origin: infrastructureOriginSchema,
  /** True when data leaves the instance to reach it. Models may leave their region unset. */
  external: z.boolean(),
  region: providerRegionSchema.optional(),
  /** The host the instance calls, without a path, a query or credentials. */
  endpointHost: z.string().optional(),
  bucket: z.string().optional(),
  /**
   * The fields of the config that are set and not shown, because the value does not read as a
   * bare host or as a bucket name.
   */
  withheld: z.array(z.enum(INFRASTRUCTURE_WITHHELD_FIELDS)).optional(),
  secrets: z.array(infrastructureSecretSchema),
  check: infrastructureCheckSchema
});
export type InfrastructureProvider = z.infer<typeof infrastructureProviderSchema>;

export const infrastructureSchema = z.object({
  items: z.array(infrastructureProviderSchema),
  /** How often the instance checks its providers by itself. */
  checkIntervalSeconds: z.number().int().min(1),
  /** From when `instance.infrastructure.check` runs again. Absent when it would run now. */
  checkAvailableAt: timestampSchema.optional(),
  /**
   * Whether the agents can run code now: a worker takes commands and its sandbox answers.
   * `since` is from when that has been so; absent while no check of the sandbox was ever
   * reported. Absent on an instance without a command sandbox.
   */
  codeExecution: z.object({ available: z.boolean(), since: timestampSchema.optional() }).optional(),
  /**
   * The regions a model route has to declare for an agent run to call a personal Connection:
   * release config `modules.connections.personalModelRegions`, `[eu]` where it names none.
   * Absent on an instance without the Connections module.
   */
  personalConnectionModelRegions: z.array(providerRegionSchema).min(1).optional()
});
export type Infrastructure = z.infer<typeof infrastructureSchema>;
