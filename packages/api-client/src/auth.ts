import { z } from "zod";

/**
 * The sign-in library's mount. It is not a product operation: the library owns its paths and
 * payloads, and a session cookie is the only credential it accepts.
 */
export const AUTH_MOUNT_PATH = "/api/auth";

const authSessionSchema = z
  .object({
    session: z.object({ id: z.string(), userId: z.string(), expiresAt: z.string() }),
    user: z.object({ id: z.string(), email: z.string(), name: z.string() })
  })
  .nullable();

export type AuthSession = NonNullable<z.infer<typeof authSessionSchema>>;

const authFailureSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
  error: z.object({ message: z.string().optional() }).optional()
});

export interface AuthResult {
  ok: boolean;
  /** The sign-in library's code for a refusal, such as `INVALID_EMAIL_OR_PASSWORD`. */
  code?: string;
  message?: string;
  /** The HTTP status of a refusal; 429 is the instance's limit on attempts. */
  status?: number;
}

/** The second factor of a sign-in: a code from the authenticator app, or a backup code. */
export type SecondFactorKind = "app" | "backup";

/** A sign-in: refused, signed in, or waiting for the second factor (TWO-FACTOR-1). */
export interface SignInResult extends AuthResult {
  /** The password was right and the account asks for a code before there is a session. */
  secondFactor?: true;
}

const signInAnswerSchema = z.object({ twoFactorRedirect: z.boolean().optional() });

const twoFactorSetupSchema = z.object({
  totpURI: z.string(),
  backupCodes: z.array(z.string())
});

/** What an authenticator app reads, and the ten backup codes, shown once. */
export interface TwoFactorSetup {
  totpUri: string;
  backupCodes: string[];
}

export async function getAuthSession(apiBaseUrl: string): Promise<AuthSession | null> {
  const response = await fetch(authUrl(apiBaseUrl, "/get-session"), {
    credentials: "include"
  });
  if (!response.ok) {
    return null;
  }
  return authSessionSchema.parse(await response.json());
}

export async function signInWithEmail(input: {
  apiBaseUrl: string;
  email: string;
  password: string;
}): Promise<SignInResult> {
  const response = await fetch(authUrl(input.apiBaseUrl, "/sign-in/email"), {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      rememberMe: true
    })
  });
  if (response.ok) {
    const answer = signInAnswerSchema.safeParse(await response.json().catch(() => undefined));
    return answer.data?.twoFactorRedirect === true
      ? { ok: true, secondFactor: true }
      : { ok: true };
  }
  return failureOf(response, "Sign in failed");
}

/**
 * The second sign-in step: a code from the authenticator app, or a backup code, which signs in
 * once. `trustBrowser` skips the code in this browser for 30 days from now.
 */
export async function verifySecondFactor(input: {
  apiBaseUrl: string;
  code: string;
  kind: SecondFactorKind;
  trustBrowser?: boolean;
}): Promise<AuthResult> {
  const path = input.kind === "app" ? "/two-factor/verify-totp" : "/two-factor/verify-backup-code";
  const response = await postAuth(input.apiBaseUrl, path, {
    code: input.code.replaceAll(/\s/gu, ""),
    trustDevice: input.trustBrowser === true
  });
  return response.ok ? { ok: true } : failureOf(response, "The code was not accepted");
}

/**
 * Starts the setup of two-factor sign-in with the password. The factor is on only after the
 * first code from the app is confirmed with `verifySecondFactor`.
 */
export async function startTwoFactorSetup(input: {
  apiBaseUrl: string;
  password: string;
}): Promise<AuthResult & { setup?: TwoFactorSetup }> {
  const response = await postAuth(input.apiBaseUrl, "/two-factor/enable", {
    password: input.password
  });
  if (!response.ok) {
    return failureOf(response, "Two-factor sign-in could not be set up");
  }
  const setup = twoFactorSetupSchema.parse(await response.json());
  return { ok: true, setup: { totpUri: setup.totpURI, backupCodes: setup.backupCodes } };
}

/** Turns two-factor sign-in off with the password; every trusted browser is forgotten. */
export async function turnOffTwoFactor(input: {
  apiBaseUrl: string;
  password: string;
}): Promise<AuthResult> {
  const response = await postAuth(input.apiBaseUrl, "/two-factor/disable", {
    password: input.password
  });
  return response.ok ? { ok: true } : failureOf(response, "Two-factor sign-in stayed on");
}

/** Replaces all ten backup codes with the password. The new ones are shown once. */
export async function regenerateBackupCodes(input: {
  apiBaseUrl: string;
  password: string;
}): Promise<AuthResult & { backupCodes?: string[] }> {
  const response = await postAuth(input.apiBaseUrl, "/two-factor/generate-backup-codes", {
    password: input.password
  });
  if (!response.ok) {
    return failureOf(response, "No new backup codes were made");
  }
  const { backupCodes } = twoFactorSetupSchema
    .pick({ backupCodes: true })
    .parse(await response.json());
  return { ok: true, backupCodes };
}

/** Every browser of the person asks for the code again at its next sign-in. */
export async function forgetTrustedBrowsers(apiBaseUrl: string): Promise<AuthResult> {
  const response = await postAuth(apiBaseUrl, "/two-factor/forget-trusted-browsers", {});
  return response.ok ? { ok: true } : failureOf(response, "The browsers are still trusted");
}

function postAuth(apiBaseUrl: string, path: string, body: unknown): Promise<Response> {
  return fetch(authUrl(apiBaseUrl, path), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function failureOf(response: Response, fallback: string): Promise<AuthResult> {
  const failure = authFailureSchema.safeParse(await response.json().catch(() => undefined));
  return {
    ok: false,
    status: response.status,
    ...(failure.data?.code === undefined ? {} : { code: failure.data.code }),
    message: failure.data?.message ?? failure.data?.error?.message ?? fallback
  };
}

/**
 * For a tool outside a browser, which keeps no cookies: signs in and returns a fetch that
 * carries the session cookie and the origin the instance trusts on every request.
 */
export async function signInForSessionFetch(input: {
  apiBaseUrl: string;
  origin: string;
  email: string;
  password: string;
  fetchImpl?: typeof fetch;
}): Promise<typeof fetch> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(authUrl(input.apiBaseUrl, "/sign-in/email"), {
    method: "POST",
    headers: { "content-type": "application/json", origin: input.origin },
    body: JSON.stringify({ email: input.email, password: input.password })
  });
  if (!response.ok) {
    throw new Error(`Sign-in as '${input.email}' was refused with status ${response.status}`);
  }
  const answer = signInAnswerSchema.safeParse(
    await response
      .clone()
      .json()
      .catch(() => undefined)
  );
  if (answer.data?.twoFactorRedirect === true) {
    // No session without the second factor: a tool signs in with an API key instead.
    throw new Error(`'${input.email}' signs in with a second factor; use an API key for this tool`);
  }
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  return (resource, init) => {
    const request = new Request(resource, init);
    request.headers.set("cookie", cookie);
    request.headers.set("origin", input.origin);
    return fetchImpl(request);
  };
}

export async function signOut(apiBaseUrl: string): Promise<void> {
  await fetch(authUrl(apiBaseUrl, "/sign-out"), {
    method: "POST",
    credentials: "include"
  });
}

function authUrl(apiBaseUrl: string, path: string): string {
  return `${apiBaseUrl.replace(/\/$/u, "")}${AUTH_MOUNT_PATH}${path}`;
}
