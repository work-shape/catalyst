import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import { isRecord, loadYamlData } from "@work-shape/catalyst-asset-schemas";

// A guardrail on disk: `guardrails/<name>/guardrail.yaml` with its event, filter, check and
// outcome, and `check.md` beside it with the instruction of a `model_judge` check, which is
// prose and reads better as Markdown. A pattern check has no `check.md`. The instance checks
// the definition; this file only splits and joins it.

export const GUARDRAIL_FILE = "guardrail.yaml";
export const GUARDRAIL_CHECK_FILE = "check.md";

/** A guardrail definition as the CLI carries it, checked by the instance. */
export type GuardrailDefinition = Record<string, unknown> & { name: string };

const yamlDumpOptions: yaml.DumpOptions = {
  lineWidth: -1,
  noCompatMode: true,
  noRefs: true,
  sortKeys: false
};

/** The order of the keys of `guardrail.yaml`, so a pull writes the same file every time. */
const KEY_ORDER = ["name", "displayName", "description", "on", "filter", "check", "outcome"];

/**
 * The two files of one guardrail. The instruction of a judge moves to `check.md`; `origin` is
 * left out, since everything a working copy holds is an asset.
 */
export function serializeGuardrailFiles(definition: Record<string, unknown>): {
  yaml: string;
  checkMd?: string;
} {
  const { origin: _origin, ...rest } = definition;
  const check = isRecord(rest.check) ? rest.check : undefined;
  const instruction =
    check?.kind === "model_judge" && typeof check.instruction === "string"
      ? check.instruction
      : undefined;
  const ordered: Record<string, unknown> = {};
  for (const key of [...KEY_ORDER, ...Object.keys(rest).sort()]) {
    if (!(key in rest) || key in ordered) continue;
    const value = rest[key];
    if (key === "check" && check && instruction !== undefined) {
      const { instruction: _instruction, ...withoutInstruction } = check;
      ordered.check = withoutInstruction;
    } else {
      ordered[key] = value;
    }
  }
  return {
    yaml: yaml.dump(ordered, yamlDumpOptions),
    ...(instruction === undefined ? {} : { checkMd: `${instruction.trim()}\n` })
  };
}

/**
 * The definition of one guardrail from its two files. A `check.md` is the instruction of a
 * `model_judge` check, and a check that holds one as well is refused: one place for it.
 */
export function parseGuardrailFiles(input: {
  yaml: string;
  checkMd?: string;
  source: string;
}): GuardrailDefinition {
  const data = loadYamlData(input.yaml, input.source);
  if (!isRecord(data) || typeof data.name !== "string") {
    throw new Error(`${input.source} must hold a mapping with a 'name'.`);
  }
  if (input.checkMd === undefined) return { ...data, name: data.name };
  const check = data.check;
  if (!isRecord(check) || check.kind !== "model_judge") {
    throw new Error(
      `${input.source}: a ${GUARDRAIL_CHECK_FILE} holds the instruction of a 'model_judge' check, and this check is none.`
    );
  }
  if (check.instruction !== undefined) {
    throw new Error(
      `${input.source}: the instruction is written in ${GUARDRAIL_CHECK_FILE} or in the check, not in both.`
    );
  }
  return { ...data, name: data.name, check: { ...check, instruction: input.checkMd.trim() } };
}

/** Reads the folder of one guardrail: its `guardrail.yaml` and, where there is one, its `check.md`. */
export async function readGuardrailFolder(directory: string): Promise<GuardrailDefinition> {
  const yamlPath = join(directory, GUARDRAIL_FILE);
  const contents = await readFile(yamlPath, "utf8");
  const checkPath = join(directory, GUARDRAIL_CHECK_FILE);
  const hasCheck = await stat(checkPath).then(
    (found) => found.isFile(),
    () => false
  );
  return parseGuardrailFiles({
    yaml: contents,
    ...(hasCheck ? { checkMd: await readFile(checkPath, "utf8") } : {}),
    source: yamlPath
  });
}
