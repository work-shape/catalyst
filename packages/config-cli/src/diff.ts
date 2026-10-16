export interface DiffFile {
  path: string;
  contents?: string;
}

type DiffLine =
  | { kind: "context"; text: string }
  | { kind: "delete"; text: string }
  | { kind: "insert"; text: string };

const CONTEXT_LINES = 3;

export function createUnifiedDiff(oldFile: DiffFile, newFile: DiffFile): string {
  if (oldFile.contents === newFile.contents) {
    return "";
  }
  const oldLines = splitLines(oldFile.contents ?? "");
  const newLines = splitLines(newFile.contents ?? "");
  const lines = calculateDiff(oldLines, newLines);
  const hunks = createHunks(lines);
  const oldPath = oldFile.contents === undefined ? "/dev/null" : `a/${oldFile.path}`;
  const newPath = newFile.contents === undefined ? "/dev/null" : `b/${newFile.path}`;
  const output = [
    `diff --git a/${oldFile.path} b/${newFile.path}`,
    `--- ${oldPath}`,
    `+++ ${newPath}`
  ];

  for (const hunk of hunks) {
    const prefix = lines.slice(0, hunk.start);
    const body = lines.slice(hunk.start, hunk.end);
    const oldStart = consumedOld(prefix) + (consumedOld(body) === 0 ? 0 : 1);
    const newStart = consumedNew(prefix) + (consumedNew(body) === 0 ? 0 : 1);
    output.push(
      `@@ -${oldStart},${consumedOld(body)} +${newStart},${consumedNew(body)} @@`,
      ...body.map((line) => `${linePrefix(line)}${line.text}`)
    );
  }
  return `${output.join("\n")}\n`;
}

function splitLines(contents: string): string[] {
  if (contents.length === 0) {
    return [];
  }
  const normalized = contents.replaceAll("\r\n", "\n");
  return normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
}

function calculateDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const lengths = Array.from({ length: oldLines.length + 1 }, () =>
    Array<number>(newLines.length + 1).fill(0)
  );
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      lengths[oldIndex]![newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? lengths[oldIndex + 1]![newIndex + 1]! + 1
          : Math.max(lengths[oldIndex + 1]![newIndex]!, lengths[oldIndex]![newIndex + 1]!);
    }
  }

  const output: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (
      oldIndex < oldLines.length &&
      newIndex < newLines.length &&
      oldLines[oldIndex] === newLines[newIndex]
    ) {
      output.push({ kind: "context", text: oldLines[oldIndex]! });
      oldIndex += 1;
      newIndex += 1;
    } else if (
      oldIndex < oldLines.length &&
      (newIndex === newLines.length ||
        lengths[oldIndex + 1]![newIndex]! >= lengths[oldIndex]![newIndex + 1]!)
    ) {
      output.push({ kind: "delete", text: oldLines[oldIndex]! });
      oldIndex += 1;
    } else {
      output.push({ kind: "insert", text: newLines[newIndex]! });
      newIndex += 1;
    }
  }
  return output;
}

function createHunks(lines: DiffLine[]): Array<{ start: number; end: number }> {
  const changes = lines.flatMap((line, index) => (line.kind === "context" ? [] : [index]));
  if (changes.length === 0) {
    return [];
  }
  const hunks: Array<{ start: number; end: number }> = [];
  let start = Math.max(0, changes[0]! - CONTEXT_LINES);
  let end = Math.min(lines.length, changes[0]! + CONTEXT_LINES + 1);
  for (const change of changes.slice(1)) {
    const nextStart = Math.max(0, change - CONTEXT_LINES);
    const nextEnd = Math.min(lines.length, change + CONTEXT_LINES + 1);
    if (nextStart <= end) {
      end = nextEnd;
    } else {
      hunks.push({ start, end });
      start = nextStart;
      end = nextEnd;
    }
  }
  hunks.push({ start, end });
  return hunks;
}

function consumedOld(lines: DiffLine[]): number {
  return lines.filter((line) => line.kind !== "insert").length;
}

function consumedNew(lines: DiffLine[]): number {
  return lines.filter((line) => line.kind !== "delete").length;
}

function linePrefix(line: DiffLine): " " | "-" | "+" {
  return line.kind === "context" ? " " : line.kind === "delete" ? "-" : "+";
}
