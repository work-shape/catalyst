// What a code tool's handler imports (TOOL-2c and TOOL-2d, platform-access.md, section 3a): the
// modules the platform puts beside a tool's files for each call, on the Python path and where
// Node finds a bare name, and the CLI beside a handler it runs locally or reads.
//
// `catalyst_tool` (Python) and `catalyst-tool` (Node) are the request channel. A call writes
// one request as a line of JSON to the descriptor the platform opened and reads the answer as
// one line from the other; the worker carries the request out through the platform, as the
// tool's caller. The sandbox has no network, so this is the one way out, and no credential ever
// comes in.
//
// `catalyst_tools` (Python) and `catalyst-tools` (Node) are the SDK on top (TOOL-2d): `@tool`
// derives a Python function's input schema from its type hints and its docstring, and answers
// the call when the tool's main.py runs; `serve` answers it for a tool the CLI bundled from a
// TypeScript `defineTool`. Both hand the handler a `ctx` with `connection(name).call(operation,
// input)`, `display.data(kind, data, title)`, `display.html(html, title)` and `log`.
//
// A refused or failed Connection call raises `ConnectionCallError` with its `code`, such as
// `connection_not_declared`. The modules use the standard library only.

const PYTHON = `"""Calls a Connection operation the tool declares, through the platform."""

import json
import os
import select
import threading

__all__ = ["ConnectionCallError", "call", "connection"]

_lock = threading.Lock()
_held = b""


class ConnectionCallError(Exception):
    """A call the platform refused, or that failed. \`code\` names why."""

    def __init__(self, code, message):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


def _descriptor(name):
    value = os.environ.get(name)
    if value is None:
        raise ConnectionCallError(
            "channel_unavailable", "This handler runs without the platform's request channel"
        )
    return int(value)


def _write(fd, data):
    while data:
        select.select([], [fd], [])
        try:
            data = data[os.write(fd, data):]
        except BlockingIOError:
            pass


def _read_line(fd):
    global _held
    while b"\\n" not in _held:
        select.select([fd], [], [])
        try:
            chunk = os.read(fd, 65536)
        except BlockingIOError:
            continue
        if not chunk:
            raise ConnectionCallError("channel_closed", "The platform closed the request channel")
        _held += chunk
    line, _, _held = _held.partition(b"\\n")
    return line


def call(connection, operation, input=None):
    """Calls \`connection.<connection>.<operation>\` and answers its output."""
    request = json.dumps(
        {"connection": connection, "operation": operation, "input": {} if input is None else input},
        separators=(",", ":"),
    )
    with _lock:
        _write(_descriptor("CATALYST_REQUEST_FD"), (request + "\\n").encode("utf-8"))
        answer = json.loads(_read_line(_descriptor("CATALYST_ANSWER_FD")))
    if answer.get("ok"):
        return answer.get("output")
    error = answer.get("error") or {}
    raise ConnectionCallError(error.get("code", "failed"), error.get("message", ""))


class _Connection:
    def __init__(self, name):
        self.name = name

    def call(self, operation, input=None):
        return call(self.name, operation, input)


def connection(name):
    """The Connection \`name\`, whose declared operations \`.call\` calls."""
    return _Connection(name)
`;

const NODE = `// Calls a Connection operation the tool declares, through the platform.
import { readSync, writeSync } from "node:fs";

export class ConnectionCallError extends Error {
  constructor(code, message) {
    super(\`\${code}: \${message}\`);
    this.name = "ConnectionCallError";
    this.code = code;
  }
}

let held = Buffer.alloc(0);
const pause = new Int32Array(new SharedArrayBuffer(4));

function descriptor(value) {
  if (value === undefined)
    throw new ConnectionCallError("channel_unavailable", "This handler runs without the platform's request channel");
  return Number(value);
}

function again(error) {
  if (error?.code !== "EAGAIN") throw error;
  Atomics.wait(pause, 0, 0, 5);
}

function write(fd, data) {
  let at = 0;
  while (at < data.length) {
    try {
      at += writeSync(fd, data, at);
    } catch (error) {
      again(error);
    }
  }
}

function readLine(fd) {
  const chunk = Buffer.alloc(65536);
  for (;;) {
    const end = held.indexOf(10);
    if (end >= 0) {
      const line = held.subarray(0, end).toString("utf8");
      held = held.subarray(end + 1);
      return line;
    }
    let read;
    try {
      read = readSync(fd, chunk, 0, chunk.length, null);
    } catch (error) {
      again(error);
      continue;
    }
    if (read === 0) throw new ConnectionCallError("channel_closed", "The platform closed the request channel");
    held = Buffer.concat([held, chunk.subarray(0, read)]);
  }
}

/** Calls \`connection.<connection>.<operation>\` and answers its output. */
export async function call(connection, operation, input = {}) {
  write(descriptor(process.env.CATALYST_REQUEST_FD), Buffer.from(JSON.stringify({ connection, operation, input }) + "\\n", "utf8"));
  const answer = JSON.parse(readLine(descriptor(process.env.CATALYST_ANSWER_FD)));
  if (answer.ok) return answer.output;
  throw new ConnectionCallError(answer.error?.code ?? "failed", answer.error?.message ?? "");
}

/** The Connection \`name\`, whose declared operations \`.call\` calls. */
export function connection(name) {
  return { call: (operation, input) => call(name, operation, input) };
}
`;

const PYTHON_SDK = String.raw`"""Writes a code tool's handler in Python.

    from catalyst_tools import tool

    @tool
    def find_contact(ctx, email: str, limit: int = 5):
        '''Finds a contact in the CRM by e-mail.

        Args:
            email: The contact's e-mail address.
            limit: How many matches to answer at most.
        '''
        found = ctx.connection("crm").call("find_contact", {"email": email})
        ctx.display.data("crm.contacts", {"contacts": found}, "Contacts")
        return found

The input schema comes from the type hints (str, int, float, bool, Literal, list, Optional,
TypedDict and dataclasses), the descriptions from the docstring. The function takes ctx first.
Run as a tool's main.py, the handler answers the call the platform hands it.
"""

import asyncio
import atexit
import collections.abc
import dataclasses
import enum
import importlib.util
import inspect
import json
import os
import re
import sys
import traceback
import types
import typing

from catalyst_tool import ConnectionCallError
from catalyst_tool import connection as _connection

__all__ = ["ConnectionCallError", "Context", "Display", "ToolDefinition", "describe", "tool"]

_NONE = type(None)
_UNION_TYPES = tuple(
    kind for kind in (typing.Union, getattr(types, "UnionType", None)) if kind is not None
)
_SETS = (set, frozenset, collections.abc.Set, collections.abc.MutableSet)
_SEQUENCES = (list, tuple, collections.abc.Sequence, collections.abc.Iterable, *_SETS)
_PARAMETER_SECTIONS = {"args", "arguments", "parameters", "params", "attributes", "fields"}
_OTHER_SECTIONS = {
    "returns", "return", "yields", "raises", "examples", "example", "notes", "note", "see also"
}
_ENTRY = re.compile(r"^\*{0,2}(\w+)\s*(?:\([^)]*\))?\s*:\s*(.*)$")
_PARAM_FIELD = re.compile(r"^:param\s+(?:[^:]*\s)?(\w+)\s*:\s*(.*)$")
_TOOL_NAME = re.compile(r"^[a-z][a-z0-9_]*$")


class Display:
    """What the call shows beside the chat: at most one display, the last one asked for."""

    def __init__(self):
        self.shown = None

    def data(self, kind, data, title):
        """Shows data of a display kind, drawn by its widget or the platform's data view."""
        self.shown = {"type": "data", "kind": kind, "title": title, "data": _jsonable(data)}

    def html(self, html, title=None):
        """Shows the tool's own HTML in a sandboxed frame without network."""
        self.shown = {"type": "html", "html": html}
        if title is not None:
            self.shown["title"] = title


class Context:
    """What a handler is handed first: its Connections, its display and its log."""

    def __init__(self):
        self.display = Display()

    def connection(self, name):
        """The Connection name, whose declared operations .call(operation, input) calls."""
        return _connection(name)

    def log(self, *values):
        """Writes a line to the handler's log, never to the model."""
        print(*values, file=sys.stderr, flush=True)


def _parse_docstring(doc):
    """The docstring's text before its sections, and the description of each named entry."""
    lines = inspect.cleandoc(doc or "").splitlines()
    summary, entries = [], {}
    section, indent, current = None, None, None
    for line in lines:
        stripped = line.strip()
        heading = stripped[:-1].strip().lower() if stripped.endswith(":") else None
        if heading in _PARAMETER_SECTIONS | _OTHER_SECTIONS and line == line.lstrip():
            section, indent, current = heading, None, None
            continue
        field = _PARAM_FIELD.match(stripped)
        if field:
            current = field.group(1)
            entries[current] = field.group(2).strip()
            section = "fields"
            indent = len(line) - len(line.lstrip())
            continue
        if section is None:
            if not stripped.startswith(":"):
                summary.append(line)
            continue
        if section not in _PARAMETER_SECTIONS or not stripped:
            continue
        depth = len(line) - len(line.lstrip())
        if indent is None:
            indent = depth
        entry = _ENTRY.match(stripped) if depth <= indent else None
        if entry:
            current = entry.group(1)
            entries[current] = entry.group(2).strip()
        elif current is not None:
            entries[current] = (entries[current] + " " + stripped).strip()
    return "\n".join(summary).strip(), entries


def _json_type(value):
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if value is None:
        return "null"
    raise TypeError(f"A Literal value must be a str, int, float, bool or None, not {value!r}")


def _nullable(schema):
    if isinstance(schema.get("type"), str) and "anyOf" not in schema:
        widened = dict(schema, type=[schema["type"], "null"])
        if "enum" in widened and None not in widened["enum"]:
            widened["enum"] = [*widened["enum"], None]
        return widened
    return {"anyOf": [schema, {"type": "null"}]}


def _is_typeddict(hint):
    is_typeddict = getattr(typing, "is_typeddict", None)
    if is_typeddict is not None:
        return is_typeddict(hint)
    return isinstance(hint, type) and issubclass(hint, dict) and hasattr(hint, "__total__")


def _jsonable_default(value):
    try:
        json.dumps(value, allow_nan=False)
        return True
    except (TypeError, ValueError):
        return False


def _object_schema(described, hints, required, defaults, seen):
    properties = {}
    for name, hint in hints.items():
        schema = _schema(hint, seen)
        if name in described and "description" not in schema:
            schema = dict(schema, description=described[name])
        if name in defaults:
            default = defaults[name]
            if isinstance(default, enum.Enum):
                default = default.value
            if default is not None and _jsonable_default(default):
                schema = dict(schema, default=default)
        properties[name] = schema
    result = {"type": "object", "properties": properties}
    needed = [name for name in hints if name in required]
    if needed:
        result["required"] = needed
    result["additionalProperties"] = False
    return result


def _class_schema(hint, seen):
    if hint in seen:
        raise TypeError(f"{hint.__name__} refers to itself, which an input schema cannot say")
    seen = seen | {hint}
    hints = typing.get_type_hints(hint, include_extras=True)
    _, described = _parse_docstring(hint.__doc__)
    if dataclasses.is_dataclass(hint):
        fields = [field for field in dataclasses.fields(hint) if field.init]
        hints = {field.name: hints[field.name] for field in fields}
        missing = dataclasses.MISSING
        required = {
            field.name
            for field in fields
            if field.default is missing and field.default_factory is missing
        }
        defaults = {field.name: field.default for field in fields if field.default is not missing}
        schema = _object_schema(described, hints, required, defaults, seen)
        for field in fields:
            description = field.metadata.get("description")
            if isinstance(description, str):
                schema["properties"][field.name]["description"] = description
        return schema
    required = set(getattr(hint, "__required_keys__", hints))
    return _object_schema(described, hints, required, {}, seen)


def _schema(hint, seen=frozenset()):
    """The JSON Schema of one type hint."""
    if hint is typing.Any or hint is object or hint is inspect.Parameter.empty:
        return {}
    origin = typing.get_origin(hint)
    args = typing.get_args(hint)
    if origin is typing.Annotated:
        schema = _schema(args[0], seen)
        notes = [note for note in args[1:] if isinstance(note, str)]
        return dict(schema, description=" ".join(notes)) if notes else schema
    if hint is _NONE:
        return {"type": "null"}
    if origin in _UNION_TYPES:
        members = [member for member in args if member is not _NONE]
        inner = (
            _schema(members[0], seen)
            if len(members) == 1
            else {"anyOf": [_schema(member, seen) for member in members]}
        )
        return _nullable(inner) if len(members) < len(args) else inner
    if origin is typing.Literal:
        values = list(args)
        kinds = {_json_type(value) for value in values}
        schema = {"enum": values}
        if len(kinds) == 1:
            schema["type"] = kinds.pop()
        return schema
    if hint is bool:
        return {"type": "boolean"}
    if hint is int:
        return {"type": "integer"}
    if hint is float:
        return {"type": "number"}
    if hint is str:
        return {"type": "string"}
    if isinstance(hint, type) and issubclass(hint, enum.Enum):
        values = [member.value for member in hint]
        kinds = {_json_type(value) for value in values}
        schema = {"enum": values}
        if len(kinds) == 1:
            schema["type"] = kinds.pop()
        return schema
    if hint in _SEQUENCES or origin in _SEQUENCES:
        schema = {"type": "array"}
        items = [item for item in args if item is not Ellipsis]
        if len(items) == 1:
            schema["items"] = _schema(items[0], seen)
        elif items:
            raise TypeError(f"{hint!r} names several item types: use list[...] of one type")
        if hint in _SETS or origin in _SETS:
            schema["uniqueItems"] = True
        return schema
    if hint is dict or origin in (dict, collections.abc.Mapping):
        schema = {"type": "object"}
        if len(args) == 2:
            if args[0] is not str:
                raise TypeError(f"{hint!r} has keys that are no str, which JSON cannot hold")
            schema["additionalProperties"] = _schema(args[1], seen)
        return schema
    if dataclasses.is_dataclass(hint) and isinstance(hint, type):
        return _class_schema(hint, seen)
    if _is_typeddict(hint):
        return _class_schema(hint, seen)
    raise TypeError(
        f"catalyst_tools cannot describe the type {hint!r}: use str, int, float, bool, "
        "Literal, list, Optional, TypedDict or a dataclass"
    )


def _convert(hint, value):
    """The value of the input as the hint names it: a dataclass is built from its object."""
    origin = typing.get_origin(hint)
    args = typing.get_args(hint)
    if origin is typing.Annotated:
        return _convert(args[0], value)
    if value is None:
        return None
    if origin in _UNION_TYPES:
        members = [member for member in args if member is not _NONE]
        return _convert(members[0], value) if len(members) == 1 else value
    if dataclasses.is_dataclass(hint) and isinstance(hint, type) and isinstance(value, dict):
        hints = typing.get_type_hints(hint, include_extras=True)
        given = {
            field.name: _convert(hints[field.name], value[field.name])
            for field in dataclasses.fields(hint)
            if field.init and field.name in value
        }
        return hint(**given)
    if isinstance(hint, type) and issubclass(hint, enum.Enum):
        return hint(value)
    if (hint in _SEQUENCES or origin in _SEQUENCES) and isinstance(value, list):
        items = [item for item in args if item is not Ellipsis]
        converted = [_convert(items[0], item) for item in value] if len(items) == 1 else value
        kind = origin or hint
        if kind is tuple:
            return tuple(converted)
        if kind is frozenset:
            return frozenset(converted)
        if kind in _SETS:
            return set(converted)
        return converted
    if (hint is float) and isinstance(value, int) and not isinstance(value, bool):
        return float(value)
    return value


def _jsonable(value):
    """A value as JSON holds it: a dataclass as its object, an enum as its value."""
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return {key: _jsonable(item) for key, item in dataclasses.asdict(value).items()}
    if isinstance(value, enum.Enum):
        return _jsonable(value.value)
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_jsonable(item) for item in value]
    return value


class ToolDefinition:
    """A function @tool marked: its name, its description and its input schema."""

    def __init__(self, function, name=None, description=None):
        if not callable(function):
            raise TypeError("@tool marks a function")
        self.function = function
        self.explicit_name = name
        self.name = name or function.__name__
        if name is not None and not _TOOL_NAME.match(name):
            raise ValueError(
                f"The tool name {name!r} is no name: lowercase letters, digits and _, "
                "starting with a letter"
            )
        summary, described = _parse_docstring(function.__doc__)
        self.description = description or summary or None
        signature = inspect.signature(function)
        parameters = list(signature.parameters.values())
        if not parameters or parameters[0].kind not in (
            inspect.Parameter.POSITIONAL_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
        ):
            raise TypeError(f"{function.__name__} takes ctx as its first argument")
        hints = typing.get_type_hints(function, include_extras=True)
        self.hints = {}
        required, defaults = set(), {}
        for parameter in parameters[1:]:
            if parameter.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
                raise TypeError(
                    f"{function.__name__} takes *{parameter.name}: a tool's input is named fields"
                )
            if parameter.kind is inspect.Parameter.POSITIONAL_ONLY:
                raise TypeError(f"{parameter.name} of {function.__name__} must be passable by name")
            if parameter.name not in hints:
                raise TypeError(
                    f"{parameter.name} of {function.__name__} has no type hint, which its "
                    "input schema is made from"
                )
            self.hints[parameter.name] = hints[parameter.name]
            if parameter.default is inspect.Parameter.empty:
                required.add(parameter.name)
            else:
                defaults[parameter.name] = parameter.default
        self.required = required
        self.input = _object_schema(described, self.hints, required, defaults, frozenset())

    def arguments(self, given):
        """The keyword arguments a call with the input given passes the function."""
        if not isinstance(given, dict):
            raise TypeError("A tool's input is a JSON object")
        missing = sorted(name for name in self.required if name not in given)
        if missing:
            raise TypeError(f"The input has no {', '.join(missing)}")
        return {
            name: _convert(hint, given[name]) for name, hint in self.hints.items() if name in given
        }

    def run(self, given, ctx=None):
        """Calls the function with the input given, and answers what the platform reads."""
        ctx = ctx or Context()
        output = self.function(ctx, **self.arguments(given))
        if inspect.isawaitable(output):
            output = asyncio.run(_awaited(output))
        answer = {"output": _jsonable(output)}
        if ctx.display.shown is not None:
            answer["display"] = ctx.display.shown
        return answer

    def describe(self):
        """The fields the CLI writes into the tool's definition."""
        described = {"input": self.input, "function": self.function.__name__}
        if self.explicit_name is not None:
            described["name"] = self.explicit_name
        if self.description:
            described["description"] = self.description
        return described


async def _awaited(awaitable):
    return await awaitable


_failed = []


def _note_failure(previous):
    def hook(kind, value, trace):
        _failed.append(kind)
        previous(kind, value, trace)

    return hook


def _serve(definition):
    """Answers the platform's call of the tool, once the handler's file has run to its end."""
    if _failed:
        return
    try:
        source = os.environ.get("WORKFLOW_INPUT_FILE")
        if source:
            with open(source, encoding="utf-8") as handle:
                given = json.load(handle)
        else:
            given = json.load(sys.stdin)
        text = json.dumps(definition.run(given), ensure_ascii=False, allow_nan=False)
        target = os.environ.get("WORKFLOW_OUTPUT_FILE")
        if target:
            with open(target, "w", encoding="utf-8") as handle:
                handle.write(text)
        else:
            sys.stdout.write(text)
            sys.stdout.flush()
    except BaseException:
        traceback.print_exc()
        sys.stderr.flush()
        sys.stdout.flush()
        os._exit(1)


_served = []


def tool(function=None, *, name=None, description=None):
    """Marks the function a tool. Its file, run as the tool's main.py, answers the call."""

    def mark(function):
        definition = ToolDefinition(function, name, description)
        function.__catalyst_tool__ = definition
        if function.__module__ == "__main__":
            if _served:
                raise TypeError("main.py marks one function with @tool")
            _served.append(definition)
            sys.excepthook = _note_failure(sys.excepthook)
            atexit.register(_serve, definition)
        return function

    return mark if function is None else mark(function)


def describe(path):
    """The definition fields of the one @tool function of the file at path."""
    folder = os.path.dirname(os.path.abspath(path))
    if folder not in sys.path:
        sys.path.insert(0, folder)
    spec = importlib.util.spec_from_file_location("catalyst_tool_handler", path)
    module = importlib.util.module_from_spec(spec)
    # A dataclass reads its module from sys.modules while it is made.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    found = [
        value.__catalyst_tool__
        for value in vars(module).values()
        if isinstance(getattr(value, "__catalyst_tool__", None), ToolDefinition)
        and getattr(value, "__module__", None) == module.__name__
    ]
    if len(found) != 1:
        raise TypeError(
            f"{os.path.basename(path)} marks {len(found)} functions with @tool; it must mark one"
        )
    return found[0].describe()


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "describe":
        sys.stderr.write("Usage: python3 -m catalyst_tools describe <main.py>\n")
        sys.exit(2)
    # The handler imports this module by its name: its marks are that module's, not __main__'s.
    import catalyst_tools

    try:
        json.dump(catalyst_tools.describe(sys.argv[2]), sys.stdout)
    except Exception as error:
        sys.stderr.write(f"{type(error).__name__}: {error}\n")
        sys.exit(1)
`;

const NODE_SDK = String.raw`// Answers the platform's call of a code tool written with defineTool. The CLI bundles a
// tool's index.ts into one module that hands its tool to serve().
import { readFileSync, writeFileSync } from "node:fs";
import { connection } from "./catalyst-tool.mjs";

/** What a handler is handed beside its input: its Connections, its display and its log. */
export function createContext() {
  const context = {
    shown: undefined,
    connection,
    display: {
      data(kind, data, title) {
        context.shown = { type: "data", kind, title, data };
      },
      html(html, title) {
        context.shown = title === undefined ? { type: "html", html } : { type: "html", html, title };
      }
    },
    log: (...values) => console.error(...values)
  };
  return context;
}

/** Calls the tool with the input given, and answers what the platform reads. */
export async function run(tool, given, context = createContext()) {
  const parsed = tool.inputSchema?.safeParse ? tool.inputSchema.safeParse(given) : { success: true, data: given };
  if (!parsed.success) throw new Error("The input does not fit the tool's schema: " + parsed.error.message);
  const output = await tool.execute(parsed.data, {
    connection: context.connection,
    display: context.display,
    log: context.log
  });
  return context.shown === undefined
    ? { output: output === undefined ? null : output }
    : { output: output === undefined ? null : output, display: context.shown };
}

/** Answers the call the platform hands this process. */
export async function serve(tool) {
  try {
    const source = process.env.WORKFLOW_INPUT_FILE;
    const given = JSON.parse(readFileSync(source === undefined || source === "" ? 0 : source, "utf8"));
    const text = JSON.stringify(await run(tool, given));
    const target = process.env.WORKFLOW_OUTPUT_FILE;
    if (target) writeFileSync(target, text);
    else process.stdout.write(text);
  } catch (error) {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  }
}
`;

/**
 * The modules a handler imports by name: `catalyst_tool` and `catalyst_tools` in Python,
 * `catalyst-tool` and `catalyst-tools` in Node.
 */
export const TOOL_CODE_LIBRARY: readonly { path: string; content: string }[] = [
  { path: "catalyst_tool.py", content: PYTHON },
  { path: "catalyst-tool.mjs", content: NODE },
  { path: "catalyst_tools.py", content: PYTHON_SDK },
  { path: "catalyst-tools.mjs", content: NODE_SDK }
];
