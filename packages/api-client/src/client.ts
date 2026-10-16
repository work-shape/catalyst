import {
  apiOperations,
  type ApiOperationName,
  type Operation,
  type OperationPathParamName,
  type OperationRequestHeader
} from "@work-shape/catalyst-api-contract";
import type { z } from "zod";
import { ApiError, ApiResponseShapeError, transportError, unreadableResponseError } from "./errors";
import { readServerSentEvents } from "./server-sent-events";
import {
  createApiTransport,
  type ApiClientOptions,
  type ApiTransport,
  type OperationRequest
} from "./transport";

export type { ApiClientOptions };

type Catalog = typeof apiOperations;
/** Operations by id, as `apiOperations` holds the release's. */
type OperationCatalog = Record<string, Operation>;

/** `{ key: Value }`, with the key optional when an empty value would do. */
type Part<Key extends string, Value> =
  Record<never, never> extends Value ? Partial<Record<Key, Value>> : Record<Key, Value>;

type ParamsPart<Path extends string> = [OperationPathParamName<Path>] extends [never]
  ? unknown
  : { params: Record<OperationPathParamName<Path>, string> };

/** The keys a query schema accepts, with the types its values have once they are parsed. */
type QueryValues<Schema extends z.ZodType> = {
  [Key in keyof z.input<Schema>]: Key extends keyof z.output<Schema>
    ? z.output<Schema>[Key]
    : never;
};

type QueryPart<Op> = Op extends { query: infer Schema extends z.ZodType }
  ? Part<"query", QueryValues<Schema>>
  : unknown;

type BodyPart<Op> = Op extends { multipart: true }
  ? { file: File }
  : Op extends { body: infer Schema extends z.ZodType }
    ? { body: z.input<Schema> }
    : unknown;

type ControlPart<Op extends Operation> = {
  signal?: AbortSignal;
} & (Op["response"] extends { kind: "sse" }
  ? {
      /** Called when the server has nothing after the given position and sends no stream. */
      onCaughtUp?: () => void;
    }
  : unknown);

/**
 * An operation that takes an `Idempotency-Key` gets a new one with every call. A caller that
 * sends the same call again after an answer that never arrived passes the key of the first.
 */
type IdempotencyPart<Op> = Op extends {
  headers: { request: readonly (infer Header extends OperationRequestHeader)[] };
}
  ? "Idempotency-Key" extends Header
    ? { idempotencyKey?: string }
    : unknown
  : unknown;

type InputOf<Op extends Operation> = ParamsPart<Op["path"]> &
  QueryPart<Op> &
  BodyPart<Op> &
  IdempotencyPart<Op> &
  ControlPart<Op>;

/**
 * How a call of an operation that may wait for an approval came out. A refusal and a failure
 * are thrown as `ApiError`, as for every operation.
 */
export type OperationOutcome<Output, Run = unknown> = {
  /** The Operation Run that records the call. */
  operationRunId: string | undefined;
  /** The answer is the recorded one of an earlier call with the same `Idempotency-Key`. */
  replayed: boolean;
} & (
  | { status: "done"; output: Output }
  /** Nothing ran yet: somebody else decides. `location` is where the run is read again. */
  | { status: "pending_approval"; run: Run; location: string | undefined }
);

/**
 * The output of a call that ran. A call that waits for somebody else's approval changed
 * nothing yet, so it throws with `heldMessage`: for a caller that has no way to show a call
 * that waits.
 */
export function completedOutput<Output>(
  outcome: OperationOutcome<Output>,
  heldMessage = "The call waits for an approval and has changed nothing yet"
): Output {
  if (outcome.status === "done") return outcome.output;
  throw new Error(heldMessage);
}

type OutputOf<Op extends Operation> = Op["response"] extends {
  kind: "sse";
  schema: infer Schema extends z.ZodType;
}
  ? AsyncIterable<z.output<Schema>>
  : Op["response"] extends { schema: infer Schema extends z.ZodType }
    ? Op extends { accepted: infer Accepted extends z.ZodType }
      ? Promise<OperationOutcome<z.output<Schema>, z.output<Accepted>>>
      : Op extends { deferred: true }
        ? // Undefined: the call was accepted and its work finishes by itself.
          Promise<z.output<Schema> | undefined>
        : Promise<z.output<Schema>>
    : Promise<Blob>;

/** What the method of a catalog operation takes: `params`, `query`, `body` or `file`, `signal`. */
export type OperationInput<Name extends ApiOperationName> = InputOf<Catalog[Name]>;

type UrlInput<Op extends Operation> = Pick<
  InputOf<Op>,
  Extract<keyof InputOf<Op>, "params" | "query">
>;

type OperationMethod<Op extends Operation> =
  Record<never, never> extends InputOf<Op>
    ? (input?: InputOf<Op>) => OutputOf<Op>
    : (input: InputOf<Op>) => OutputOf<Op>;

type FirstSegment<Id extends string> = Id extends `${infer First}.${string}` ? First : Id;
type AfterSegment<Id extends string, First extends string> = Id extends `${First}.${infer Rest}`
  ? Rest
  : never;

/** One method per operation, nested by the segments of its id: `conversations.runs.start`. */
type MethodTree<
  Operations extends OperationCatalog,
  Ids extends string,
  Prefix extends string = ""
> = {
  [Segment in FirstSegment<Ids>]: `${Prefix}${Segment}` extends keyof Operations
    ? OperationMethod<Operations[`${Prefix}${Segment}`]>
    : MethodTree<Operations, AfterSegment<Ids, Segment>, `${Prefix}${Segment}.`>;
};

type OperationMethods<Operations extends OperationCatalog> = MethodTree<
  Operations,
  keyof Operations & string
>;

export type ApiOperationMethods = OperationMethods<Catalog>;

/** The client of the given operations: one method each, and what every client has. */
export type ApiClientFor<Operations extends OperationCatalog> = OperationMethods<Operations> & {
  /** Whether the browser itself may fetch a file by URL, which only a session cookie allows. */
  browserManagedDownloads: boolean;
  /** The absolute URL of an operation, for a link or an element that loads it itself. */
  urlFor<Name extends keyof Operations & string>(
    name: Name,
    input: UrlInput<Operations[Name]>
  ): string;
};

export type ApiClient = ApiClientFor<Catalog>;

/**
 * The first-party client. Its methods are not written down anywhere: each operation of the
 * catalog becomes one method, and every method goes through the same call.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  return createApiClientFor(apiOperations, options);
}

/**
 * The same client for operations that are not the release's own catalog, such as the
 * operations a capability registers on its instance.
 */
export function createApiClientFor<const Operations extends OperationCatalog>(
  operations: Operations,
  options: ApiClientOptions
): ApiClientFor<Operations> {
  const transport = createApiTransport(options);
  const methods = buildMethodTree(operations, (operation, request) =>
    callOperation(transport, operation, request)
  );
  if (!hasEveryOperation(operations, methods)) {
    throw new Error("The client's methods do not cover the operation catalog");
  }
  return Object.assign(methods, {
    browserManagedDownloads: transport.browserManagedDownloads,
    urlFor: (name: keyof Operations & string, input: Pick<OperationRequest, "params" | "query">) =>
      transport.urlFor(operationOf(operations, name), input)
  });
}

function operationOf(operations: OperationCatalog, name: string): Operation {
  const operation = operations[name];
  if (!operation) throw new Error(`Unknown operation "${name}"`);
  return operation;
}

/** As many items as a list operation hands out at once. */
const LARGEST_PAGE = 200;

/**
 * Reads a list operation to its end, one largest page after the other:
 * `listAll((paging) => client.users.list({ query: paging }))`. One call of a list method answers
 * a single page, and a screen that shows a whole list must not stop at the first.
 */
export async function listAll<Item>(
  readPage: (paging: {
    limit: number;
    cursor?: string;
  }) => Promise<{ items: Item[]; nextCursor?: string }>
): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | undefined;
  do {
    const page = await readPage({ limit: LARGEST_PAGE, ...(cursor ? { cursor } : {}) });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

type Call = (operation: Operation, request: OperationRequest) => unknown;
type Method = (request?: OperationRequest) => unknown;
interface MethodNode {
  [segment: string]: MethodNode | Method;
}

function buildMethodTree(operations: OperationCatalog, call: Call): MethodNode {
  const root: MethodNode = {};
  for (const operation of Object.values(operations)) {
    const segments = operation.id.split(".");
    const name = segments.pop() ?? "";
    let node = root;
    for (const segment of segments) {
      const next = (node[segment] ??= {});
      if (typeof next === "function") {
        throw new Error(`Operation id "${operation.id}" continues the id of another operation`);
      }
      node = next;
    }
    if (node[name]) {
      throw new Error(`Operation id "${operation.id}" is the start of another operation's id`);
    }
    node[name] = (request = {}) => call(operation, request);
  }
  return root;
}

/** Proves at run time what the type derives: every id of the catalog leads to a method. */
function hasEveryOperation<Operations extends OperationCatalog>(
  operations: Operations,
  tree: MethodNode
): tree is MethodNode & OperationMethods<Operations> {
  return Object.keys(operations).every((id) => {
    let node: MethodNode | Method | undefined = tree;
    for (const segment of id.split(".")) {
      node = typeof node === "object" ? node[segment] : undefined;
    }
    return typeof node === "function";
  });
}

function callOperation(
  transport: ApiTransport,
  operation: Operation,
  request: OperationRequest
): AsyncIterable<unknown> | Promise<unknown> {
  const { response } = operation;
  if (response.kind === "sse") {
    return streamEvents(transport, operation, response.schema, request);
  }
  if (response.kind === "blob") {
    return transport
      .send(operation, request)
      .then((answer) => readBody(() => answer.blob(), request));
  }
  const { accepted } = operation;
  return transport.send(operation, request).then(async (answer) => {
    if (operation.deferred && answer.status === 202) {
      return undefined;
    }
    const text = await readBody(() => answer.text(), request);
    if (!accepted) {
      return parseJson(transport, text, response.schema, answer.status);
    }
    const outcome = {
      operationRunId: answer.headers.get("operation-run-id") ?? undefined,
      replayed: answer.headers.get("idempotent-replayed") === "true"
    };
    return answer.status === 202
      ? {
          ...outcome,
          status: "pending_approval",
          run: parseJson(transport, text, accepted, answer.status),
          location: answer.headers.get("location") ?? undefined
        }
      : {
          ...outcome,
          status: "done",
          output: parseJson(transport, text, response.schema, answer.status)
        };
  });
}

async function* streamEvents(
  transport: ApiTransport,
  operation: Operation,
  schema: z.ZodType,
  request: OperationRequest
): AsyncGenerator<unknown, void, undefined> {
  const answer = await transport.send(operation, request);
  if (answer.status === 204) {
    request.onCaughtUp?.();
    return;
  }
  if (!answer.body) {
    return;
  }
  try {
    for await (const data of readServerSentEvents(answer.body)) {
      yield parseJson(transport, data, schema, answer.status);
    }
  } catch (error) {
    throw asCallFailure(error, request);
  }
}

async function readBody<Body>(read: () => Promise<Body>, request: OperationRequest) {
  try {
    return await read();
  } catch (error) {
    throw asCallFailure(error, request);
  }
}

/** An abort stays the caller's own abort; anything else that cuts an answer is a failed call. */
function asCallFailure(error: unknown, request: OperationRequest): unknown {
  return error instanceof ApiError || request.signal?.aborted ? error : transportError(error);
}

function parseJson(
  transport: ApiTransport,
  text: string,
  schema: z.ZodType,
  status: number
): unknown {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw unreadableResponseError(status, error);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    transport.reportResponseMismatch();
    throw new ApiResponseShapeError(status, parsed.error);
  }
  return parsed.data;
}
