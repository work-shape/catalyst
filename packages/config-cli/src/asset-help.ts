import { APP_VERBS } from "./app-commands";

/** The command help, built from the same verb descriptions the dispatcher uses. */
export function formatAssetHelp(verbs: readonly { usage: string; summary: string }[]): string {
  return `Usage: catalyst <command> [options]

Instance:
  context                   The instance, your rights on it and its asset kinds (platform.context.get)
  kinds                     The asset kinds: their command word, lifecycle and rights
  references                Models, efforts and tools a definition may name (platform.references.get)
  operation show <run-id>    Follow your call to its decision (operations.get_run)
  requests [--withdraw <id>] List your requests, or withdraw one of them

Assets, for every kind the instance registers (agent, skill, app, workflow, data-store, ...):
${verbs.map((verb) => `  catalyst <kind> ${verb.usage}\n      ${verb.summary}`).join("\n")}

An App as a folder (its draft is built on push; publish shows what goes live and asks):
${Object.values(APP_VERBS)
  .map((verb) => `  catalyst app ${verb.usage}\n      ${verb.summary}`)
  .join("\n")}

Options:
  --instance <name-or-url>  An instance of catalyst.yaml, or its URL. Left out: the
                            defaultInstance of catalyst.yaml; outside a working copy,
                            the one instance a key is saved for
  --dir <working-copy-dir>  Directory containing catalyst.yaml (default: .)
  --workspace <id>          Address the assets one workspace owns. Left out in a working
                            copy bound to a workspace: that workspace
  --json                    Print the instance's answer as JSON
  --help                    Show this help

The instance decides every right and every check, and a refusal is printed as it gave it.
A write names the revision it was made against: read it with 'show' or 'history'.
A publish of an App or a Workflow asks you first and needs your answer in a terminal; --yes
publishes nothing. If you may not approve it yourself, it then waits for an approver.
A put of an agent that exists writes its one shared draft, and nothing is live until
'catalyst agent publish <name> --revision <n>' names that draft revision. A put over a pending
draft names the draft revision it read with --if-draft-revision <n>. An instance's own
agent is published without a question unless a guardrail asks for an approval; a workspace's
agent asks first. A service principal's key publishes no agent. 'catalyst agent discard
<name> --revision <n>' drops the draft.
Exit codes: 0 done, 1 refused or failed, 2 usage, 3 waits for an approval (nothing changed yet).
`;
}
