import {
  APP_ACTION_CALL_STATUSES,
  FEEDBACK_TEXT_MAX_LENGTH,
  PREVIEW_CAPTURE_MAX_BYTES,
  PREVIEW_CAPTURE_MAX_HEIGHT,
  PREVIEW_CAPTURE_MAX_WIDTH,
  PREVIEW_CAPTURE_TOOL_NAME,
  PREVIEW_REPORT_MAX_ENTRIES,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  POLICY_VALUES,
  THEME_MODES,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_TEST_REVISIONS
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";

// The bridge between a Page and the interface that shows it, as the interface reads it. A Page
// is code an agent wrote: what it posts is validated against these schemas before anything is
// done with it, and what does not fit is dropped. The kit's side of the same messages is
// `packages/app-kit/src/protocol.ts`, written without a schema library.

/** The key that marks a message of the bridge. Its value is the version of the shapes below. */
export const APP_BRIDGE_MARK = "catalystBridge";
export const APP_BRIDGE_VERSION = 1;
/** The longest route a Page may report. */
export const APP_BRIDGE_MAX_PATH_CHARS = 2048;
/** The highest content height a Page may report, in pixels. */
export const APP_BRIDGE_MAX_HEIGHT_PX = 100_000;

/** The longest id a Page may give one of its calls. The answer carries it back. */
export const APP_BRIDGE_REQUEST_ID_MAX_CHARS = 100;
/** The longest name of an action, a Connection or an operation a Page may send. */
export const APP_BRIDGE_NAME_MAX_CHARS = 200;

// The bounds of a picture of a preview (PREVIEW-SEE-1), for the interface that asks for one.
export {
  PREVIEW_CAPTURE_MAX_BYTES,
  PREVIEW_CAPTURE_MAX_HEIGHT,
  PREVIEW_CAPTURE_MAX_WIDTH,
  PREVIEW_CAPTURE_TOOL_NAME
};

const mark = { [APP_BRIDGE_MARK]: z.literal(APP_BRIDGE_VERSION) };
const session = z.string().min(1).max(200);
const requestId = z.string().min(1).max(APP_BRIDGE_REQUEST_ID_MAX_CHARS);
const calledName = z.string().min(1).max(APP_BRIDGE_NAME_MAX_CHARS);
const idempotencyKey = z.string().min(1).max(IDEMPOTENCY_KEY_MAX_LENGTH).optional();

/** A localStorage mutation or coalesced batch. The server serializes it against the current person's state. */
export const appStorageMutationSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("set"), key: z.string(), value: z.string() }),
  z.strictObject({ type: z.literal("remove"), key: z.string() }),
  z.strictObject({ type: z.literal("clear") }),
  z.strictObject({
    type: z.literal("batch"),
    clear: z.boolean(),
    values: z.record(z.string(), z.string().nullable())
  })
]);

/**
 * The longest text the platform's guard hands over per entry of a report, before the interface
 * scrubs it down to `PREVIEW_REPORT_MAX_MESSAGE_CHARS`.
 */
export const APP_BRIDGE_REPORT_MAX_CHARS = 1000;
const reportCount = z.number().int().min(0).max(1_000_000_000);

/**
 * What the platform's guard in a Page document posts once the Page settled and on each change
 * after (PREVIEW-STATUS-1): its errors, rejections, `console.error` calls and policy
 * violations, and whether it drew anything. It is no call of the kit and carries no session:
 * like the greeting, it counts only from the frame's one child window. The Page shares the
 * guard's realm and can post one itself, so the interface scrubs and bounds it before it goes
 * anywhere (`boundPreviewReport`).
 */
const guardReportSchema = z.strictObject({
  settled: z.boolean(),
  empty: z.boolean().optional(),
  entries: z
    .array(
      z.strictObject({
        kind: z.enum(["error", "rejection", "console", "policy"]),
        message: z.string().max(APP_BRIDGE_REPORT_MAX_CHARS),
        file: z.string().max(APP_BRIDGE_REPORT_MAX_CHARS).optional(),
        line: reportCount.optional(),
        column: reportCount.optional(),
        count: reportCount.min(1)
      })
    )
    .max(PREVIEW_REPORT_MAX_ENTRIES),
  more: reportCount
});

export type AppBridgeGuardReport = z.infer<typeof guardReportSchema>;

const capturedPixels = (max: number) => z.number().int().min(1).max(max);

/**
 * What the platform's guard answers to `capture` (PREVIEW-SEE-1): the picture of the Page as
 * WebP bytes, or that this browser cannot take one. Like the report it carries no session and
 * counts only from the frame's one child window. The Page shares the guard's realm and can
 * post one itself: it can show only itself, and the instance checks the picture again.
 */
const captureResultSchema = z.strictObject({
  ...mark,
  type: z.literal("capture_result"),
  requestId,
  image: z
    .instanceof(ArrayBuffer)
    .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= PREVIEW_CAPTURE_MAX_BYTES)
    .optional(),
  width: capturedPixels(PREVIEW_CAPTURE_MAX_WIDTH).optional(),
  height: capturedPixels(PREVIEW_CAPTURE_MAX_HEIGHT).optional(),
  unavailable: z.literal(true).optional()
});

/** What a Page posts. Unknown keys are refused, so a message is exactly one of these. */
export const appBridgePageMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...mark, type: z.literal("ready") }),
  z.strictObject({ ...mark, type: z.literal("report"), report: guardReportSchema }),
  captureResultSchema,
  z.strictObject({
    ...mark,
    type: z.literal("storage_write"),
    session,
    requestId,
    mutation: appStorageMutationSchema
  }),
  z.strictObject({
    ...mark,
    type: z.literal("navigate"),
    session,
    // A route of the Page: it starts with one slash and names no host.
    path: z
      .string()
      .min(1)
      .max(APP_BRIDGE_MAX_PATH_CHARS)
      .regex(/^\/(?!\/)/u)
  }),
  z.strictObject({
    ...mark,
    type: z.literal("resize"),
    session,
    height: z.number().finite().min(0).max(APP_BRIDGE_MAX_HEIGHT_PX)
  }),
  // A call of a named action of the manifest. The interface makes it with the viewer's own
  // session. The frame holds no credential and reaches nothing but the interface.
  z.strictObject({
    ...mark,
    type: z.literal("action"),
    session,
    requestId,
    name: calledName,
    input: z.record(z.string(), z.unknown()),
    idempotencyKey
  }),
  // Retired: the free call of a Connection operation that kits 1.1.0 to 1.3.0 send for
  // `connections.call`. It is read only to be answered with `APP_BRIDGE_CONNECTION_CALL_REMOVED`,
  // so a Page built against those kits is told the fix and does not wait for an answer.
  z.strictObject({
    ...mark,
    type: z.literal("connection_call"),
    session,
    requestId,
    connection: calledName,
    operation: calledName,
    input: z.unknown(),
    idempotencyKey
  }),
  // A read of a Workflow Run a `workflow` action of the manifest started.
  z.strictObject({
    ...mark,
    type: z.literal("workflow_run"),
    session,
    requestId,
    runId: calledName
  }),
  // The viewer's written feedback on the App (LU-6). The interface names the App and its
  // revision when it sends it; the Page names nothing but the text.
  z.strictObject({
    ...mark,
    type: z.literal("feedback"),
    session,
    requestId,
    text: z.string().trim().min(1).max(FEEDBACK_TEXT_MAX_LENGTH)
  })
]);

export type AppBridgePageMessage = z.infer<typeof appBridgePageMessageSchema>;

/**
 * The answer to a retired `connection_call`. An App reaches a Connection only through a named
 * `connection` action in its folder; the free call from the browser was removed.
 */
export const APP_BRIDGE_CONNECTION_CALL_REMOVED = {
  code: "connection_call_removed",
  message:
    "connections.call was removed: an App reaches a Connection only through a named action. Add actions/<name>.action.yaml with connection, operation and effect, and call it with actions.call('<name>', input).",
  retryable: false
} as const;

/** The seven colours of a theme, as an instance sets them per mode. */
export const appBridgeThemeSchema = z.strictObject({
  surfaceColor: z.string(),
  backgroundColor: z.string(),
  textColor: z.string(),
  mutedTextColor: z.string(),
  borderColor: z.string(),
  accentColor: z.string(),
  accentStrongColor: z.string()
});

export const appBridgeModeSchema = z.enum(THEME_MODES);

/**
 * What the viewer's call of one action would come to now, as the server computed it: it runs,
 * it runs as the viewer's own confirmation, it waits for another person's approval, or it is
 * refused. A hint for what a Page shows. The call itself is checked again when it is made.
 */
export const appActionPermissionSchema = z.enum(POLICY_VALUES);

export type AppActionPermission = z.infer<typeof appActionPermissionSchema>;

/** What `getContext()` of the kit answers. */
export const appBridgeContextSchema = z.strictObject({
  viewer: z.strictObject({ kind: z.literal("member"), id: z.string(), displayName: z.string() }),
  workspace: z.strictObject({ id: z.string(), name: z.string() }).nullable(),
  locale: z.string(),
  theme: appBridgeThemeSchema,
  mode: appBridgeModeSchema,
  pageId: z.string(),
  fileSetNumber: z.number().int().positive(),
  initialRoute: z.string(),
  /** Per action of the manifest. Absent where the interface could not read it. */
  can: z.record(z.string(), appActionPermissionSchema).optional(),
  /**
   * Whether the viewer can send feedback on the App (LU-6): the module is on and the frame
   * shows a published App. Absent counts as `false`.
   */
  feedback: z.boolean().optional()
});

export type AppBridgeContext = z.infer<typeof appBridgeContextSchema>;

/**
 * A Workflow Run that a `workflow` action of the shown manifest started, as the frame follows
 * it: its state and, once it is done, its result. The result is the run's whole output where
 * it is at most `APP_WORKFLOW_RUN_OUTPUT_MAX_BYTES` (256 KiB) as JSON; a larger one is not
 * answered and `outputTruncated` says so.
 */
export const appWorkflowRunSchema = z.strictObject({
  id: z.string(),
  workflow: z.string(),
  status: z.enum(WORKFLOW_RUN_STATUSES),
  output: z.unknown().optional(),
  outputTruncated: z.boolean().optional(),
  /** Why the run did not end `done`: a code and a sentence of the product. */
  error: z.strictObject({ code: z.string(), message: z.string() }).optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  /**
   * `test` on a run a click in an App's draft started (DP-1): it ran in mode test, as the
   * viewer bounded by the Workflow's principal, and nothing of it is live. Missing on a run of
   * a published App.
   */
  mode: z.literal("test").optional(),
  /**
   * On a test run: the revision of the Workflow that ran, the draft or the published one, with
   * its number where that revision is still the draft or the published one.
   */
  workflowRevision: z
    .strictObject({
      kind: z.enum(WORKFLOW_TEST_REVISIONS),
      number: z.number().int().positive().optional()
    })
    .optional(),
  /** On a test run: the steps whose calls were simulated, by step id. Their results are not real. */
  simulatedSteps: z.array(z.string()).optional()
});

export type AppWorkflowRun = z.infer<typeof appWorkflowRunSchema>;

/** Why a call or a read of a frame was refused or failed, as the frame is told. */
const callFailure = z.strictObject({
  /** `action_unknown`, `draft_safe_mode`, `forbidden`, `input_invalid`, `limit_reached` and so on. */
  code: z.string(),
  message: z.string(),
  /** The right a `forbidden` call lacks. */
  right: z.string().optional(),
  /**
   * `false` where making the same call again cannot come out differently, such as a
   * missing right. A page then offers no button to try again.
   */
  retryable: z.boolean().optional(),
  runId: z.string().optional()
});

/** What the interface posts into the frame of a Page. */
export const appBridgeHostMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...mark,
    type: z.literal("storage_result"),
    session,
    requestId,
    ok: z.boolean()
  }),
  z.strictObject({ ...mark, type: z.literal("context"), session, context: appBridgeContextSchema }),
  // Asks the platform's guard for a picture of the Page (PREVIEW-SEE-1). The guard answers it,
  // not the kit, so it carries no session.
  z.strictObject({ ...mark, type: z.literal("capture"), requestId }),
  z.strictObject({
    ...mark,
    type: z.literal("theme"),
    theme: appBridgeThemeSchema,
    mode: appBridgeModeSchema
  }),
  // The answer to one `action`, named by the id the Page gave it. A retired `connection_call`
  // is answered the same way, with `APP_BRIDGE_CONNECTION_CALL_REMOVED` as its error.
  z.strictObject({
    ...mark,
    type: z.literal("action_result"),
    session,
    requestId,
    ok: z.boolean(),
    result: z
      .union([
        z.strictObject({
          runId: z.string(),
          status: z.enum(APP_ACTION_CALL_STATUSES),
          result: z.unknown().optional()
        }),
        // The answer of a draft: what the call would have done. Nothing was carried out.
        z.strictObject({ status: z.literal("dry_run"), message: z.string(), result: z.unknown() })
      ])
      .optional(),
    error: callFailure.optional()
  }),
  // The answer to one `workflow_run`, named by the id the Page gave the read.
  z.strictObject({
    ...mark,
    type: z.literal("workflow_run_result"),
    session,
    requestId,
    ok: z.boolean(),
    run: appWorkflowRunSchema.optional(),
    error: callFailure.optional()
  }),
  // The answer to one `feedback`, named by the id the Page gave it.
  z.strictObject({
    ...mark,
    type: z.literal("feedback_result"),
    session,
    requestId,
    ok: z.boolean(),
    error: callFailure.optional()
  })
]);

export type AppBridgeHostMessage = z.infer<typeof appBridgeHostMessageSchema>;
