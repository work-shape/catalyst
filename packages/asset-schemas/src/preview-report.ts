import { z } from "zod";

// What a preview reports of itself (PREVIEW-STATUS-1): whether the frame loaded, whether the
// kit greeted, whether the page drew anything, and its errors, console errors, policy
// violations and failed calls. A report is diagnostics written by a page an agent wrote, about
// data the person sees: it is scrubbed and bounded in the browser, and again on the server,
// because the platform's guard shares the page's realm and the page can write into it. Text
// shaped like data (long quoted text, digit runs, mail addresses, IBANs) never reaches a store.

/** Distinct entries a report lists. Repeats are counted, and entries past this are counted. */
export const PREVIEW_REPORT_MAX_ENTRIES = 10;
/** The longest message an entry keeps, after scrubbing. */
export const PREVIEW_REPORT_MAX_MESSAGE_CHARS = 200;
/** The longest report, as UTF-8 JSON. Entries that do not fit are counted, not listed. */
export const PREVIEW_REPORT_MAX_BYTES = 2048;
/** How long a report is kept after it was last written. */
export const PREVIEW_REPORT_KEEP_MS = 24 * 60 * 60 * 1000;

/**
 * What an entry is: an uncaught error, an unhandled rejection, a `console.error`, a content
 * policy violation, or a call of the page that failed (by action name and refusal code).
 */
export const PREVIEW_REPORT_ENTRY_KINDS = [
  "error",
  "rejection",
  "console",
  "policy",
  "call"
] as const;
export type PreviewReportEntryKind = (typeof PREVIEW_REPORT_ENTRY_KINDS)[number];

/**
 * Whether the kit greeted: within 5 seconds of the frame loading, not (yet) while the frame is
 * young, not at all, or the folder does not use the kit, which the build records.
 */
export const PREVIEW_REPORT_BRIDGE_STATES = [
  "connected",
  "waiting",
  "not_connected",
  "not_used"
] as const;
export type PreviewReportBridge = (typeof PREVIEW_REPORT_BRIDGE_STATES)[number];

const FILE_MAX_CHARS = 200;
const CODE_PATTERN = /^[a-z0-9_.-]{1,64}$/u;

export const previewReportEntrySchema = z.strictObject({
  kind: z.enum(PREVIEW_REPORT_ENTRY_KINDS),
  /** The scrubbed message; for a failed call, the action's name. */
  message: z.string().max(PREVIEW_REPORT_MAX_MESSAGE_CHARS),
  /** A failed call's refusal code. */
  code: z.string().regex(CODE_PATTERN).optional(),
  /** The page's file the entry came from, relative to the page. */
  file: z.string().min(1).max(FILE_MAX_CHARS).optional(),
  line: z.number().int().min(0).max(10_000_000).optional(),
  count: z.number().int().min(1).max(1_000_000_000)
});
export type PreviewReportEntry = z.infer<typeof previewReportEntrySchema>;

export const previewReportSchema = z.strictObject({
  /** The page settled: after load, 1.5 seconds without a new entry, at most 8 seconds. */
  settled: z.boolean(),
  /** The frame's document loaded. */
  loaded: z.boolean(),
  bridge: z.enum(PREVIEW_REPORT_BRIDGE_STATES),
  /** Whether the page drew nothing once it settled. Unknown before. */
  empty: z.boolean().optional(),
  entries: z.array(previewReportEntrySchema).max(PREVIEW_REPORT_MAX_ENTRIES),
  /** Entries that were not listed: past the limit or past the size. */
  more: z.number().int().min(0).max(1_000_000_000)
});
export type PreviewReport = z.infer<typeof previewReportSchema>;

/** A report as it is put together, before it is scrubbed and bounded. */
export interface UnboundPreviewReport {
  settled: boolean;
  loaded: boolean;
  bridge: PreviewReportBridge;
  empty?: boolean | undefined;
  entries: readonly {
    kind: PreviewReportEntryKind;
    message: string;
    code?: string | undefined;
    file?: string | undefined;
    line?: number | undefined;
    count: number;
  }[];
  more?: number | undefined;
}

const ELLIPSIS = "…";
/** Quoted text over 24 characters, in the quotes people and programs use. */
const QUOTED =
  /"[^"\n]{25,}"|'[^'\n]{25,}'|`[^`\n]{25,}`|„[^“”\n]{25,}[“”]|“[^”\n]{25,}”|‘[^’\n]{25,}’|«[^»\n]{25,}»|»[^«\n]{25,}«/gu;
/** A frame's content address up to its token, which signs the viewer in: it reads `/`. */
const CONTENT_ADDRESS_IN_TEXT =
  /(?:\b[a-z][a-z0-9+.-]*:\/\/[^\s/"'`<>]*)?\/app-content\/[^/\s"'`<>]+\/[^/\s"'`<>]+\//giu;
/**
 * The query and fragment of an address, absolute or a path: where a request carries data.
 */
const ADDRESS_QUERY = /((?:\b[a-z][a-z0-9+.-]*:\/\/|\/)[^\s?#"'`<>]*)[?#][^\s"'`<>]*/giu;
/**
 * Anything around an `@`, also one written `%40`, that has text before it: a mail address, also
 * one cut short or encoded.
 */
const MAIL = /[^\s@"'`<>()[\]{},;:]+(?:@|%40)[^\s@"'`<>()[\]{},;:]*/giu;
/**
 * Two letters, two digits and 11 to 30 more letters or digits: written together, or in groups
 * of four with a space between them.
 */
const IBAN = /\b[a-z]{2}\d{2}(?:[a-z0-9]{11,30}|(?: [a-z0-9]{4}){2,7}(?: [a-z0-9]{1,4})?)\b/giu;
/** Four or more digits, also with single separators between them, as in 1.234 or 12:30. */
const DIGIT_RUN = /\d(?:[ .,'/:-]?\d){3,}/gu;
// Control characters and line separators, written as escapes so that none stands in this file.
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]+", "gu");

/**
 * A message as a report may keep it: long quoted text, the query of an address, mail
 * addresses, IBANs and digit runs become `…`, and at most 200 characters remain. The same text
 * scrubbed twice reads the same.
 */
export function scrubPreviewText(text: string): string {
  const scrubbed = text
    .replace(CONTROL, " ")
    .replace(
      QUOTED,
      (quoted) => `${quoted.charAt(0)}${ELLIPSIS}${quoted.charAt(quoted.length - 1)}`
    )
    .replace(CONTENT_ADDRESS_IN_TEXT, "/")
    .replace(ADDRESS_QUERY, `$1?${ELLIPSIS}`)
    .replace(MAIL, ELLIPSIS)
    .replace(IBAN, ELLIPSIS)
    .replace(DIGIT_RUN, ELLIPSIS)
    .replace(/\s+/gu, " ")
    .trim();
  const characters = Array.from(scrubbed);
  return characters.length <= PREVIEW_REPORT_MAX_MESSAGE_CHARS
    ? scrubbed
    : `${characters.slice(0, PREVIEW_REPORT_MAX_MESSAGE_CHARS - 1).join("")}${ELLIPSIS}`;
}

/** The address of a frame's file set ends with its token: everything up to it goes. */
const CONTENT_ADDRESS = /^.*\/app-content\/[^/]+\/[^/]+\//iu;
const ORIGIN = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/iu;
const FILE_PATTERN = /^[\w./@~+-]+$/u;
/** The content hash a build puts before a file's extension, as in `main-4F3K2J1A.js`. */
const BUILD_HASH = /-[A-Za-z0-9]{8}(?=\.[a-z]+$)/u;
/** Five or more digits in a row. */
const LONG_DIGITS = /\d{5,}/u;

/**
 * Where an entry came from, as a report may keep it: a path relative to the page, a kit file as
 * its path on the instance, or `inline`. Never an origin, a query or the token of the frame's
 * address. Anything else is dropped.
 */
export function scrubPreviewFile(file: string | undefined): string | undefined {
  if (file === undefined || file.length === 0) return undefined;
  if (/^about:srcdoc/iu.test(file)) return "inline";
  const path = file
    .replace(/[?#].*$/su, "")
    .replace(CONTENT_ADDRESS, "")
    .replace(ORIGIN, "")
    .replace(/^\/+(?=app-runtime\/)/u, "/");
  if (path.length === 0 || path.length > FILE_MAX_CHARS || !FILE_PATTERN.test(path)) {
    return undefined;
  }
  // A build's hash before the extension may hold digits; any other long digit run, mail address
  // or IBAN in a file name is data, and the file is dropped.
  const unhashed = path.replace(BUILD_HASH, "");
  return LONG_DIGITS.test(unhashed) || unhashed.replace(MAIL, "").replace(IBAN, "") !== unhashed
    ? undefined
    : path;
}

function scrubCode(code: string | undefined): string | undefined {
  if (code === undefined) return undefined;
  const lower = code.toLowerCase();
  return CODE_PATTERN.test(lower) ? lower : "failed";
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function wholeCount(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.min(1_000_000_000, Math.max(0, Math.floor(value)))
    : fallback;
}

/**
 * The report as it may be kept: every message and file scrubbed, entries that read the same
 * afterwards merged with their counts added, at most 10 entries, at most 2 KB. What does not
 * fit is counted in `more`.
 */
export function boundPreviewReport(input: UnboundPreviewReport): PreviewReport {
  const merged: PreviewReportEntry[] = [];
  const index = new Map<string, number>();
  let more = wholeCount(input.more, 0);
  for (const raw of input.entries) {
    const count = Math.max(1, wholeCount(raw.count, 1));
    const file = scrubPreviewFile(raw.file);
    const code = raw.kind === "call" ? scrubCode(raw.code ?? "failed") : undefined;
    const line =
      file !== undefined && raw.line !== undefined && Number.isInteger(raw.line)
        ? Math.min(10_000_000, Math.max(0, raw.line))
        : undefined;
    const entry: PreviewReportEntry = {
      kind: raw.kind,
      message: scrubPreviewText(raw.message),
      ...(code === undefined ? {} : { code }),
      ...(file === undefined ? {} : { file }),
      ...(line === undefined ? {} : { line }),
      count
    };
    const key = JSON.stringify([entry.kind, entry.message, entry.code, entry.file, entry.line]);
    const at = index.get(key);
    if (at !== undefined) {
      const kept = merged[at];
      if (kept) kept.count = Math.min(1_000_000_000, kept.count + count);
      continue;
    }
    if (merged.length >= PREVIEW_REPORT_MAX_ENTRIES) {
      more += count;
      continue;
    }
    index.set(key, merged.length);
    merged.push(entry);
  }
  const report: PreviewReport = {
    settled: input.settled,
    loaded: input.loaded,
    bridge: input.bridge,
    ...(input.empty === undefined ? {} : { empty: input.empty }),
    entries: merged,
    more: Math.min(1_000_000_000, more)
  };
  // The last entries go first: the first error is most often the cause of the others.
  while (byteLength(report) > PREVIEW_REPORT_MAX_BYTES && report.entries.length > 0) {
    const dropped = report.entries.pop();
    report.more = Math.min(1_000_000_000, report.more + (dropped?.count ?? 0));
  }
  return report;
}
