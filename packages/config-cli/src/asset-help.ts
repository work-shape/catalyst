import { APP_VERBS } from "./app-commands";

/** The command help, built from the same verb descriptions the dispatcher uses. */
export function formatAssetHelp(verbs: readonly { usage: string; summary: string }[]): string {
  return `Usage: catalyst <command> [options]

Instance:
  context                   The instance, your rights on it and its asset kinds (platform.context.get)
  docs [<page>]             This release's product docs index, or one page as Markdown
  kinds                     The asset kinds: their command word, lifecycle and rights
  references                Models, efforts and tools a definition may name (platform.references.get)
  operation show <run-id>    Follow your call to its decision (operations.get_run)
  requests [--withdraw <id>] List your requests, or withdraw one of them

Assets, for every kind the instance registers (agent, skill, app, workflow, data-store, ...):
  catalyst skill pull <name> <folder>  Write every file of one skill locally; refresh only a clean earlier pull
${verbs.map((verb) => `  catalyst <kind> ${verb.usage}  ${verb.summary}`).join("\n")}

An App as a folder (its draft is built on push; publish shows what goes live and asks):
${Object.values(APP_VERBS)
  .map((verb) => `  catalyst app ${verb.usage}  ${verb.summary}`)
  .join("\n")}

A Workflow as a folder (workflow.yaml at its root, scripts in steps/):
  catalyst workflow pull <workflow> [dir] [--published | --revision <n>]  Write a revision into a folder (assets.get)
  catalyst workflow push [dir]  Send a changed folder as the next draft, or create the Workflow (assets.put)
  catalyst workflow status <workflow> [dir]  Show draft, published revision and local changes
  catalyst workflow publish <workflow> --revision <n> [--yes]  Review and ask before publishing (assets.publish)
  catalyst workflow history <workflow>  List revisions (assets.revisions.list)
  catalyst workflow revert <workflow> --to <n> --if-revision <n>  Restore a revision (assets.revert)

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
A publish, an availability change or a move that hands a source's data to people who may not
use the source waits in the Inbox until a person who may change the source approves it. A key
never confirms that hand-over, whatever rights it holds.
A put of an agent that exists writes its one shared draft, and nothing is live until
'catalyst agent publish <name> --revision <n>' names that draft revision. A put over a pending
draft names the draft revision it read with --if-draft-revision <n>. An instance's own
agent is published without a question unless a guardrail asks for an approval; a workspace's
agent asks first and then waits in the Inbox for a holder of agent.approve, and its first
publish offers it in its workspace. A workspace's agent made by someone without agent.approve
starts offered nowhere; 'catalyst agent publish <name> --revision 1' publishes it as made,
without a draft. A service principal's key publishes no agent. 'catalyst agent discard
<name> --revision <n>' drops the draft.
A skill of the instance or of a Shared Workspace has one shared draft too: a put or a push
writes it, 'catalyst skill publish <name> --revision <n>' (or 'push --publish') makes it live,
and 'catalyst skill discard <name> --revision <n>' drops it. A personal skill is live on save.
Exit codes: 0 done, 1 refused or failed, 2 usage, 3 waits for an approval (nothing changed yet).
`;
}
