# slog

`slog` is a Bun + Effect CLI that appends a structured JSONL system log for coding agents.

It is designed to make agent work observable while staying cheap to write from shell scripts, prompts, and tool wrappers.

## Goals

- consistent default log location
- append-only JSONL
- structured fields for agent/session/task/cwd
- agent-friendly JSON envelopes on every command
- low-friction logging while work is happening

## Default storage

By default, entries are written to:

```txt
$XDG_STATE_HOME/slog/system-log.jsonl
```

If `XDG_STATE_HOME` is not set, `slog` falls back to:

```txt
~/.local/state/slog/system-log.jsonl
```

## Overrides

Resolution order:

1. `--file <path>`
2. `SLOG_FILE` or `SLOG_PATH`
3. `SLOG_DIR` + `/system-log.jsonl`
4. `XDG_STATE_HOME/slog/system-log.jsonl`
5. `~/.local/state/slog/system-log.jsonl`

## Commands

### Show the resolved path

```bash
bun run src/index.ts path
```

### Append a log entry

```bash
bun run src/index.ts write \
  --message "Started wiring the slog CLI" \
  --status started \
  --event task \
  --task slog-mvp \
  --agent pi \
  --data '{"files":["src/index.ts"]}'
```

### Read recent entries

```bash
bun run src/index.ts recent --lines 20
```

Filter recent entries:

```bash
bun run src/index.ts recent --status blocked --task slog-mvp
```

## Entry shape

Each JSONL line looks like:

```json
{
  "v": 1,
  "id": "04e8c95f-1f19-4d0f-90d0-7f8df1b739e7",
  "ts": "2026-03-12T15:00:00.000Z",
  "event": "work",
  "status": "progress",
  "message": "Implemented slog write command",
  "agent": "pi",
  "task": "slog-mvp",
  "session_id": null,
  "cwd": "/Users/joel/Code/joelhooks/slog",
  "pid": 12345,
  "host": "workstation.local",
  "data": {
    "files": ["src/index.ts"]
  }
}
```

## Build

```bash
bun install
bun run build
bun run compile
```

To install the compiled binary globally:

```bash
cp dist/slog ~/.bun/bin/
```

## Prompting agents to use slog

See [PROMPT.md](./PROMPT.md) for a minimal prompt contract that pushes agents to log real progress instead of nooping.
