import { spawn } from "node:child_process";

/**
 * Opens an address in the default browser where the system has one, never through a shell.
 * The caller decides which addresses may be opened and prints the address either way.
 */
export function openInBrowser(address: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [address]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", address]]
        : ["xdg-open", [address]];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // No browser to open: the printed address is enough.
  }
}
