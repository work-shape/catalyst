import { readAssetSource } from "../asset-sources";
import { formatWarnings } from "../asset-output";
import { writeOutput } from "../command-support";
import { filesRead, fromPath, EXIT } from "./support";
import type { Verb } from "./types";

export const validateVerb: Verb = {
  usage: "validate --from <file-or-folder>",
  summary:
    "Check a definition against the instance without writing it (assets.validate); a folder of files is checked against the limits of one write",
  named: false,
  options: { from: { type: "string" } },
  prepare: (values, _name, cwd) => {
    const from = fromPath(values, cwd, "--from <file-or-folder>");
    return async (session) => {
      // What put reads, validate reads. The instance checks a definition without writing
      // it; the files of a kind whose revision holds files it checks only as it writes them.
      const source = await readAssetSource(from, session.kind.representation, session.kind.kind);
      if ("files" in source) return filesRead(session, from, source.files.length);
      const result = await session.api.read((client) =>
        client.assets.validate({
          params: { kind: session.kind.kind },
          body: { config: source.config, ...session.scope }
        })
      );
      writeOutput(
        session.options,
        session.values.json
          ? JSON.stringify(result, null, 2)
          : result.valid
            ? ["Valid.", ...formatWarnings(result.warnings ?? [])].join("\n")
            : [
                "Not valid:",
                ...result.issues.map(
                  (issue) =>
                    `- ${issue.path?.length ? `${issue.path.join(".")}: ` : ""}${issue.message}`
                )
              ].join("\n")
      );
      return result.valid ? EXIT.done : EXIT.refused;
    };
  }
};
