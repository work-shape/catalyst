/** The UTC counter windows, metrics and scopes a model usage refusal may name. */
export const MODEL_USAGE_LIMIT_PERIODS = ["day", "month"] as const;
export const MODEL_USAGE_LIMIT_METRICS = ["modelCallCount", "tokens", "costMicros"] as const;
export const MODEL_USAGE_LIMIT_SCOPES = ["instance", "user", "system"] as const;

/** The limit that refused a call: its period, what it counts, and whose counter it is. */
export interface ModelUsageRefusal {
  period: (typeof MODEL_USAGE_LIMIT_PERIODS)[number];
  metric: (typeof MODEL_USAGE_LIMIT_METRICS)[number];
  /**
   * `user`: the person's own calls. `system`: the calls the product makes for a person, or
   * those no person made. `instance`: the spend budget everyone shares.
   */
  scope: (typeof MODEL_USAGE_LIMIT_SCOPES)[number];
}
