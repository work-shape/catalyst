/**
 * The version of `@work-shape/catalyst-cli` that Settings, Connect a local agent installs. It
 * names only a version that is on npm already: the release publishes the CLI of its version
 * with the workflow `Publish public CLI` first and sets this afterwards, in a commit of its own
 * (`packages/docs/src/content/docs/configure/cli.md`, For maintainers). Undefined while no
 * published CLI has `catalyst setup`: the page then offers no command.
 */
export const PUBLISHED_CLI_VERSION: string | undefined = "0.7.0";
