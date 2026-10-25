/**
 * Rights over the instance itself: people, roles, usage, audit, how the instance runs, background
 * jobs, API access, models and releases.
 */
export const ADMINISTRATION_ACTIONS = [
  "users.manage",
  // Deleting a person's account and their data, beside `users.manage` (RIGHTS-1e, D5). Its
  // default sits with `superadmin` alone.
  "users.delete",
  "usage.view",
  // Setting the spend limits of the instance, of shared workspaces and of users (LU-2).
  // Instance admins hold it; workspace owners do not.
  "limits.manage",
  // Usage by named person beyond one's own (LU-3, limits spec 3.4): the Users view of the
  // instance, and an owner's figures per member of a workspace. A separate right because the
  // works council has a say on it (BetrVG section 87(1) no. 6).
  "usage.view_users",
  "audit.view",
  // Seeing how the instance runs: its background jobs, its Operation Runs, its modules and what
  // it runs on, the Settings group "System" (RIGHTS-1e; UX audit ruling 2). Its default sits
  // with `superadmin` alone, so a customer's admin keeps the audit log and not these pages.
  "system.view",
  // Running a background job again that failed or died (RIGHTS-1e; UX audit ruling 2). Its
  // default sits with `superadmin` alone.
  "jobs.retry",
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
