/*
  What a brain is made of, underneath: one function that takes a system prompt, a user
  prompt and a JSON Schema, and returns JSON. Four things can play that part on a
  developer's machine — the `claude` CLI, the `codex` CLI, an Anthropic key, an OpenAI
  key — and they differ only in how the prompt travels and how the schema is enforced.
  Everything above this file (the cache, the cap, the audit, the questions) is the same
  whatever answers.

  The CLI agents come first in the detection order, and on purpose: they are the agent
  the person already installed and signed into, they bill nothing per call beyond the
  plan they already pay for, and they are what "the agent that is programming right
  now" means on this machine. A key is consent to spend, and it is honoured second.
*/
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type DriverName = "claude" | "codex" | "anthropic" | "openai";

/** Detection order: the agents on the machine, then the keys in the environment. */
export const DRIVER_NAMES: readonly DriverName[] = ["claude", "codex", "anthropic", "openai"];

export type Ask = {
  system: string;
  user: string;
  /** The JSON Schema the answer must fit; every driver that can enforce it does. */
  schema: Record<string, unknown>;
  model: string;
  timeoutMs: number;
  /** A directory this call may write scratch files into, and run from. */
  scratchDir: string;
  /*
    How hard the model may think. A re-rank of one page and a caption are answered
    well at "low" and take a fraction of the time; the thesis and the words are left
    at the driver's own default. Only the CLI agents take it; the APIs ignore it.
  */
  effort?: Effort;
  signal?: AbortSignal;
};

export type Effort = "low" | "medium" | "high";

export type Completion = {
  json: unknown;
  /** The model that actually answered, as the driver reports it. */
  model: string;
  usage?: { input?: number; output?: number };
};

/** An answer reached the driver but cannot be decoded; shares the one shape-correction attempt. */
export class DriverAnswerInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriverAnswerInvalid";
  }
}

export type Availability = { ok: true; model: string; how: string } | { ok: false; why: string };

export type Driver = {
  readonly name: DriverName;
  /** Whether this driver can answer on this machine right now, and with which model. */
  available(env?: NodeJS.ProcessEnv): Promise<Availability>;
  complete(ask: Ask): Promise<Completion>;
};

/** The model the operator asked for, or the driver's own default. */
export function modelFor(env: NodeJS.ProcessEnv, fallback: string): string {
  return env.PANOMA_VIDEO_BRAIN_MODEL?.trim() || fallback;
}

/** A binary that answers `--version` within a few seconds, or null. */
export async function onPath(bin: string): Promise<string | null> {
  try {
    const { stdout } = await run(bin, ["--version"], { timeout: 15_000 });
    return stdout.trim().split("\n")[0] || bin;
  } catch {
    return null;
  }
}

/**
 * Run a command with the prompt on stdin, collect both streams, and kill the whole
 * thing on timeout or cancellation. Stdin, not argv: a prompt carries a page's
 * accessibility tree, and argv has a ceiling that stdin does not.
 */
export function spawnWithStdin(
  bin: string,
  args: string[],
  stdin: string,
  opts: { timeoutMs: number; cwd: string; signal?: AbortSignal; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const kill = (why: string) => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
      finish(() => reject(new Error(why)));
    };
    const onAbort = () => kill(`${bin} was cancelled`);
    const timer = setTimeout(() => kill(`${bin} did not answer within ${Math.round(opts.timeoutMs / 1000)} s`), opts.timeoutMs);
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => finish(() => reject(e)));
    child.on("close", (code) => finish(() => resolve({ stdout, stderr, code })));
    child.stdin.on("error", () => undefined);
    child.stdin.end(stdin);
  });
}

/** JSON from a model's text, tolerating a fence or a sentence around it. */
export function parseJsonLoosely(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through to the first balanced object */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error(`the answer is not JSON: ${trimmed.slice(0, 120)}`);
}
