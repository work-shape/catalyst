// What a value read from YAML is held to before anything walks it. A YAML reader answers an
// alias as the very object its anchor made, so a few hundred bytes of nested aliases are a
// small graph that is a huge tree: whatever walks it as a tree, such as a schema that reads
// every value or a conversion to JSON, takes time and memory that double with each level. The
// check below walks the graph once, each object once, and says where the value is none.

/**
 * Why a value read from YAML is not taken, or nothing where it is. `alias`: an object or a
 * list is in it more than once, which only an anchor with an alias or a merge makes; no file
 * the platform reads needs one, so none is taken, and no count of them has to be right.
 * `depth`: it nests deeper than `maxDepth`, where its reader names one; a file whose own
 * rules say how deep it nests, as a Workflow's blocks do, names none. The walk is linear in
 * what the file holds: it visits each object once and ends at the first one it meets twice.
 */
export function yamlValueIssue(
  value: unknown,
  maxDepth = Number.POSITIVE_INFINITY
): "alias" | "depth" | undefined {
  const seen = new Set<object>();
  const open: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let deepest = 0;
  // Every object is walked once, so the walk is as long as the file, whatever its levels. An
  // alias is answered before a depth: a value of aliases is deep only because of them.
  for (let next = open.pop(); next !== undefined; next = open.pop()) {
    if (typeof next.value !== "object" || next.value === null) continue;
    if (seen.has(next.value)) return "alias";
    seen.add(next.value);
    deepest = Math.max(deepest, next.depth + 1);
    for (const child of Array.isArray(next.value) ? next.value : Object.values(next.value)) {
      open.push({ value: child, depth: next.depth + 1 });
    }
  }
  return deepest > maxDepth ? "depth" : undefined;
}

/** The sentence a reader of a YAML file answers for an issue of its value. */
export function yamlValueIssueSentence(issue: "alias" | "depth", maxDepth?: number): string {
  return issue === "alias"
    ? "it uses a YAML anchor with an alias or a merge key, which is not read: write the value out where it is used"
    : `it nests deeper than ${maxDepth ?? "its reader takes"} levels`;
}
