import { parseArgs } from "node:util";
import type { Infrastructure, InfrastructureProvider } from "@work-shape/catalyst-api-contract";
import { isPlainConfigObject } from "@work-shape/catalyst-asset-schemas";
import { ConfigApiError, toConfigApiError } from "./api";
import { formatRefusal } from "./asset-output";
import {
  formatCommandError,
  isRecord,
  openInstance,
  writeError,
  writeOutput,
  type ConfigCommandOptions
} from "./command-support";
import {
  COMMON_FIELDS,
  idRefusal,
  MODEL_PROVIDER_KINDS,
  PROVIDER_KINDS,
  priceRefusal,
  regionRefusal,
  secretNameRefusal,
  type ModelProviderKind,
  type ProviderField
} from "./model-provider-kinds";
import {
  addToReleaseConfigFile,
  fileSetting,
  locateReleaseConfig,
  overlaysReplacing,
  readReleaseConfig,
  RELEASE_CONFIG_CANDIDATES,
  ReleaseConfigError,
  shownPath,
  valueAt,
  type ReleaseConfig,
  type ReleaseConfigAddition
} from "./release-config-file";

const BINDINGS = ["modelBindings"] as const;
const PRICES = ["usage", "costs", "customer", "models"] as const;
const DEFAULT_CURRENCY = "EUR";

export const modelsHelpText = `Usage: catalyst models <add|check|list> [options]

Model providers of a deployment repository's release config, and their state on an instance.

Commands:
  catalyst models add <${MODEL_PROVIDER_KINDS.join("|")}>
      Write a model provider into the release config: its entry under infrastructure.models,
      a model binding and its price. Prints the one secret to set. It never asks for a key
      and never writes one
  catalyst models check <id>
      Check the provider on a running instance, where its key is (instance.infrastructure.check)
  catalyst models list
      The model providers of the release config; with --instance, also what the instance
      reports for each (instance.infrastructure.get)

Options of add:
  --id <id>                 The provider's id (azure: azure-eu, vertex: vertex-eu,
                            bedrock: bedrock-eu; openai-compatible: required)
  --binding <id>            The model binding's id (default: the provider's id)
  --model <name>            azure: the deployment; vertex: the Gemini model; bedrock: the ARN
                            of the application inference profile; openai-compatible: the model
  --endpoint <url>          azure: the resource's endpoint
  --api <responses|chat_completions>
                            azure (default responses) and openai-compatible
  --project <id>            vertex: the Google Cloud project
  --account <12 digits>     bedrock: the AWS account (default: the one the ARN names)
  --base-url <url>          openai-compatible: the base address of the API
  --auth <bearer|api-key>   openai-compatible: how the key is sent (default bearer)
  --label <name>            The name people read for the model (required for bedrock)
  --vendor <name>           Who makes the model, for its logo
  --fallback <binding>      The chat binding that answers when this model is overloaded or
                            cannot be reached; it must be on a provider with region eu
  --secret <NAME>           The name of the secret that holds the key. Never the key
  --region eu               The only region this command writes
  --input-price <n>         Price of a million uncached input tokens
  --cached-input-price <n>  Price of a million cached input tokens
  --output-price <n>        Price of a million output tokens
  --currency <ABC>          The rate card's currency where the config has none yet (EUR)

Common options:
  --config <file>           The release config (default: ${RELEASE_CONFIG_CANDIDATES.join(", then ")})
  --instance <name-or-url>  The instance check and list ask
  --json                    check and list: print JSON
  --help                    Show this help

At a terminal, add asks for what its flags leave out. A provider is added in the EU only:
another region is refused with the reason. Who may add one is whoever may change and deploy
the deployment repository; check asks the instance and needs the right of the Infrastructure page
(system.view). Exit codes: 0 done or ok, 1 refused or the check failed, 2 usage.
`;

class UsageError extends Error {}

type Options = ConfigCommandOptions;

export async function runModelsCommand(argv: readonly string[], base: Options): Promise<number> {
  const verb = argv[1];
  if (verb === undefined || verb === "--help" || verb === "-h") {
    writeOutput(base, modelsHelpText.trimEnd());
    return 0;
  }
  try {
    let parsed;
    try {
      parsed = parseArgs({
        args: argv.slice(2),
        options: {
          id: { type: "string" },
          binding: { type: "string" },
          model: { type: "string" },
          endpoint: { type: "string" },
          api: { type: "string" },
          project: { type: "string" },
          account: { type: "string" },
          "base-url": { type: "string" },
          auth: { type: "string" },
          label: { type: "string" },
          vendor: { type: "string" },
          fallback: { type: "string" },
          secret: { type: "string" },
          region: { type: "string" },
          "input-price": { type: "string" },
          "cached-input-price": { type: "string" },
          "output-price": { type: "string" },
          currency: { type: "string" },
          config: { type: "string" },
          instance: { type: "string" },
          dir: { type: "string" },
          json: { type: "boolean" },
          help: { type: "boolean", short: "h" }
        },
        allowPositionals: true,
        strict: true
      });
    } catch {
      // An unknown flag or a stray word may be a pasted key. Never repeat it.
      throw new UsageError("Invalid command options. See 'catalyst models --help'.");
    }
    const { values, positionals } = parsed;
    if (values.help) {
      writeOutput(base, modelsHelpText.trimEnd());
      return 0;
    }
    const options: Options = {
      ...base,
      ...(values.instance === undefined ? {} : { instance: values.instance }),
      ...(values.dir === undefined ? {} : { dir: values.dir })
    };
    if (verb === "add") {
      const kind = positionals[0];
      if (positionals.length !== 1 || !isKind(kind))
        throw new UsageError(
          `Usage: catalyst models add <${MODEL_PROVIDER_KINDS.join("|")}> [options]`
        );
      if (values.json)
        throw new UsageError("--json belongs to 'catalyst models check' and 'list'.");
      return await addProvider(kind, values, options);
    }
    if (verb === "check") {
      if (positionals.length !== 1 || !positionals[0])
        throw new UsageError(
          "Usage: catalyst models check <id> [--instance <name-or-url>] [--json]"
        );
      return await checkProvider(positionals[0], values.json === true, options);
    }
    if (verb === "list") {
      if (positionals.length > 0)
        throw new UsageError(
          "Usage: catalyst models list [--config <file>] [--instance <name-or-url>] [--json]"
        );
      return await listProviders(values.config, values.json === true, options);
    }
    throw new UsageError(`Unknown models command. See 'catalyst models --help'.`);
  } catch (error) {
    const converted = toConfigApiError(error);
    writeError(
      base,
      converted instanceof ConfigApiError ? formatRefusal(converted) : formatCommandError(converted)
    );
    return error instanceof UsageError ? 2 : 1;
  }
}

async function addProvider(
  kind: ModelProviderKind,
  flags: Readonly<Record<string, string | boolean | undefined>>,
  options: Options
): Promise<number> {
  const spec = PROVIDER_KINDS[kind];
  const values: Record<string, string> = {};
  for (const [flag, value] of Object.entries(flags))
    if (typeof value === "string") values[flag] = value.trim();

  // Refuse what is wrong before asking for more, so nobody types answers for nothing.
  const region = values.region ?? "eu";
  const regionProblem = regionRefusal(kind, region);
  if (regionProblem) throw new ReleaseConfigError(regionProblem);
  for (const flag of ["model", "endpoint", "api", "project", "account", "base-url", "auth"]) {
    if (values[flag] !== undefined && !spec.fields.some((field) => field.flag === flag))
      throw new UsageError(`--${flag} does not belong to 'catalyst models add ${kind}'.`);
  }
  if (values.secret !== undefined) {
    const refusal = secretNameRefusal(values.secret);
    if (refusal) throw new ReleaseConfigError(refusal);
  }
  if (values.currency !== undefined && !/^[A-Z]{3}$/u.test(values.currency))
    throw new UsageError("--currency must be three upper-case letters, such as EUR.");

  const path = await locateReleaseConfig(
    options.cwd,
    typeof flags.config === "string" ? flags.config : undefined
  );
  const shown = shownPath(options.cwd, path);
  const config = await readReleaseConfig(path);

  const fields: ProviderField[] = [
    ...(spec.defaultId === undefined
      ? [{ flag: "id", question: "Id of the provider, such as acme-eu", required: true }]
      : []),
    ...spec.fields,
    ...COMMON_FIELDS
  ];
  const missing = fields.filter((field) => field.required && values[field.flag] === undefined);
  if (missing.length > 0 && options.prompt === undefined) {
    throw new UsageError(
      `Missing ${missing.map((field) => `--${field.flag}`).join(", ")}. See 'catalyst models --help'.`
    );
  }
  const card = valueAt(config.merged, ["usage", "costs", "customer"]);
  const currency =
    isPlainConfigObject(card) && typeof card.currency === "string"
      ? card.currency
      : (values.currency ?? DEFAULT_CURRENCY);
  for (const field of fields) {
    if (values[field.flag] === undefined && field.required) {
      const suffix = field.flag.endsWith("price") ? ` in ${currency}` : "";
      if (options.prompt === undefined) throw new UsageError(`--${field.flag} is required.`);
      const answer = (await options.prompt(`${field.question}${suffix}: `)).trim();
      if (answer === "") throw new UsageError(`--${field.flag} is required.`);
      values[field.flag] = answer;
    }
    const value = values[field.flag];
    if (value === undefined) continue;
    const refusal = field.flag.endsWith("price")
      ? priceRefusal(field.flag, value, spec.pricesAboveZero)
      : field.flag === "id"
        ? idRefusal("id", value)
        : field.refusal?.(value, values);
    if (refusal) throw new ReleaseConfigError(refusal);
  }

  const id = values.id ?? spec.defaultId;
  if (id === undefined) throw new UsageError("--id is required.");
  const bindingId = values.binding ?? id;
  for (const [flag, value] of [
    ["id", id],
    ["binding", bindingId]
  ] as const) {
    const refusal = idRefusal(flag, value);
    if (refusal) throw new ReleaseConfigError(refusal);
  }
  const models = valueAt(config.merged, ["infrastructure", "models"]);
  if (isPlainConfigObject(models) && id in models)
    throw new ReleaseConfigError(
      `The release config already has a model provider '${id}'. Choose another --id.`
    );
  const bindings = valueAt(config.merged, BINDINGS);
  if (
    Array.isArray(bindings) &&
    bindings.some((binding) => isRecord(binding) && binding.id === bindingId)
  )
    throw new ReleaseConfigError(
      `The release config already has a model binding '${bindingId}'. Choose another --binding.`
    );
  if (values.fallback !== undefined) {
    const refusal = fallbackRefusal(values.fallback, bindings, models);
    if (refusal) throw new ReleaseConfigError(refusal);
  }

  const secret = values.secret ?? defaultSecret(kind, id, config);
  if (secret === undefined)
    throw new ReleaseConfigError(`Name the secret that holds the key with --secret <NAME>.`);
  const entry: Record<string, unknown> = { ...spec.entry(values), credentialSecret: secret };
  const model = String(entry.model);
  const binding = {
    id: bindingId,
    providerId: id,
    model,
    ...(values.label === undefined ? {} : { label: values.label }),
    ...((values.vendor ?? spec.vendor) === undefined
      ? {}
      : { vendor: values.vendor ?? spec.vendor }),
    ...(spec.agentSelectable ? {} : { agentSelectable: false }),
    ...(values.fallback === undefined ? {} : { fallback: values.fallback })
  };
  const price = {
    providerId: id,
    model,
    uncachedInputPricePerMillionTokens: Number(values["input-price"]),
    cachedInputPricePerMillionTokens: Number(values["cached-input-price"]),
    outputPricePerMillionTokens: Number(values["output-price"])
  };
  const prices = valueAt(config.merged, PRICES);
  if (
    Array.isArray(prices) &&
    prices.some((row) => isRecord(row) && row.providerId === id && row.model === model)
  )
    throw new ReleaseConfigError(
      `The rate card already prices '${model}' of provider '${id}'. Remove that row, or choose another --id.`
    );

  // A list set in a file this one extends is replaced by one written here, so it stays there.
  const target = config.file;
  for (const list of [BINDINGS, PRICES]) {
    const owner = fileSetting(config, list);
    if (owner !== undefined && owner !== target) {
      const ownerShown = shownPath(options.cwd, owner.path);
      throw new ReleaseConfigError(
        `${shown} takes '${list.join(".")}' from ${ownerShown}; a list written here would replace that one. Add the provider to ${ownerShown} with --config ${ownerShown}. Nothing was written.`
      );
    }
  }
  // An environment file that sets this entry itself would take the new keys into its own.
  const [clash] = await overlaysReplacing(target.path, [["infrastructure", "models", id]]);
  if (clash !== undefined) {
    throw new ReleaseConfigError(
      `${shownPath(options.cwd, clash.file)} already sets a model provider '${id}', and the entry written into ${shown} would merge into it. Choose another --id. Nothing was written.`
    );
  }
  const additions: ReleaseConfigAddition[] = [
    { path: ["infrastructure", "models"], key: id, value: entry },
    { path: BINDINGS, item: binding },
    isPlainConfigObject(card)
      ? { path: PRICES, item: price }
      : {
          path: ["usage", "costs"],
          key: "customer",
          value: {
            id: rateCardId(config),
            version: new Date().toISOString().slice(0, 7),
            currency,
            models: [price]
          }
        }
  ];
  await addToReleaseConfigFile(target, additions, shown);

  const out = (text: string) => writeOutput(options, text);
  out(`Added model provider '${id}' to ${shown}:`);
  const written: [string, string][] = [
    [`infrastructure.models.${id}`, `${spec.provider}, region eu`],
    [
      BINDINGS.join("."),
      `'${bindingId}'${spec.agentSelectable ? "" : ", not offered to agents"}${values.fallback === undefined ? "" : `, falls back to '${values.fallback}'`}`
    ],
    [
      PRICES.join("."),
      `${price.uncachedInputPricePerMillionTokens} input, ${price.cachedInputPricePerMillionTokens} cached input, ${price.outputPricePerMillionTokens} output per million tokens (${currency})`
    ]
  ];
  const width = Math.max(...written.map(([where]) => where.length));
  for (const [where, what] of written) out(`  ${where.padEnd(width)}  ${what}`);
  for (const overlay of await overlaysReplacing(target.path, [BINDINGS, PRICES])) {
    out(
      `Note: ${shownPath(options.cwd, overlay.file)} sets its own '${overlay.list.join(".")}', which replaces this one there: add the ${overlay.list === BINDINGS ? "binding" : "price"} to it as well for that environment.`
    );
  }
  if (!spec.agentSelectable) {
    out(
      `Note: no agent runs on '${bindingId}': the ${spec.provider} adapter carries no tool calls, which every agent run needs. It serves the product's own calls, such as document extraction.`
    );
  }
  out("");
  out("Next:");
  out(
    `  1. Set the secret ${secret} where the instance reads its secrets. It holds ${spec.secretHolds}.`
  );
  out(`     This command never asks for the key and never writes it.`);
  out(`  2. Deploy the release config.`);
  out(`  3. catalyst models check ${id} --instance <url>`);
  return 0;
}

/**
 * Why `--fallback` cannot name this binding: a fallback is another chat binding of the release
 * config, on a provider of the new one's region, eu. `undefined` where it can.
 */
function fallbackRefusal(
  fallbackId: string,
  bindings: unknown,
  models: unknown
): string | undefined {
  const fallback = Array.isArray(bindings)
    ? bindings.find((binding) => isRecord(binding) && binding.id === fallbackId)
    : undefined;
  if (!isRecord(fallback))
    return `The release config has no model binding '${fallbackId}' to fall back to. Name one of its chat bindings with --fallback.`;
  if (fallback.kind === "embedding")
    return `'${fallbackId}' is an embedding binding; a fallback answers chat calls. Name a chat binding with --fallback.`;
  const entry =
    isPlainConfigObject(models) && typeof fallback.providerId === "string"
      ? models[fallback.providerId]
      : undefined;
  const region = isPlainConfigObject(entry) ? entry.region : undefined;
  if (region !== "eu")
    return `'${fallbackId}' runs on a provider with region '${typeof region === "string" ? region : "unset"}', and this provider runs in eu; a fallback runs in the binding's region.`;
  return undefined;
}

/** The provider's own default secret, or one named after the id where another entry uses that. */
function defaultSecret(
  kind: ModelProviderKind,
  id: string,
  config: ReleaseConfig
): string | undefined {
  const spec = PROVIDER_KINDS[kind];
  const models = valueAt(config.merged, ["infrastructure", "models"]);
  const taken = new Set(
    isPlainConfigObject(models)
      ? Object.values(models).flatMap((entry) =>
          isRecord(entry) && typeof entry.credentialSecret === "string"
            ? [entry.credentialSecret]
            : []
        )
      : []
  );
  if (spec.defaultSecret !== undefined && !taken.has(spec.defaultSecret)) return spec.defaultSecret;
  const named = `${id.toUpperCase().replaceAll("-", "_")}_${spec.secretSuffix}`;
  return secretNameRefusal(named) === undefined && !taken.has(named) ? named : undefined;
}

function rateCardId(config: ReleaseConfig): string {
  const instance = valueAt(config.merged, ["clientInstance", "id"]);
  return typeof instance === "string" && instance !== "" ? instance : "rate-card";
}

async function checkProvider(id: string, json: boolean, options: Options): Promise<number> {
  const { api } = await openInstance(options);
  const answer: Infrastructure = await api.read((client) => client.instance.infrastructure.check());
  const item = answer.items.find(
    (candidate) => candidate.class === "models" && candidate.name === id
  );
  if (item === undefined) {
    const known = answer.items
      .filter((candidate) => candidate.class === "models")
      .map((candidate) => candidate.name);
    // A word the instance does not know may be a pasted key: it is not repeated.
    writeError(
      options,
      `The instance has no model provider by that id${known.length > 0 ? ` (it has ${known.join(", ")})` : ""}. Deploy the release config that adds it, then check again.`
    );
    return 1;
  }
  if (json) {
    writeOutput(options, JSON.stringify(item, null, 2));
    return item.check.status === "ok" ? 0 : 1;
  }
  for (const line of describeCheck(item)) writeOutput(options, line);
  return item.check.status === "ok" ? 0 : 1;
}

/** What a check found, in the product's words. A provider's own text is never part of it. */
function describeCheck(item: InfrastructureProvider): string[] {
  const head = `${item.check.status === "ok" ? "ok" : item.check.status === "failed" ? "failed" : item.check.status.replace("_", " ")}  ${item.id}  ${item.type}${item.region ? `, region ${item.region}` : ""}${item.endpointHost ? `, ${item.endpointHost}` : ""}`;
  const lines = [head];
  for (const secret of item.secrets) {
    lines.push(
      `  secret ${secret.name ?? secret.field ?? ""}: ${secret.state === "set" ? "set" : "missing"}`
    );
  }
  const check = item.check;
  if (check.status === "ok") {
    const kind = MODEL_PROVIDER_KINDS.find(
      (candidate) => PROVIDER_KINDS[candidate].provider === item.type
    );
    if (kind !== undefined) lines.push(`  ${PROVIDER_KINDS[kind].checkShows}`);
  } else if (check.status === "failed") {
    lines.push(`  ${check.errorClass}: ${CHECK_SENTENCES[check.errorClass]}`);
  } else if (check.status === "pending") {
    lines.push("  No check of it has ended yet. Check again in a minute.");
  } else {
    lines.push("  The process that holds the provider has not reported a check.");
  }
  return lines;
}

const CHECK_SENTENCES: Record<
  Extract<InfrastructureProvider["check"], { status: "failed" }>["errorClass"],
  string
> = {
  unreachable: "The provider could not be reached.",
  timeout: "The provider did not answer in time.",
  access_denied: "The provider refused the credentials.",
  not_found: "The provider does not know what was asked for.",
  bucket_missing: "The bucket does not exist. The check does not create it.",
  rejected: "The provider refused the request.",
  failed: "The check failed.",
  no_report: "The worker that checks the provider has stopped reporting."
};

interface ListedProvider {
  id: string;
  provider: string;
  region?: string;
  model?: string;
  secret?: string;
  bindings: string[];
  priced: boolean;
  instance?:
    | { secrets: InfrastructureProvider["secrets"]; check: InfrastructureProvider["check"] }
    | "absent";
}

async function listProviders(
  configFlag: string | undefined,
  json: boolean,
  options: Options
): Promise<number> {
  const path = await locateReleaseConfig(options.cwd, configFlag);
  const config = await readReleaseConfig(path);
  const models = valueAt(config.merged, ["infrastructure", "models"]);
  const bindings = valueAt(config.merged, BINDINGS);
  const prices = valueAt(config.merged, PRICES);
  const listed: ListedProvider[] = Object.entries(isPlainConfigObject(models) ? models : {}).map(
    ([id, entry]) => {
      const record = isRecord(entry) ? entry : {};
      const ownBindings = (Array.isArray(bindings) ? bindings : []).filter(
        (binding): binding is Record<string, unknown> =>
          isRecord(binding) && binding.providerId === id
      );
      const billed = [record.model, ...ownBindings.map((binding) => binding.model)].filter(
        (model): model is string => typeof model === "string"
      );
      return {
        id,
        provider: typeof record.provider === "string" ? record.provider : "?",
        ...(typeof record.region === "string" ? { region: record.region } : {}),
        ...(typeof record.model === "string" ? { model: record.model } : {}),
        ...(typeof record.credentialSecret === "string" ? { secret: record.credentialSecret } : {}),
        bindings: ownBindings.map((binding) => String(binding.id)),
        priced:
          billed.length > 0 &&
          billed.every((model) =>
            (Array.isArray(prices) ? prices : []).some(
              (row) => isRecord(row) && row.providerId === id && row.model === model
            )
          )
      };
    }
  );
  if (options.instance !== undefined) {
    const { api } = await openInstance(options);
    const answer: Infrastructure = await api.read((client) => client.instance.infrastructure.get());
    for (const provider of listed) {
      const item = answer.items.find(
        (candidate) => candidate.class === "models" && candidate.name === provider.id
      );
      provider.instance =
        item === undefined ? "absent" : { secrets: item.secrets, check: item.check };
    }
  }
  if (json) {
    writeOutput(
      options,
      JSON.stringify({ config: shownPath(options.cwd, path), providers: listed }, null, 2)
    );
    return 0;
  }
  writeOutput(options, `Model providers of ${shownPath(options.cwd, path)}:`);
  for (const provider of listed) {
    const state =
      provider.instance === undefined
        ? ""
        : provider.instance === "absent"
          ? "  instance: not deployed"
          : `  instance: ${provider.instance.check.status === "failed" ? `failed (${provider.instance.check.errorClass})` : provider.instance.check.status.replace("_", " ")}${provider.instance.secrets.some((secret) => secret.state === "missing") ? ", secret missing" : ""}`;
    writeOutput(
      options,
      `  ${provider.id}  ${provider.provider}, region ${provider.region ?? "unset"}${provider.secret ? `, secret ${provider.secret}` : ""}, bindings: ${provider.bindings.length > 0 ? provider.bindings.join(", ") : "none"}${provider.priced ? "" : ", not priced"}${state}`
    );
  }
  return 0;
}

function isKind(value: string | undefined): value is ModelProviderKind {
  return MODEL_PROVIDER_KINDS.some((kind) => kind === value);
}
