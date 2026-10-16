import {
  appErrorCodeSchema,
  rateLimitedDetailsSchema,
  type ApiErrorCode
} from "@work-shape/catalyst-api-contract";
import { z } from "zod";

/**
 * Every way a call can fail once its input was accepted. `status` is the HTTP status, or 0 when
 * no response arrived. `payload` is what the server sent with a refusal; when the request never
 * got an answer or the answer could not be read, it is the underlying failure.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: ApiErrorCode;
  readonly payload: unknown;
  readonly correlationId?: string;
  /** How long a caller over a rate limit has to wait, from a 429 `RATE_LIMITED` answer. */
  readonly retryAfterSeconds?: number;

  constructor(status: number, message: string, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = readApiErrorCode(payload);
    this.payload = payload;
    this.correlationId = readCorrelationId(payload);
    this.retryAfterSeconds = readRetryAfterSeconds(payload);
  }
}

const REQUEST_FAILED = "API request failed";

/** The request got no answer, or the answer broke off. */
export function transportError(cause: unknown): ApiError {
  return new ApiError(0, REQUEST_FAILED, cause);
}

/** The server refused the call. Its body is untrusted and need not be an error envelope. */
export async function refusalError(response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => "");
  const payload = parseJsonOrText(text);
  return new ApiError(response.status, readErrorMessage(payload) ?? REQUEST_FAILED, payload);
}

/** The server answered a success whose body cannot be read as JSON. */
export function unreadableResponseError(status: number, cause: unknown): ApiError {
  return new ApiError(status, "API response is not valid JSON", cause);
}

/**
 * The server answered a success that the operation's schema refuses: usually a client of
 * another release than the server, such as an enum value or an event type this client does not
 * know. `paths` names where the answer differs and never what it held.
 */
export class ApiResponseShapeError extends ApiError {
  /** Dotted paths of the fields the schema refused, each once. */
  readonly paths: readonly string[];

  constructor(status: number, cause: z.ZodError) {
    super(status, "API response does not match the contract", cause);
    this.name = "ApiResponseShapeError";
    this.paths = [...new Set(cause.issues.map((issue) => issue.path.join(".") || "(root)"))];
  }
}

function parseJsonOrText(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return text;
  }
}

function readErrorEnvelope(payload: unknown): object | undefined {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return undefined;
  const error = payload.error;
  return error && typeof error === "object" ? error : undefined;
}

function readErrorMessage(payload: unknown): string | undefined {
  const error = readErrorEnvelope(payload);
  return error && "message" in error && typeof error.message === "string"
    ? error.message
    : undefined;
}

function readApiErrorCode(payload: unknown): ApiErrorCode | undefined {
  const error = readErrorEnvelope(payload);
  if (!error || !("code" in error)) return undefined;
  const parsed = appErrorCodeSchema.safeParse(error.code);
  return parsed.success ? parsed.data : undefined;
}

function readCorrelationId(payload: unknown): string | undefined {
  const error = readErrorEnvelope(payload);
  return error && "correlationId" in error && typeof error.correlationId === "string"
    ? error.correlationId
    : undefined;
}

function readRetryAfterSeconds(payload: unknown): number | undefined {
  const parsed = z
    .object({ error: z.object({ details: rateLimitedDetailsSchema }) })
    .safeParse(payload);
  return parsed.success ? parsed.data.error.details.retryAfterSeconds : undefined;
}
