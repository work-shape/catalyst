import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import yaml from "js-yaml";
import { MANIFEST_FILENAME, readManifestIfPresent, resolveInstance } from "./working-copy";
import type { ConfigCommandOptions } from "./command-support";

const BEGIN = "<!-- catalyst:begin -->";
const END = "<!-- catalyst:end -->";
const USAGE = "Usage: catalyst init --instance <alias-or-url> [--dir <root>]";

/** Static CLI guidance, with no instance, identity, credentials or skill content. */
const AGENT_BLOCK = `${BEGIN}
## Catalyst working copy

Run \`catalyst context --json\` first to learn your current rights and instance.
Work in this order: \`catalyst config pull\`, edit the files,
\`catalyst config validate\`, \`catalyst config diff\`, then \`catalyst config push\`.
Pull before each push and show the person the diff.
Exit code 3 means a person decides: tell them and wait.
Use \`--prune\` only when the person asks for it.
Rights are checked on every call; discovery grants nothing.
${END}`;

async function textIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function withAgentBlock(text: string | undefined): string {
  if (text === undefined) return `${AGENT_BLOCK}\n`;
  const begins = text.split(BEGIN).length - 1;
  const ends = text.split(END).length - 1;
  if (begins === 0 && ends === 0) {
    const separator =
      text.length === 0 || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    return `${text}${separator}${AGENT_BLOCK}\n`;
  }
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (begins !== 1 || ends !== 1 || end < start)
    throw new Error("AGENTS.md has duplicate or unmatched Catalyst markers. Nothing was written.");
  return text.slice(0, start) + AGENT_BLOCK + text.slice(end + END.length);
}

/** Initialize a working copy offline. Preflight every input before writing any of the files. */
export async function runInit(args: string[], options: ConfigCommandOptions): Promise<number> {
  const out = options.stdout ?? ((text: string) => process.stdout.write(text));
  const err = options.stderr ?? ((text: string) => process.stderr.write(text));
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        instance: { type: "string" },
        dir: { type: "string" },
        help: { type: "boolean", short: "h" }
      },
      strict: true,
      allowPositionals: false
    }));
    if (values.help) {
      out(`${USAGE}\n`);
      return 0;
    }
    if (!values.instance) {
      err(`${USAGE}\n`);
      return 2;
    }
  } catch (error) {
    err(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  const directory = resolve(options.cwd, values.dir ?? ".");
  try {
    const manifest = await readManifestIfPresent(directory);
    const bindingRefusal =
      manifest === undefined
        ? undefined
        : `${MANIFEST_FILENAME} is bound to ${Object.entries(manifest.instances)
            .map(([alias, bound]) => `${alias} (${bound.url})`)
            .join(", ")}; '${values.instance}' is another instance. Nothing was written.`;
    let instance;
    try {
      instance = await resolveInstance(manifest, { instance: values.instance });
    } catch (error) {
      err(`${bindingRefusal ?? (error instanceof Error ? error.message : String(error))}\n`);
      return 2;
    }
    if (
      manifest !== undefined &&
      !Object.values(manifest.instances).some(
        (bound) => new URL(bound.url).origin === new URL(instance.url).origin
      )
    ) {
      err(`${bindingRefusal}\n`);
      return 2;
    }
    const agentPath = resolve(directory, "AGENTS.md");
    const original = await textIfPresent(agentPath);
    const agents = withAgentBlock(original);
    const claudePath = resolve(directory, "CLAUDE.md");
    const claude = await textIfPresent(claudePath);
    await mkdir(directory, { recursive: true });
    if (manifest === undefined) {
      const alias = new URL(instance.url).hostname;
      await writeFile(
        resolve(directory, MANIFEST_FILENAME),
        yaml.dump({
          instances: { [alias]: { url: instance.url } },
          defaultInstance: alias,
          agents: ["agents/*.agent.yaml"],
          skills: ["skills/*/SKILL.md"]
        })
      );
      out(`Wrote ${MANIFEST_FILENAME}.\n`);
    } else out(`Left ${MANIFEST_FILENAME} unchanged.\n`);
    if (agents !== original) {
      await writeFile(agentPath, agents);
      out("Wrote the Catalyst block in AGENTS.md.\n");
    } else out("Left AGENTS.md unchanged.\n");
    if (claude === undefined) {
      await writeFile(claudePath, "@AGENTS.md\n");
      out("Wrote CLAUDE.md.\n");
    } else if (claude.includes("@AGENTS.md")) out("Left CLAUDE.md unchanged.\n");
    else out('CLAUDE.md is yours: add "@AGENTS.md" to it if Claude Code should read the block.\n');
    return 0;
  } catch (error) {
    err(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
