/** Rights over the instance itself: people, roles, usage, audit, API access, models and releases. */
export const ADMINISTRATION_ACTIONS = [
  "users.manage",
  "usage.view",
  "audit.view",
  "api_access.manage",
  // Creating service principals, giving and taking their rights, enabling and disabling them.
  // Their keys stay with `api_access.manage`.
  "service_principals.manage",
  "agent_models.manage",
  // Editing and resetting the built-in roles `user` and `admin`, and deciding their pending
  // actions (Felix, 2026-10-21). Its default sits with `superadmin` alone.
  "roles.edit_built_in",
  "assets.release"
] as const;
