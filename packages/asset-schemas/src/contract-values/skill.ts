export const SKILL_ACTIONS = [
  "skill.read",
  "skill.write",
  // A save of a team's or the instance's skill is live with it; without it, a request (SKILL-LIVE-1).
  "skill.publish",
  "skill.delete",
  "skill.approve"
] as const;
