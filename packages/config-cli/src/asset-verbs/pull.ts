import { resolve } from "node:path";
import { pullSkill } from "../skill-pull";
import { print, UsageError } from "./support";
import type { Verb } from "./types";

export const pullVerb: Verb = {
  usage: "pull <name> <folder>",
  summary: "Pull one skill as a folder, checking hashes and keeping local edits (assets.get)",
  named: true,
  options: {},
  prepare: (_values, name, cwd, noun, folder) => {
    if (noun !== "skill" && noun !== "skills")
      throw new UsageError("'pull' is a command of skills and Apps only.");
    if (!folder) throw new UsageError("Usage: catalyst skill pull <name> <folder>");
    const directory = resolve(cwd, folder);
    return async (session) => {
      const result = await pullSkill({
        api: session.api,
        instance: session.instance,
        ...session.scope,
        skill: name,
        directory
      });
      return print(
        session,
        result,
        () =>
          `Pulled revision ${result.revision} of skill '${name}' into ${folder} (${result.files} files).`
      );
    };
  }
};
