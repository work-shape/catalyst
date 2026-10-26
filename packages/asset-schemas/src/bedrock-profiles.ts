/**
 * The one AWS region the `aws-bedrock` model provider calls. Bedrock's data retention is set to
 * `none` there and nowhere else, and the EU inference profiles route from it to EU regions only.
 */
export const BEDROCK_REGION = "eu-central-1";

const BEDROCK_ARN = /^arn:aws:bedrock:([a-z0-9-]*):(\d{12}):([a-z-]+)\/([a-zA-Z0-9.:_-]+)$/u;
const APPLICATION_INFERENCE_PROFILE = "application-inference-profile";

/** The twelve digits of an AWS account id, the provider's `accountId`. */
export const AWS_ACCOUNT_ID = /^\d{12}$/u;

/**
 * Why a model id is not one the `aws-bedrock` provider calls, or undefined for an application
 * inference profile of the configured account in `BEDROCK_REGION`. A profile of another account
 * is refused before anything is sent: the key would be shown to a resource this instance does
 * not own. Usage on Bedrock is attributed to a consumer by its application inference profile and
 * the consumer's credential may call that alone, so a model id or a shared profile is refused.
 * The reason never repeats the id: an ARN holds the account id. The adapter and the CLI that
 * writes the entry apply the same rule.
 */
export function bedrockProfileRefusal(model: string, accountId: string): string | undefined {
  const arn = BEDROCK_ARN.exec(model);
  if (!arn) {
    return "a model id or a shared inference profile such as 'eu.anthropic.…' is not attributed to this consumer";
  }
  if (arn[3] !== APPLICATION_INFERENCE_PROFILE) {
    return "the ARN names a foundation model or a shared inference profile, which is not attributed to this consumer";
  }
  if (arn[1] !== BEDROCK_REGION) {
    return `the profile is in another region, and calls go to ${BEDROCK_REGION} only`;
  }
  if (arn[2] !== accountId) {
    return "the profile belongs to another AWS account than the provider's 'accountId'";
  }
  return undefined;
}
