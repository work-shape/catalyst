/**
 * How a release config file that `extends` another is read over it: objects merge key by key,
 * the extending file winning; lists and values replace the base's wholesale. The instance's
 * loader and the CLI that writes release config merge the same way.
 */
export function mergeConfigObjects(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, override] of Object.entries(overrides)) {
    if (key === "__proto__") {
      continue;
    }
    const baseValue = result[key];
    result[key] =
      isPlainConfigObject(baseValue) && isPlainConfigObject(override)
        ? mergeConfigObjects(baseValue, override)
        : override;
  }
  return result;
}

/** An object a config merges into, not a list or a YAML-derived value such as a Date. */
export function isPlainConfigObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  // Exclude arrays and YAML-derived non-record objects such as Date: those
  // replace the base value wholesale instead of merging into it.
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
