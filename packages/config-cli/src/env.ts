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
}

export function readConfigCliEnv(env?: ConfigCliEnv): ConfigCliEnv {
  return env ?? process.env;
}
