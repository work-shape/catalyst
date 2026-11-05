/**
 * The version of `@work-shape/catalyst-cli` that Settings, Connect a local agent installs. It is
 * the CLI released with this platform version: `pnpm release:cut` sets it to the version it cuts,
 * and `pnpm release:check` fails when it differs from `packages/config-cli/package.json`. The
 * release publishes that CLI with the workflow `Publish public CLI` before any deployment uses
 * this commit, so the page never names a version npm does not have
 * (`packages/docs/src/content/docs/configure/cli/maintainers.md`). The page offers no command
 * while it is undefined, which the check refuses on a committed tree.
 */
export const PUBLISHED_CLI_VERSION: string | undefined = "0.8.0-rc.29";
