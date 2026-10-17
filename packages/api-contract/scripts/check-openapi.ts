// Fails when the committed document is not what the catalog generates, or when the document
// has a lint finding of any severity.
import { readFile } from "node:fs/promises";
import { createConfig, lintFromString } from "@redocly/openapi-core";
import { artifactPath, generateArtifact } from "./openapi-artifact";

const generated = generateArtifact();
const problems = await lintFromString({
  source: generated,
  absoluteRef: artifactPath,
  config: await createConfig({
    extends: ["recommended"],
    rules: {
      // A tag is one word of the catalog and has no text of its own.
      "tag-description": "off",
      // The packages are unlicensed: there is no licence to name.
      "info-license": "off",
      // A browser callback answers `303` for every outcome. The check below asks a success
      // of every other operation.
      "operation-2xx-response": "off"
    }
  })
});
const document: unknown = JSON.parse(generated);
const paths =
  typeof document === "object" && document !== null && "paths" in document
    ? Object.entries(document.paths ?? {})
    : [];
const withoutSuccess = paths.flatMap(([path, item]: [string, unknown]) =>
  Object.entries(typeof item === "object" && item !== null ? item : {}).flatMap(
    ([method, operation]: [string, unknown]) => {
      const responses =
        typeof operation === "object" && operation !== null && "responses" in operation
          ? Object.keys(operation.responses ?? {})
          : [];
      return responses.some((status) => /^2|^303$/u.test(status)) ? [] : [`${method} ${path}`];
    }
  )
);
for (const operation of withoutSuccess) {
  console.error(`[check:openapi] error ${operation}: the operation answers no 2XX and no 303`);
}
for (const problem of problems) {
  const pointer = problem.location[0]?.pointer ?? "";
  console.error(
    `[check:openapi] ${problem.severity} ${problem.ruleId} ${pointer}: ${problem.message}`
  );
}
const committed = await readFile(artifactPath, "utf8").catch(() => "");
if (committed !== generated) {
  console.error(
    "[check:openapi] packages/api-contract/openapi.json is not what the catalog generates; run pnpm generate:openapi"
  );
}
if (problems.length > 0 || withoutSuccess.length > 0 || committed !== generated) {
  process.exit(1);
}
console.log("[check:openapi] the committed document is current and has no lint finding");
