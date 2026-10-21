export const FEEDBACK_ACTIONS = [
  // Reading the written feedback on agent messages and marking it handled (LU-4): on the
  // instance, or on one workspace for the agents it owns. No bundle carries it.
  "feedback.review"
] as const;
