// EW-TEXT: text joined from parts in a step's input mapping. The value form itself,
// `{ text: [...] }`, is `workflowInputTextSchema` of core beside `{ value }` and `{ ref }`.

/**
 * The JSON Schema `format` of a string field that takes Markdown, such as the body of
 * `mail.send`. In such a field a referenced list of strings joins as a bulleted list and a
 * list of flat records as a table, and every referenced value is escaped as Markdown text.
 */
export const WORKFLOW_TEXT_FORMAT_MARKDOWN = "markdown";

/** The most parts one joined text has. */
export const WORKFLOW_TEXT_MAX_PARTS = 100;

/** A referenced list in a Markdown field joins as at most this many rows; more is refused. */
export const WORKFLOW_MARKDOWN_MAX_ROWS = 100;

/** A referenced list of records joins as a table of at most this many columns. */
export const WORKFLOW_MARKDOWN_MAX_COLUMNS = 8;
