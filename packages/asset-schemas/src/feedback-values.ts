// The values of written feedback on agent messages (LU-4) that the store, the server and the
// API contract share.

/** The longest comment. */
export const FEEDBACK_TEXT_MAX_LENGTH = 4000;
/** The longest machine-written summary and category a workflow stores on a comment. */
export const FEEDBACK_SUMMARY_MAX_LENGTH = 1000;
export const FEEDBACK_CATEGORY_MAX_LENGTH = 60;
/** The longest note a reviewer leaves when marking a comment handled. */
export const FEEDBACK_NOTE_MAX_LENGTH = 2000;

/**
 * What a comment is about: an agent's answer (LU-4), an App a person uses, and the result of a
 * Workflow run that reached a person's Inbox (LU-6).
 */
export const FEEDBACK_SUBJECT_KINDS = ["message", "app", "workflow_run"] as const;
export type FeedbackSubjectKind = (typeof FEEDBACK_SUBJECT_KINDS)[number];

/** The kinds of asset a comment is about: an agent, an App, a Workflow. */
export const FEEDBACK_ASSET_KINDS = ["agent", "app", "workflow"] as const;
export type FeedbackAssetKind = (typeof FEEDBACK_ASSET_KINDS)[number];

export const FEEDBACK_STATES = ["new", "handled"] as const;
export type FeedbackState = (typeof FEEDBACK_STATES)[number];
