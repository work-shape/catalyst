import { z } from "zod";

// The skills of a person's Personal Workspace they use in their own chats with every agent
// (SCOPE-MYCHATS). Nothing is shared: only the person's own runs read them.

/** One skill of the person's Personal Workspace and whether their own chats use it. */
export const personalChatSkillSchema = z.object({
  name: z.string(),
  inMyChats: z.boolean()
});

/** The person's own skills, by name. Another person's skill is never in it. */
export const personalChatSkillsSchema = z.object({ items: z.array(personalChatSkillSchema) });

export const setPersonalChatSkillRequestSchema = z.object({ inMyChats: z.boolean() });

export type PersonalChatSkillView = z.infer<typeof personalChatSkillSchema>;
