/**
 * Reads a `text/event-stream` body and yields the `data` of each event. Chunks may cut an event,
 * a line ending or a character anywhere. Comments and the `id`, `event` and `retry` fields are
 * skipped, because every stream of the catalog carries its whole event in `data`.
 *
 * Leaving the loop early cancels the body, which closes the connection.
 */
export async function* readServerSentEvents(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<string, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  try {
    while (!finished) {
      const { done, value } = await reader.read();
      finished = done;
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // A line ending cut after its carriage return stays in the buffer until its line feed.
      const blocks = buffer.replaceAll("\r\n", "\n").split("\n\n");
      buffer = done ? "" : (blocks.pop() ?? "");
      for (const block of blocks) {
        const data = readEventData(block);
        if (data !== undefined) {
          yield data;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** An event without data is not dispatched, as in the event stream standard. */
function readEventData(block: string): string | undefined {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).replace(/^ /u, ""))
    .join("\n");
  return data === "" ? undefined : data;
}
