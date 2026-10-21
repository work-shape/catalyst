import { createInterface } from "node:readline/promises";
import type { CommandInput } from "./input";

export interface CliRuntimeOptions {
  cwd?: string;
  stdin?: CommandInput;
  fetchImpl?: typeof fetch;
  env?: Readonly<Record<string, string | undefined>>;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  /** Waits between tries. Tests pass one that does not wait. */
  sleep?: (milliseconds: number) => Promise<void>;
  /** Opens an address in a browser, as `setup` does. Tests pass one that opens nothing. */
  openUrl?: (address: string) => void;
  /**
   * Asks the person at the terminal and answers what they typed. Left out, the terminal is
   * asked where there is one, and nobody where there is none.
   */
  prompt?: (question: string) => Promise<string>;
}

/** Asks the question on standard error and reads one line of standard input. */
export async function askTerminal(question: string): Promise<string> {
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await terminal.question(question);
  } finally {
    terminal.close();
  }
}
