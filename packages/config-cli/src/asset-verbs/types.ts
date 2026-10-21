import type { ParseArgsConfig } from "node:util";
import type { ConfigApi } from "../api";
import type { ConfigCommandOptions } from "../command-support";
import type { PlatformContext } from "@work-shape/catalyst-api-contract";

export type AssetKind = PlatformContext["kinds"][number];

export interface Values {
  instance?: string;
  dir?: string;
  workspace?: string;
  prefix?: string;
  text?: string;
  revision?: string;
  from?: string;
  "if-revision"?: string;
  "if-draft-revision"?: string;
  to?: string;
  mode?: string;
  field?: string;
  asset?: string;
  confirm?: string;
  audience?: string;
  withdraw?: string;
  json: boolean;
  files: boolean;
  personal: boolean;
  none: boolean;
  yes: boolean;
  published: boolean;
  help: boolean;
  "available-in"?: string[];
}
export type OptionName = keyof Values;
export interface Session {
  api: ConfigApi;
  instance: string;
  kind: AssetKind;
  values: Values;
  /** The workspace the call addresses. Left out, it addresses the instance's own assets. */
  scope: { workspaceId?: string };
  options: ConfigCommandOptions;
}

/**
 * What a command line asks. `prepare` reads and checks the arguments before anything is sent,
 * and answers the call to make once the instance is reached.
 */
export interface Verb {
  usage: string;
  summary: string;
  /** Whether the verb names one asset. */
  named: boolean;
  /** Options beside `--instance`, `--dir`, `--workspace` and `--json`. */
  options: NonNullable<ParseArgsConfig["options"]>;
  prepare(
    values: Values,
    name: string,
    cwd: string,
    noun: string,
    folder?: string
  ): (session: Session) => Promise<number>;
}
