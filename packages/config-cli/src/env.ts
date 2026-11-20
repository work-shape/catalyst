/** The variables this package reads by a fixed name. */
export interface ConfigCliEnv {
  /** A key provisioned for automation. It wins over a key `catalyst login` saved. */
  readonly CATALYST_API_KEY?: string | undefined;
  /** The folder of the saved keys, in place of `$XDG_CONFIG_HOME/catalyst`. */
  readonly CATALYST_CONFIG_HOME?: string | undefined;
  readonly XDG_CONFIG_HOME?: string | undefined;
  /** The person's home folder, where `catalyst setup` writes the skill of their tool. */
  readonly HOME?: string | undefined;
  /** Claude Code's own folder in place of `~/.claude`, where `catalyst setup` writes its skill. */
  readonly CLAUDE_CONFIG_DIR?: string | undefined;
  /** Set to anything but `0` or `false`, the CLI never installs another version of itself. */
  readonly CATALYST_NO_AUTO_UPDATE?: string | undefined;
  /** Set by the CLI on the command it runs again after updating itself: the old version. */
  readonly CATALYST_CLI_UPDATED_FROM?: string | undefined;
  /** Set by CI services; there the CLI never updates itself. */
  readonly CI?: string | undefined;
  /** Handed on to a code tool's handler that `catalyst tool run` or `put` starts, with HOME. */
  readonly PATH?: string | undefined;
  readonly LANG?: string | undefined;
  readonly TMPDIR?: string | undefined;
  readonly SYSTEMROOT?: string | undefined;
}

export function readConfigCliEnv(env?: ConfigCliEnv): ConfigCliEnv {
  return env ?? process.env;
}

/**
 * The environment a code tool's handler runs or is read in: where its interpreter is found, and
 * nothing else of this CLI's, never a key.
 */
export function toolHandlerEnv(env?: ConfigCliEnv): Record<string, string> {
  const read = readConfigCliEnv(env);
  const kept: Record<string, string> = { PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" };
  for (const name of ["PATH", "HOME", "LANG", "TMPDIR", "SYSTEMROOT"] as const) {
    const value = read[name];
    if (value !== undefined) kept[name] = value;
  }
  return kept;
}

/** This process's environment and the version the command run again was updated from. */
export function environmentUpdatedFrom(version: string): NodeJS.ProcessEnv {
  return { ...process.env, CATALYST_CLI_UPDATED_FROM: version };
}
