import {
  AWS_ACCOUNT_ID,
  BEDROCK_REGION,
  bedrockProfileRefusal,
  isSecretName,
  OPENAI_COMPATIBLE_APIS,
  MODEL_PROVIDER_AUTH_MODES,
  SECRET_NAME_EXPECTATION
} from "@work-shape/catalyst-asset-schemas";

/** The model providers `catalyst models add` sets up, by the word the person types. */
export const MODEL_PROVIDER_KINDS = ["azure", "vertex", "bedrock", "openai-compatible"] as const;
export type ModelProviderKind = (typeof MODEL_PROVIDER_KINDS)[number];

/** The one region this command writes. Another is the operator's decision, made by hand. */
const ADDED_PROVIDER_REGION = "eu";

/** A value the command takes as `--<flag>` or asks for at a terminal. */
export interface ProviderField {
  flag: string;
  question: string;
  /** Asked for and required. An optional field without a default is left out of the config. */
  required: boolean;
  /** Why a value is refused, or undefined. It never repeats the value. */
  refusal?: (value: string, values: Readonly<Record<string, string>>) => string | undefined;
}

export interface ProviderKind {
  /** The adapter that serves the entry. */
  provider: string;
  summary: string;
  /** The entry id when `--id` is left out; none means the person names it. */
  defaultId?: string;
  /** The secret the adapter reads when the config names none, and what it holds. */
  defaultSecret?: string;
  secretSuffix: string;
  secretHolds: string;
  vendor?: string;
  /** False where the adapter cannot run an agent: its binding serves the product's own calls. */
  agentSelectable: boolean;
  /** Every price must be above zero: the provider bills every token to the consumer. */
  pricesAboveZero: boolean;
  fields: readonly ProviderField[];
  /** The entry of `infrastructure.models` the values make, without `credentialSecret`. */
  entry(values: Readonly<Record<string, string>>): Record<string, unknown>;
  /** What a check that answers ok shows, and what it does not. */
  checkShows: string;
}

const httpsUrl = (what: string) => (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${what} must be an https:// address.`;
  }
  if (url.protocol !== "https:") return `${what} must be an https:// address.`;
  if (url.username || url.password || url.search || url.hash)
    return `${what} must carry no credentials, query or fragment.`;
  return undefined;
};
const word = (what: string) => (value: string) =>
  /^\S+$/u.test(value) ? undefined : `${what} must be one word without spaces.`;
const oneOf = (what: string, allowed: readonly string[]) => (value: string) =>
  allowed.includes(value) ? undefined : `${what} must be one of ${allowed.join(", ")}.`;

/** The v1 base address of an Azure OpenAI resource, from the address the portal shows. */
function azureBaseUrl(endpoint: string): string {
  const url = new URL(endpoint);
  const path = url.pathname.replace(/\/+$/u, "");
  return `${url.origin}${path.endsWith("/openai/v1") ? path : `${path}/openai/v1`}`;
}

export const PROVIDER_KINDS: Record<ModelProviderKind, ProviderKind> = {
  azure: {
    provider: "openai-compatible",
    summary: "Azure OpenAI: a deployment of an Azure OpenAI resource in an EU region",
    defaultId: "azure-eu",
    defaultSecret: "AZURE_OPENAI_API_KEY",
    secretSuffix: "API_KEY",
    secretHolds: "a key of the Azure OpenAI resource",
    vendor: "openai",
    agentSelectable: true,
    pricesAboveZero: false,
    fields: [
      {
        flag: "endpoint",
        question: "Endpoint of the Azure OpenAI resource (https://<resource>.openai.azure.com)",
        required: true,
        refusal: httpsUrl("--endpoint")
      },
      {
        flag: "model",
        question: "Name of the deployment on that resource",
        required: true,
        refusal: word("--model")
      },
      {
        flag: "api",
        question: "API of the deployment (responses or chat_completions)",
        required: false,
        refusal: oneOf("--api", OPENAI_COMPATIBLE_APIS)
      }
    ],
    entry: (values) => ({
      provider: "openai-compatible",
      region: ADDED_PROVIDER_REGION,
      api: values.api ?? "responses",
      model: values.model,
      baseUrl: azureBaseUrl(required(values, "endpoint")),
      authMode: "api-key"
    }),
    checkShows:
      "The check listed the models of the resource with the key. It does not call the deployment."
  },
  vertex: {
    provider: "google-vertex",
    summary: "Gemini on Vertex AI over Google's EU endpoint, for the product's own calls",
    defaultId: "vertex-eu",
    defaultSecret: "GOOGLE_VERTEX_CREDENTIALS",
    secretSuffix: "CREDENTIALS",
    secretHolds:
      "the JSON key of a service account with the role Vertex AI User (with the environment provider, mount the file and set <NAME>_FILE to its path)",
    vendor: "google",
    // The adapter carries no tool calls, which every agent run needs.
    agentSelectable: false,
    pricesAboveZero: false,
    fields: [
      {
        flag: "project",
        question: "Google Cloud project id",
        required: true,
        refusal: (value) =>
          /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(value)
            ? undefined
            : "--project must be a Google Cloud project id: 6 to 30 lower-case letters, digits and hyphens."
      },
      {
        flag: "model",
        question: "Gemini model, such as gemini-3.1-flash-lite",
        required: true,
        refusal: word("--model")
      }
    ],
    entry: (values) => ({
      provider: "google-vertex",
      region: ADDED_PROVIDER_REGION,
      model: values.model,
      projectId: values.project
    }),
    checkShows:
      "The check asked Google for a token with the key: the key is taken. It does not show that the account may call the model."
  },
  bedrock: {
    provider: "aws-bedrock",
    summary: `Claude on Amazon Bedrock in ${BEDROCK_REGION}, through an application inference profile`,
    defaultId: "bedrock-eu",
    defaultSecret: "AWS_BEARER_TOKEN_BEDROCK",
    secretSuffix: "BEARER_TOKEN",
    secretHolds: "a Bedrock API key",
    vendor: "anthropic",
    agentSelectable: true,
    pricesAboveZero: true,
    fields: [
      {
        flag: "model",
        question: `ARN of the application inference profile in ${BEDROCK_REGION}`,
        required: true,
        refusal: (value, values) => {
          const account = values.account ?? accountOfProfile(value);
          const refusal = bedrockProfileRefusal(value, account ?? "");
          return refusal === undefined
            ? undefined
            : `--model must be the ARN of an application inference profile in ${BEDROCK_REGION}: ${refusal}.`;
        }
      },
      {
        flag: "account",
        question: "AWS account id of the profile (12 digits)",
        required: false,
        refusal: (value) =>
          AWS_ACCOUNT_ID.test(value)
            ? undefined
            : "--account must be the 12 digits of an AWS account id."
      },
      {
        flag: "label",
        question: "Name people read for the model, such as Claude Sonnet 4.6",
        required: true
      }
    ],
    entry: (values) => ({
      provider: "aws-bedrock",
      region: ADDED_PROVIDER_REGION,
      accountId: values.account ?? accountOfProfile(required(values, "model")),
      model: values.model
    }),
    checkShows:
      "The check sent the key with a request Bedrock refuses as invalid: the key is taken. It does not show that the key may call the profile."
  },
  "openai-compatible": {
    provider: "openai-compatible",
    summary: "Any endpoint that speaks the OpenAI API, hosted in an EU region",
    secretSuffix: "API_KEY",
    secretHolds: "the API key of the endpoint",
    agentSelectable: true,
    pricesAboveZero: false,
    fields: [
      {
        flag: "base-url",
        question: "Base address of the API (https://<host>/v1)",
        required: true,
        refusal: httpsUrl("--base-url")
      },
      { flag: "model", question: "Model name", required: true, refusal: word("--model") },
      {
        flag: "api",
        question: "API (responses or chat_completions)",
        required: false,
        refusal: oneOf("--api", OPENAI_COMPATIBLE_APIS)
      },
      {
        flag: "auth",
        question: "How the key is sent (bearer or api-key)",
        required: false,
        refusal: oneOf("--auth", MODEL_PROVIDER_AUTH_MODES)
      }
    ],
    entry: (values) => ({
      provider: "openai-compatible",
      region: ADDED_PROVIDER_REGION,
      ...(values.api === undefined ? {} : { api: values.api }),
      model: values.model,
      baseUrl: required(values, "base-url").replace(/\/+$/u, ""),
      ...(values.auth === undefined ? {} : { authMode: values.auth })
    }),
    checkShows:
      "The check listed the models of the endpoint with the key. It does not call the model."
  }
};

/** A value the command asked for before it built the entry. */
function required(values: Readonly<Record<string, string>>, flag: string): string {
  const value = values[flag];
  if (value === undefined) throw new Error(`--${flag} is required.`);
  return value;
}

/** The account id an ARN names, where it reads as one. */
function accountOfProfile(arn: string): string | undefined {
  const account = arn.split(":")[4];
  return account !== undefined && AWS_ACCOUNT_ID.test(account) ? account : undefined;
}

/** The fields every kind takes besides its own. */
export const COMMON_FIELDS: readonly ProviderField[] = [
  {
    flag: "input-price",
    question: "Price of a million uncached input tokens",
    required: true
  },
  {
    flag: "cached-input-price",
    question: "Price of a million cached input tokens",
    required: true
  },
  { flag: "output-price", question: "Price of a million output tokens", required: true }
];

/** Ids of entries and bindings: what a person reads and an agent's config refers to. */
export function idRefusal(flag: string, value: string): string | undefined {
  return /^[a-z][a-z0-9-]{0,47}$/u.test(value)
    ? undefined
    : `--${flag} must be lower-case letters, digits and hyphens, starting with a letter, at most 48 characters.`;
}

/** Why a secret name is refused. The value is never repeated: it may be a pasted key. */
export function secretNameRefusal(value: string): string | undefined {
  return isSecretName(value) ? undefined : `--secret is refused: ${SECRET_NAME_EXPECTATION}.`;
}

/** Why a price is refused. */
export function priceRefusal(flag: string, value: string, aboveZero: boolean): string | undefined {
  const price = Number(value);
  if (value.trim() === "" || !Number.isFinite(price) || price < 0)
    return `--${flag} must be a number of at least zero.`;
  if (aboveZero && price === 0)
    return `--${flag} must be above zero: this provider bills every token, and the instance makes no call it cannot price.`;
  return undefined;
}

/** The reason a region other than `eu` is refused. */
export function regionRefusal(kind: ModelProviderKind, region: string): string | undefined {
  if (region === ADDED_PROVIDER_REGION) return undefined;
  const where =
    kind === "bedrock"
      ? `Bedrock is called in ${BEDROCK_REGION} only`
      : kind === "vertex"
        ? "Vertex is called over Google's EU endpoint"
        : "the endpoint must be deployed in an EU region";
  return `--region must be 'eu': a provider added with this command processes data in the EU, and ${where}. A provider outside the EU is a decision for the release config's owner, written there by hand.`;
}
