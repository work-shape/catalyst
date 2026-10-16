import { emitKeypressEvents } from "node:readline";
import type { Readable } from "node:stream";

/** A pipe, or a terminal whose echo can be disabled while a secret is entered. */
export type CommandInput = Readable & {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => unknown;
};

export async function readStdin(input: CommandInput): Promise<string> {
  input.setEncoding("utf8");
  let text = "";
  for await (const chunk of input) text += String(chunk);
  return text;
}

/** No readline output is attached: even pasted characters are never echoed. */
export async function readSecret(
  input: CommandInput,
  prompt: (text: string) => void
): Promise<string> {
  if (!input.isTTY) return (await readStdin(input)).replace(/\r?\n$/u, "");
  const setRawMode = input.setRawMode?.bind(input);
  if (setRawMode === undefined)
    throw new Error("This terminal cannot hide secret input. Use stdin.");
  const wasRaw = input.isRaw ?? false;
  emitKeypressEvents(input);
  setRawMode(true);
  try {
    return await new Promise<string>((resolve, reject) => {
      let value = "";
      const cleanup = () => {
        input.removeListener("keypress", keypress);
        input.removeListener("end", ended);
        input.removeListener("error", failed);
      };
      const ended = () => {
        cleanup();
        reject(new Error("Secret entry cancelled."));
      };
      const failed = () => {
        cleanup();
        reject(new Error("Could not read secret input."));
      };
      const keypress = (text: string | undefined, key: { name?: string; ctrl?: boolean }) => {
        if (key.ctrl && (key.name === "c" || key.name === "d")) return ended();
        if (key.name === "return" || key.name === "enter") {
          cleanup();
          resolve(value);
        } else if (key.name === "backspace") {
          value = [...value].slice(0, -1).join("");
        } else if (!key.ctrl && text && !text.includes("\u001b")) {
          value += text;
        }
      };
      input.on("keypress", keypress);
      input.once("end", ended);
      input.once("error", failed);
      input.resume();
      prompt("Secret (hidden): ");
    });
  } finally {
    setRawMode(wasRaw);
    input.pause();
    prompt("\n");
  }
}
