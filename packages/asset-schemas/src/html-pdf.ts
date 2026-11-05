import { z } from "zod";

// HTML to PDF (PDF-1): an App or an agent hands the instance HTML and gets a PDF back. The
// instance's own renderer prints it with no network: the document reaches only what it holds
// inline and `data:` addresses. These bounds are shared by the service, the API and the tool.

/** The most bytes of HTML one render takes, as UTF-8, `data:` images and fonts included. */
export const HTML_PDF_MAX_HTML_BYTES = 4 * 1024 * 1024;
/** The most bytes the PDF of one render may have. A larger one is refused, never cut. */
export const HTML_PDF_MAX_PDF_BYTES = 10 * 1024 * 1024;
/** The most pages the PDF of one render may have. A longer one is refused, never cut. */
export const HTML_PDF_MAX_PAGES = 50;
/** The longest one render may take in the renderer, waiting for a free slot included. */
export const HTML_PDF_RENDER_MS = 20_000;
/** How many renders one App frame may ask for in a minute. */
export const HTML_PDF_RENDERS_PER_MINUTE_PER_SESSION = 10;

/** The header a request to the renderer names its layout in, as JSON; the body is the HTML. */
export const HTML_PDF_OPTIONS_HEADER = "x-pdf-options";
/** The header the renderer's PDF answer names its page count in. */
export const HTML_PDF_PAGES_HEADER = "x-pdf-pages";

export const HTML_PDF_PAGE_FORMATS = ["A3", "A4", "A5", "Letter", "Legal"] as const;

/**
 * Why a render was refused. `pdf_unavailable`: the instance runs no renderer.
 * `pdf_too_large`: the HTML or the PDF exceeds its bound. `pdf_too_many_pages`: the PDF would
 * have more pages than allowed. `pdf_busy`: every renderer is busy. `pdf_failed`: the render
 * failed or ran out of time.
 */
export const HTML_PDF_REFUSALS = [
  "pdf_unavailable",
  "pdf_too_large",
  "pdf_too_many_pages",
  "pdf_busy",
  "pdf_failed"
] as const;
export type HtmlPdfRefusal = (typeof HTML_PDF_REFUSALS)[number];

/** A CSS length of a margin, such as `12mm`, `1in` or `0`. */
const margin = z
  .string()
  .max(16)
  .regex(/^(?:0|\d{1,3}(?:\.\d{1,2})?(?:mm|cm|in|px))$/u, "a length such as '12mm', '1in' or '0'");

/**
 * How the PDF's pages are laid out. Without `format` a size the HTML names in its own
 * `@page` rule holds, otherwise A4. Backgrounds and colours always print.
 */
export const htmlPdfOptionsSchema = z.strictObject({
  format: z.enum(HTML_PDF_PAGE_FORMATS).optional(),
  landscape: z.boolean().optional(),
  margin: z
    .strictObject({
      top: margin.optional(),
      right: margin.optional(),
      bottom: margin.optional(),
      left: margin.optional()
    })
    .optional()
});
export type HtmlPdfOptions = z.infer<typeof htmlPdfOptionsSchema>;

/** One render as the renderer is asked for it. */
export interface HtmlPdfInput {
  html: string;
  options: HtmlPdfOptions;
}

export type HtmlPdfOutcome =
  { status: "done"; pdf: Uint8Array; pages: number } | { status: "refused"; code: HtmlPdfRefusal };
