#!/usr/bin/env node

import { dirname } from "node:path";
import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer, pipe } from "effect";
import { failure, printEnvelope, success, type NextAction } from "./lib/response";
import {
  DEFAULT_FILENAME,
  MAX_RECENT_LINES,
  appendEntry,
  getPathResolution,
  parseJsonOption,
  readRecentEntries,
  resolveLogFile,
  statLogFile,
} from "./lib/storage";

const CLI_NAME = "slog";
const CLI_VERSION = "0.1.0";

type OptionalValue<T> = { _tag: "None" } | { _tag: "Some"; value: T };

const fromOption = <T>(option: OptionalValue<T>) =>
  option._tag === "Some" ? option.value : undefined;

const optionalText = (name: string, description?: string) => {
  const option = pipe(Options.text(name), Options.optional);
  return description ? pipe(option, Options.withDescription(description)) : option;
};

const writeTemplateCommand =
  "slog write --message <message> [--status <status>] [--event <event>] [--task <task>] [--agent <agent>] [--session-id <id>] [--cwd <path>] [--data <json>] [--file <path>]";

const baseCommands = [
  {
    name: "path",
    description: "Show the resolved JSONL log file path",
    usage: "slog path [--file <path>]",
  },
  {
    name: "write",
    description: "Append a structured JSONL work log entry",
    usage: writeTemplateCommand,
  },
  {
    name: "recent",
    description: "Read recent JSONL entries with optional filters",
    usage:
      "slog recent [--lines <lines>] [--event <event>] [--status <status>] [--agent <agent>] [--task <task>] [--cwd <path>] [--file <path>]",
  },
];

const pathNextActions = (filePath: string): NextAction[] => [
  {
    command: writeTemplateCommand,
    description: "Append a work log entry to the resolved JSONL file",
    params: {
      message: {
        description: "What happened",
        required: true,
      },
      path: {
        value: filePath,
        description: "Resolved JSONL log path",
      },
    },
  },
  {
    command: "slog recent [--lines <lines>] [--file <path>]",
    description: "Inspect the latest log entries",
    params: {
      lines: {
        default: 20,
        description: "Number of recent entries to return",
      },
      path: {
        value: filePath,
        description: "Resolved JSONL log path",
      },
    },
  },
];

const writeNextActions = (filePath: string): NextAction[] => [
  {
    command: "slog recent [--lines <lines>] [--file <path>]",
    description: "Verify the newly appended entry in the recent log view",
    params: {
      lines: {
        default: 10,
        description: "How many entries to inspect",
      },
      path: {
        value: filePath,
        description: "JSONL log path",
      },
    },
  },
  {
    command: writeTemplateCommand,
    description: "Append the next milestone, block, or completion event",
    params: {
      message: {
        description: "What changed next",
        required: true,
      },
      status: {
        default: "progress",
        description: "Lifecycle state for the next entry",
      },
      event: {
        default: "work",
        description: "Entry category",
      },
      path: {
        value: filePath,
        description: "JSONL log path",
      },
    },
  },
];

const recentNextActions = (filePath: string): NextAction[] => [
  {
    command: writeTemplateCommand,
    description: "Append another entry to the same log",
    params: {
      message: {
        description: "What just happened",
        required: true,
      },
      path: {
        value: filePath,
        description: "JSONL log path",
      },
    },
  },
  {
    command:
      "slog recent [--lines <lines>] [--status <status>] [--event <event>] [--agent <agent>] [--task <task>] [--cwd <path>] [--file <path>]",
    description: "Refine the recent view with tighter filters",
    params: {
      lines: {
        default: 20,
        description: "Number of entries to return",
      },
      path: {
        value: filePath,
        description: "JSONL log path",
      },
    },
  },
];

const pathCommand = Command.make(
  "path",
  {
    file: optionalText("file", "Override the JSONL log file path for this command"),
  },
  ({ file }) =>
    Effect.gen(function* () {
      const filePath = resolveLogFile(fromOption(file));
      const fileInfo = yield* Effect.promise(() => statLogFile(filePath));

      printEnvelope(
        success(
          "slog path",
          {
            name: CLI_NAME,
            version: CLI_VERSION,
            path: filePath,
            directory: dirname(filePath),
            exists: fileInfo.exists,
            size_bytes: fileInfo.size_bytes,
            modified_at: fileInfo.modified_at,
            resolution: getPathResolution(fromOption(file)),
          },
          pathNextActions(filePath),
        ),
      );
    }),
).pipe(Command.withDescription("Show the resolved JSONL log file path"));

const writeCommand = Command.make(
  "write",
  {
    message: Options.text("message").pipe(
      Options.withDescription("Single-line description of the work performed"),
    ),
    event: optionalText("event", "Entry category, e.g. work, test, decision, block"),
    status: optionalText(
      "status",
      "Lifecycle state, e.g. started, progress, blocked, completed, failed",
    ),
    task: optionalText("task", "Task, issue, or story identifier"),
    agent: optionalText("agent", "Agent name or runtime, e.g. pi, codex, claude"),
    sessionId: optionalText("session-id", "Session identifier for the current agent run"),
    cwd: optionalText("cwd", "Working directory for the logged work item"),
    data: optionalText("data", "Optional JSON object or value with structured metadata"),
    file: optionalText("file", "Override the JSONL log file path for this command"),
  },
  ({ agent, cwd, data, event, file, message, sessionId, status, task }) =>
    Effect.gen(function* () {
      const messageText = message.trim();
      const filePath = resolveLogFile(fromOption(file));

      if (!messageText) {
        printEnvelope(
          failure(
            "slog write",
            "Message must not be empty",
            "EMPTY_MESSAGE",
            "Provide a non-empty --message value that explains the work performed.",
            writeNextActions(filePath),
          ),
        );
        return;
      }

      const parsedData = parseJsonOption(fromOption(data));
      if (!parsedData.ok) {
        printEnvelope(
          failure(
            "slog write",
            `Invalid JSON passed to --data: ${parsedData.message}`,
            "INVALID_JSON",
            'Pass valid JSON to --data, for example --data \'{"files":["src/index.ts"]}\'.',
            writeNextActions(filePath),
          ),
        );
        return;
      }

      const entry = yield* Effect.promise(() =>
        appendEntry(filePath, {
          message: messageText,
          event: fromOption(event) ?? "work",
          status: fromOption(status) ?? "note",
          task: fromOption(task) ?? null,
          agent: fromOption(agent) ?? null,
          sessionId: fromOption(sessionId) ?? null,
          cwd: fromOption(cwd) ?? process.cwd(),
          data: parsedData.value,
        }),
      );

      printEnvelope(
        success(
          "slog write",
          {
            path: filePath,
            appended_bytes: Buffer.byteLength(`${JSON.stringify(entry)}\n`),
            entry,
          },
          writeNextActions(filePath),
        ),
      );
    }),
).pipe(Command.withDescription("Append a structured JSONL work log entry"));

const recentCommand = Command.make(
  "recent",
  {
    lines: Options.integer("lines").pipe(
      Options.withDefault(20),
      Options.withDescription(`Number of recent entries to return (capped at ${MAX_RECENT_LINES})`),
    ),
    event: optionalText("event", "Only return entries matching this event name"),
    status: optionalText("status", "Only return entries matching this status"),
    agent: optionalText("agent", "Only return entries for this agent name"),
    task: optionalText("task", "Only return entries for this task identifier"),
    cwd: optionalText("cwd", "Only return entries for this working directory"),
    file: optionalText("file", "Override the JSONL log file path for this command"),
  },
  ({ agent, cwd, event, file, lines, status, task }) =>
    Effect.gen(function* () {
      const filePath = resolveLogFile(fromOption(file));
      const result = yield* Effect.promise(() =>
        readRecentEntries(filePath, lines, {
          event: fromOption(event),
          status: fromOption(status),
          agent: fromOption(agent),
          task: fromOption(task),
          cwd: fromOption(cwd),
        }),
      );

      printEnvelope(
        success(
          "slog recent",
          {
            path: filePath,
            exists: result.exists,
            requested_lines: result.requested_lines,
            capped_lines: result.capped_lines,
            returned: result.returned,
            total_lines: result.total_lines,
            matched_lines: result.matched_lines,
            parse_errors: result.parse_errors,
            truncated: result.matched_lines > result.returned,
            filters: {
              event: fromOption(event) ?? null,
              status: fromOption(status) ?? null,
              agent: fromOption(agent) ?? null,
              task: fromOption(task) ?? null,
              cwd: fromOption(cwd) ?? null,
            },
            entries: result.entries,
          },
          recentNextActions(filePath),
        ),
      );
    }),
).pipe(Command.withDescription("Read recent JSONL entries with optional filters"));

const rootCommand = Command.make(CLI_NAME, {}, () =>
  Effect.sync(() => {
    const defaultPath = resolveLogFile();

    printEnvelope(
      success(
        "slog",
        {
          name: CLI_NAME,
          version: CLI_VERSION,
          description:
            "System log CLI for coding agents. Appends structured JSONL entries to a consistent state file.",
          default_log_path: defaultPath,
          default_filename: DEFAULT_FILENAME,
          prompt_file: "PROMPT.md",
          commands: baseCommands,
          entry_shape: {
            v: 1,
            id: "uuid",
            ts: "ISO-8601 timestamp",
            event: "string",
            status: "string",
            message: "string",
            agent: "string | null",
            task: "string | null",
            session_id: "string | null",
            cwd: "string",
            pid: "number",
            host: "string",
            data: "unknown | undefined",
          },
        },
        [
          {
            command: "slog path",
            description: "See where entries will be written by default",
          },
          {
            command: "slog write --message <message> --status started --event task",
            description: "Append an explicit task-start entry",
            params: {
              message: {
                description: "Task being started",
                required: true,
              },
            },
          },
          {
            command: "slog recent --lines <lines>",
            description: "Inspect the latest entries",
            params: {
              lines: {
                default: 20,
                description: "Number of entries to return",
              },
            },
          },
        ],
      ),
    );
  }),
).pipe(
  Command.withDescription("System log CLI for coding agents"),
  Command.withSubcommands([pathCommand, writeCommand, recentCommand]),
);

const cli = Command.run(rootCommand, {
  name: CLI_NAME,
  version: CLI_VERSION,
});

cli(process.argv).pipe(
  Effect.provide(Layer.mergeAll(NodeContext.layer)),
  NodeRuntime.runMain as never,
);
