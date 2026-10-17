import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { RELEASE_VERSION } from "@work-shape/catalyst-api-contract";
import { ApiKeyExchangeError, createConfigApi } from "./api";
import {
  type ConfigCommandOptions,
  formatCommandError,
  writeError,
  writeOutput
} from "./command-support";
import { credentialOrigin, readStoredCredential, type StoredCredential } from "./credentials";
import { type ConfigCliEnv, readConfigCliEnv } from "./env";
import { apiKeysAddress, formatTime, loginByConnectCode, resolveInstanceUrl } from "./login";

/** The tools `catalyst setup` writes the Catalyst skill for, with where each reads skills. */
const LOCAL_AGENT_TOOLS = {
  "claude-code": { label: "Claude Code", skillsFolder: [".claude", "skills"] },
  // Codex reads `~/.agents/skills`, the shared place for tools other than Claude Code.
  codex: { label: "Codex", skillsFolder: [".agents", "skills"] },
  other: { label: "Local agent", skillsFolder: [".agents", "skills"] }
} as const;

export type LocalAgentTool = keyof typeof LOCAL_AGENT_TOOLS;

export function isLocalAgentTool(value: string | undefined): value is LocalAgentTool {
  return value !== undefined && Object.hasOwn(LOCAL_AGENT_TOOLS, value);
}

export const SETUP_USAGE =
  "Usage: catalyst setup <claude-code|codex|other> --instance <url> [--force]";

export interface SetupOptions extends ConfigCommandOptions {
  tool: LocalAgentTool;
  /** Opens an address in the person's browser. Tests pass one that opens nothing. */
  openUrl?: (address: string) => void;
}

/** The skill as the package ships it, beside `dist/` and `src/` alike. */
const SHIPPED_SKILL = new URL("../skills/catalyst/SKILL.md", import.meta.url);

/** The last line of a skill `catalyst setup` wrote: the CLI version and the hash of the text. */
const MARK =
  /\n<!-- Written by catalyst setup \(@work-shape\/catalyst-cli [^,]+, sha256 ([0-9a-f]{64})\)\. -->\n$/u;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The skill file this CLI writes: the shipped skill with a mark of who wrote it. */
export async function renderCatalystSkill(): Promise<string> {
  const body = await readFile(SHIPPED_SKILL, "utf8");
  return `${body}\n<!-- Written by catalyst setup (@work-shape/catalyst-cli ${RELEASE_VERSION}, sha256 ${sha256(body)}). -->\n`;
}

/** Whether `catalyst setup` wrote the file and nobody changed it since. */
function writtenBySetup(contents: string): boolean {
  const mark = MARK.exec(contents);
  return mark !== null && sha256(contents.slice(0, mark.index)) === mark[1];
}

/**
 * Where the tool reads its Catalyst skill: below the person's home folder, or for Claude Code
 * below `CLAUDE_CONFIG_DIR` where that is set, as Claude Code itself reads it.
 */
function catalystSkillPath(tool: LocalAgentTool, env: ConfigCliEnv): string {
  const folder =
    tool === "claude-code" && env.CLAUDE_CONFIG_DIR
      ? join(env.CLAUDE_CONFIG_DIR, "skills")
      : join(env.HOME || homedir(), ...LOCAL_AGENT_TOOLS[tool].skillsFolder);
  return join(folder, "catalyst", "SKILL.md");
}

/**
 * `catalyst setup <tool> --instance <url>`: logs in by a connect code unless a working key is
 * saved for the instance, then writes the Catalyst skill where the tool reads it. A different
 * file at that path is kept unless `--force` is given, and then it is moved to the first free
 * name of `SKILL.md.bak`, `SKILL.md.bak.1` and so on. It changes no other configuration of the
 * tool and never prints the key.
 */
export async function setupCommand(options: SetupOptions): Promise<number> {
  try {
    const url = await resolveInstanceUrl(options);
    const tool = LOCAL_AGENT_TOOLS[options.tool];
    const saved = await workingSavedKey(options, url);
    let keyLine: string;
    if (saved) {
      keyLine = `Kept the saved key '${saved.name}'${scopesOf(saved.scopes)}, valid until ${formatTime(saved.expiresAt)}.`;
    } else {
      const key = await loginByConnectCode(
        options,
        url,
        `${tool.label} on ${hostname()}`,
        options.openUrl ?? openInBrowser(url),
        // The key a local agent gets publishes what its person may publish (CLI-PUBLISH-USE).
        true
      );
      if (key === undefined) {
        writeError(
          options,
          `The code expired before it was confirmed. Run 'catalyst setup ${options.tool} --instance ${url}' again.`
        );
        return 1;
      }
      keyLine = `Logged in with the key '${key.name}'${scopesOf(key.scopes)}, valid until ${formatTime(key.expiresAt)}.`;
    }

    const path = catalystSkillPath(options.tool, readConfigCliEnv(options.env));
    const skill = await renderCatalystSkill();
    const existing = await readSkillFile(path);
    const lines = [`Instance: ${credentialOrigin(url)}`, keyLine];
    if (existing === skill) {
      lines.push(`The Catalyst skill at ${path} is current.`);
    } else if (existing === undefined || (existing !== NOT_A_FILE && writtenBySetup(existing))) {
      await replaceFile(path, skill);
      lines.push(`Wrote the Catalyst skill to ${path}.`);
    } else if (options.force) {
      const backup = await freeBackupPath(path);
      await rename(path, backup);
      await replaceFile(path, skill);
      lines.push(`Wrote the Catalyst skill to ${path}; the file that was there is ${backup}.`);
    } else {
      writeOutput(options, lines.join("\n"));
      writeError(
        options,
        `Kept ${path}: it is not the skill this CLI writes. Run the command again with --force to replace it; the file that is there is then kept as ${await freeBackupPath(path)}.`
      );
      return 1;
    }
    if (options.tool === "other") {
      lines.push("Point your tool at that file, or copy it to where your tool reads skills.");
    }
    lines.push(`See and revoke the key at ${apiKeysAddress(url)}.`);
    writeOutput(options, lines.join("\n"));
    return 0;
  } catch (error) {
    writeError(options, formatCommandError(error));
    return 1;
  }
}

/** What stands at the skill's path when it is no file: a link, a folder or another entry. */
const NOT_A_FILE = Symbol("not a file");

/**
 * The text of the file at the skill's path, nothing where the path is free, or `NOT_A_FILE`.
 * A link is never followed: what it points to is neither read nor written.
 */
async function readSkillFile(path: string): Promise<string | typeof NOT_A_FILE | undefined> {
  const entry = await lstat(path).catch((error: unknown) => {
    if (isMissing(error)) return undefined;
    throw error;
  });
  if (entry === undefined) return undefined;
  return entry.isFile() ? readFile(path, "utf8") : NOT_A_FILE;
}

/**
 * Writes a new file beside the path and gives it the path's name, so a link there is replaced,
 * never written through, and a write that fails leaves what was there.
 */
async function replaceFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { flag: "wx" });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** The first of `SKILL.md.bak`, `SKILL.md.bak.1`, … where nothing stands, a link included. */
async function freeBackupPath(path: string): Promise<string> {
  for (let number = 0; ; number += 1) {
    const candidate = number === 0 ? `${path}.bak` : `${path}.bak.${number}`;
    const taken = await lstat(candidate).then(
      () => true,
      (error: unknown) => {
        if (isMissing(error)) return false;
        throw error;
      }
    );
    if (!taken) return candidate;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * The key saved for the instance, when the instance still takes it. An expired, revoked or
 * refused key is none; an instance that cannot be reached is an error, not a reason to log in.
 */
async function workingSavedKey(
  options: ConfigCommandOptions,
  url: string
): Promise<StoredCredential | undefined> {
  const saved = await readStoredCredential(readConfigCliEnv(options.env), url);
  if (saved === undefined || Date.parse(saved.expiresAt) <= Date.now()) return undefined;
  try {
    const api = await createConfigApi({
      baseUrl: url,
      apiKey: saved.apiKey,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.sleep === undefined ? {} : { sleep: options.sleep })
    });
    await api.read((client) => client.platform.context.get());
    return saved;
  } catch (error) {
    // Only a refused key means logging in again. Any other answer is the instance's to explain.
    if (error instanceof ApiKeyExchangeError && (error.status === 401 || error.status === 403)) {
      return undefined;
    }
    throw error;
  }
}

function scopesOf(scopes: readonly string[] | undefined): string {
  return scopes === undefined ? "" : ` (${scopes.join(", ")})`;
}

/**
 * Opens the confirmation address in the default browser where the system has one. Only an
 * address of the instance is opened, and never through a shell. It is printed either way.
 */
function openInBrowser(url: string): (address: string) => void {
  return (address) => {
    if (new URL(address).origin !== credentialOrigin(url)) return;
    const [command, args] =
      process.platform === "darwin"
        ? ["open", [address]]
        : process.platform === "win32"
          ? ["rundll32", ["url.dll,FileProtocolHandler", address]]
          : ["xdg-open", [address]];
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore" });
      child.on("error", () => undefined);
      child.unref();
    } catch {
      // No browser to open: the printed address is enough.
    }
  };
}
