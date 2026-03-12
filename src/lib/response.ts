import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type NextAction = {
  command: string;
  description: string;
  params?: Record<
    string,
    {
      description?: string;
      value?: string | number | boolean;
      default?: string | number | boolean;
      enum?: string[];
      required?: boolean;
    }
  >;
};

export type SuccessEnvelope = {
  ok: true;
  command: string;
  result: Record<string, unknown>;
  next_actions: NextAction[];
};

export type ErrorEnvelope = {
  ok: false;
  command: string;
  error: {
    message: string;
    code: string;
  };
  fix: string;
  next_actions: NextAction[];
};

export type Envelope = SuccessEnvelope | ErrorEnvelope;

export const printEnvelope = (envelope: Envelope) => {
  console.log(JSON.stringify(envelope, null, 2));
  if (!envelope.ok) {
    process.exitCode = 1;
  }
};

export const success = (
  command: string,
  result: Record<string, unknown>,
  nextActions: NextAction[],
): SuccessEnvelope => ({
  ok: true,
  command,
  result,
  next_actions: nextActions,
});

export const failure = (
  command: string,
  message: string,
  code: string,
  fix: string,
  nextActions: NextAction[],
): ErrorEnvelope => ({
  ok: false,
  command,
  error: {
    message,
    code,
  },
  fix,
  next_actions: nextActions,
});

export const maybeWriteFullOutput = async (
  baseName: string,
  payload: unknown,
  shouldWrite: boolean,
) => {
  if (!shouldWrite) {
    return null;
  }

  const directory = await mkdtemp(join(tmpdir(), "slog-"));
  const fullOutput = join(directory, `${baseName}.json`);
  await writeFile(fullOutput, JSON.stringify(payload, null, 2));
  return fullOutput;
};
