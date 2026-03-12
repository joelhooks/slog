# slog prompt

Use `slog` to write a running system log while you work.

## Rules

1. Do **not** noop.
2. At task start, append a `started` entry.
3. After every meaningful inspection, edit, test run, decision, or blocker, append another entry.
4. When blocked, append a `blocked` entry with the reason and any next step.
5. On completion, append a `completed` entry summarizing the shipped result.
6. If you are still figuring things out, log what you are inspecting instead of staying silent.

## Minimal command pattern

```bash
slog write \
  --message "What just happened" \
  --status progress \
  --event work \
  --task <task-id> \
  --agent <agent-name>
```

## Recommended lifecycle

### Start

```bash
slog write --message "Starting <task>" --status started --event task --task <task-id> --agent <agent-name>
```

### Progress

```bash
slog write --message "Inspected auth flow and found token parsing bug" --status progress --event investigation --task <task-id> --agent <agent-name>
```

### Code change

```bash
slog write --message "Updated src/index.ts to append JSONL entries" --status progress --event code --task <task-id> --agent <agent-name> --data '{"files":["src/index.ts"]}'
```

### Test result

```bash
slog write --message "bun run build passed" --status progress --event test --task <task-id> --agent <agent-name>
```

### Blocked

```bash
slog write --message "Blocked on missing API token" --status blocked --event block --task <task-id> --agent <agent-name>
```

### Completed

```bash
slog write --message "Shipped slog MVP with write/path/recent commands" --status completed --event task --task <task-id> --agent <agent-name>
```
