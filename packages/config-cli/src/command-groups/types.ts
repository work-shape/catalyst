import type { CliRuntimeOptions } from "../cli-runtime";

export type CommandRuntime = CliRuntimeOptions & {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};
export interface CommandGroup {
  names: readonly string[];
  matches(argv: readonly string[]): boolean;
  help: string;
  run(argv: string[], runtime: CommandRuntime): Promise<number>;
}
