import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_FILENAME = "system-log.jsonl";
export const MAX_RECENT_LINES = 200;

export type SlogEntry = {
  v: 1;
  id: string;
  ts: string;
  event: string;
  status: string;
  message: string;
  agent: string | null;
  task: string | null;
  session_id: string | null;
  cwd: string;
  pid: number;
  host: string;
  data?: unknown;
};

export type WriteEntryInput = {
  message: string;
  event?: string;
  status?: string;
  agent?: string | null;
  task?: string | null;
  sessionId?: string | null;
  cwd?: string;
  data?: unknown;
  ts?: string;
};

export type EntryFilters = {
  event?: string;
  status?: string;
  agent?: string;
  task?: string;
  cwd?: string;
};

const ENV_FILE_KEYS = ["SLOG_FILE", "SLOG_PATH"] as const;

const trimToUndefined = (value: string | undefined | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const expandHome = (value: string) => {
  if (value === "~") {
    return homedir();
  }

  if (value.startsWith("~/")) {
    return join(homedir(), value.slice(2));
  }

  return value;
};

const envFileOverride = () => {
  for (const key of ENV_FILE_KEYS) {
    const value = trimToUndefined(process.env[key]);
    if (value) {
      return {
        key,
        value: expandHome(value),
      };
    }
  }

  return null;
};

export const resolveLogFile = (file?: string) => {
  const explicitFile = trimToUndefined(file);
  if (explicitFile) {
    return expandHome(explicitFile);
  }

  const fileOverride = envFileOverride();
  if (fileOverride) {
    return fileOverride.value;
  }

  const envDir = trimToUndefined(process.env.SLOG_DIR);
  if (envDir) {
    return join(expandHome(envDir), DEFAULT_FILENAME);
  }

  const xdgStateHome = trimToUndefined(process.env.XDG_STATE_HOME);
  if (xdgStateHome) {
    return join(expandHome(xdgStateHome), "slog", DEFAULT_FILENAME);
  }

  return join(homedir(), ".local", "state", "slog", DEFAULT_FILENAME);
};

export const getPathResolution = (file?: string) => ({
  file_flag: trimToUndefined(file) ?? null,
  env_file: envFileOverride(),
  env_dir: trimToUndefined(process.env.SLOG_DIR) ?? null,
  xdg_state_home: trimToUndefined(process.env.XDG_STATE_HOME) ?? null,
  default_filename: DEFAULT_FILENAME,
});

export const statLogFile = async (filePath: string) => {
  try {
    const info = await stat(filePath);
    return {
      exists: true,
      size_bytes: info.size,
      modified_at: info.mtime.toISOString(),
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        exists: false,
        size_bytes: 0,
        modified_at: null,
      };
    }

    throw error;
  }
};

export const createEntry = (input: WriteEntryInput): SlogEntry => ({
  v: 1,
  id: randomUUID(),
  ts: input.ts ?? new Date().toISOString(),
  event: input.event ?? "note",
  status: input.status ?? "note",
  message: input.message,
  agent:
    input.agent ??
    trimToUndefined(process.env.SLOG_AGENT) ??
    trimToUndefined(process.env.PI_AGENT_NAME) ??
    null,
  task: input.task ?? null,
  session_id: input.sessionId ?? trimToUndefined(process.env.PI_SESSION_ID) ?? null,
  cwd: input.cwd ?? process.cwd(),
  pid: process.pid,
  host: hostname(),
  ...(input.data === undefined ? {} : { data: input.data }),
});

export const appendEntry = async (filePath: string, input: WriteEntryInput) => {
  const entry = createEntry(input);
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
};

export const parseJsonOption = (raw: string | undefined) => {
  if (!raw) {
    return {
      ok: true as const,
      value: undefined,
    };
  }

  try {
    return {
      ok: true as const,
      value: JSON.parse(raw),
    };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
};

const matchesFilter = (entry: SlogEntry, filters: EntryFilters) => {
  if (filters.event && entry.event !== filters.event) {
    return false;
  }

  if (filters.status && entry.status !== filters.status) {
    return false;
  }

  if (filters.agent && entry.agent !== filters.agent) {
    return false;
  }

  if (filters.task && entry.task !== filters.task) {
    return false;
  }

  if (filters.cwd && entry.cwd !== filters.cwd) {
    return false;
  }

  return true;
};

export const readRecentEntries = async (
  filePath: string,
  requestedLines: number,
  filters: EntryFilters = {},
) => {
  try {
    const content = await readFile(filePath, "utf8");
    const rawLines = content.split("\n").filter(Boolean);
    const parsed: SlogEntry[] = [];
    let parseErrors = 0;

    for (const line of rawLines) {
      try {
        const candidate = JSON.parse(line) as SlogEntry;
        if (matchesFilter(candidate, filters)) {
          parsed.push(candidate);
        }
      } catch {
        parseErrors += 1;
      }
    }

    const limit = Math.max(1, Math.min(requestedLines, MAX_RECENT_LINES));
    return {
      exists: true,
      requested_lines: requestedLines,
      capped_lines: limit,
      returned: Math.min(parsed.length, limit),
      total_lines: rawLines.length,
      matched_lines: parsed.length,
      parse_errors: parseErrors,
      entries: parsed.slice(-limit),
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        exists: false,
        requested_lines: requestedLines,
        capped_lines: Math.max(1, Math.min(requestedLines, MAX_RECENT_LINES)),
        returned: 0,
        total_lines: 0,
        matched_lines: 0,
        parse_errors: 0,
        entries: [] as SlogEntry[],
      };
    }

    throw error;
  }
};
