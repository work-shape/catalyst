import { writeError, type ConfigCommandOptions } from "./command-support";

/**
 * The question a publish of an App or a Workflow asks in the terminal before it is sent: a
 * yes submits the publish but never supplies an approval. With a publish guardrail on, even
 * an admin's CLI publish waits in the Inbox. An answer that is not yes publishes nothing.
 * `--yes`, or a terminal nobody can answer, is
 * refused until such a publish can wait as a confirmation in the person's Inbox (OP-4).
 * Answers whether the publish goes ahead; where it does not, it has said why.
 */
export async function askBeforePublish(
  options: ConfigCommandOptions,
  publish: { kind: string; command: string; name: string; revision: number; yes: boolean }
): Promise<boolean> {
  const { kind, command, name, revision } = publish;
  if (publish.yes || !options.prompt) {
    writeError(
      options,
      `Publishing a ${kind} needs your answer here or your click in the interface, so ${publish.yes ? "--yes" : "a run without a terminal to ask"} publishes nothing. Run 'catalyst ${command} publish ${name} --revision ${revision}' in a terminal and answer its question, or publish it in the interface.`
    );
    return false;
  }
  const answer = await options.prompt(
    `Publish revision ${revision} of ${kind} '${name}'? If approval is required, this files a request in the Inbox. [y/N] `
  );
  if (/^y(?:es)?$/iu.test(answer.trim())) return true;
  writeError(options, "Nothing was published.");
  return false;
}
