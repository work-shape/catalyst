export const SKILL_ACTIONS = [
  "skill.read",
  "skill.write",
  // Makes the shared draft of a team's or the instance's skill live (SKILL-DRAFT-1).
  "skill.publish",
  "skill.delete",
  "skill.approve"
] as const;
