const SECRET_NAME_MAX_LENGTH = 64;
const SECRET_NAME_SINGLE_WORD_MAX_LENGTH = 12;
// A word of a name is short and carries at most two digits (`S3`, `E2E`, `OAUTH2`) or is a
// short number. A credential is one long run, or mixes many digits into its letters.
const SECRET_NAME_WORD = /^[A-Z0-9]{1,16}$/u;
const SECRET_NAME_WORD_MAX_DIGITS = 2;
// The shapes of well-known credentials, in any case: an AWS access key id, a GitHub token, a
// Google API key, a Slack token and a JSON Web Token. Each is the prefix with what follows it
// in a real credential, so a name such as GHOST_API_KEY or ASIA_MODEL_KEY is not one.
const CREDENTIAL_SHAPE =
  /^(?:(?:AKIA|ASIA)[A-Z0-9]{16}$|GH[OPRSU]_[A-Z0-9]{20,}|AIZA[A-Z0-9_-]{30,}|XOX[A-Z]-|EYJ[A-Z0-9_-]{16,})/iu;
/** Why a reference is refused as a secret name. It never repeats the reference. */
export const SECRET_NAME_EXPECTATION =
  "expected the name of an environment variable such as MODEL_API_KEY (upper-case words joined by underscores, at most 64 characters); the value given does not read as one and looks like a credential value";

/**
 * True for text that is safe to repeat as the name of a secret: it reads as an environment
 * variable name and not as a credential. Anything else is refused as a name and is never put
 * into a message, a log line or an error. The instance and the CLI apply the same rule.
 */
export function isSecretName(value: string): boolean {
  if (value.length > SECRET_NAME_MAX_LENGTH || CREDENTIAL_SHAPE.test(value)) {
    return false;
  }
  const words = value.split("_");
  if (words.length === 1 && value.length > SECRET_NAME_SINGLE_WORD_MAX_LENGTH) {
    return false;
  }
  return /^[A-Z]/u.test(value) && words.every(isSecretNameWord);
}

function isSecretNameWord(word: string): boolean {
  if (!SECRET_NAME_WORD.test(word)) {
    return false;
  }
  const digits = word.replace(/[A-Z]/gu, "").length;
  return digits === word.length ? word.length <= 4 : digits <= SECRET_NAME_WORD_MAX_DIGITS;
}
