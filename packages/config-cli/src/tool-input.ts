import { Ajv, type ErrorObject } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";

// `catalyst tool run` checks `--input` against the tool's input schema before it runs the
// handler, as the instance checks what an agent hands a tool. The schema is the folder's own,
// already bounded by the tool's asset schema. It is compiled without fetching anything: a
// `$ref` to another document fails the check.

const DRAFT_07 = /^https?:\/\/json-schema\.org\/draft-07\/schema#?$/u;

const AJV_OPTIONS = {
  strict: false,
  validateFormats: false,
  allErrors: true,
  addUsedSchema: false,
  logger: false
} as const;

/** How many faults of an input are named at most. */
const MAX_ISSUES = 10;

function describe(error: ErrorObject): string {
  const at = error.instancePath === "" ? "the input" : error.instancePath;
  return `${at}: ${error.message ?? "does not fit"}`;
}

/**
 * Where the input does not fit the tool's input schema, one line each; none when it fits.
 * A schema that does not compile is named as such.
 */
export function toolInputIssues(schema: Record<string, unknown>, input: unknown): string[] {
  const dialect = schema.$schema;
  const ajv =
    typeof dialect === "string" && DRAFT_07.test(dialect)
      ? new Ajv(AJV_OPTIONS)
      : new Ajv2020(AJV_OPTIONS);
  let validate;
  try {
    validate = ajv.compile(schema);
  } catch (error) {
    return [
      `The tool's input schema does not compile: ${error instanceof Error ? error.message : String(error)}`
    ];
  }
  if (validate(input)) return [];
  return (validate.errors ?? []).slice(0, MAX_ISSUES).map(describe);
}
