/*
  The `claude` CLI as a brain: `claude -p` with a JSON Schema, no tools, no session on
  disk, and the prompt on stdin. `--system-prompt` REPLACES Claude Code's own — the
  brain is a writer, not a coding agent, and the default prompt is ten thousand tokens
  of instructions about editing files that would be paid for on every question.
  `--json-schema` makes the CLI validate the shape before it answers; what comes back
  in `structured_output` is already an object.
*/
import { modelFor, onPath, parseJsonLoosely, spawnWithStdin, type Ask, type Availability, type Completion, type Driver } from "../driver.ts";

/** An alias the CLI resolves to the current model of that tier; never a dated id. */
export const CLAUDE_DEFAULT_MODEL = "sonnet";

export function claudeArgs(ask: Ask): string[] {
  return [
    "-p",
    "--output-format", "json",
    "--json-schema", JSON.stringify(ask.schema),
    "--system-prompt", ask.system,
    "--tools", "",
    /* Only the MCP servers named on this command line, which is none: the person's own servers otherwise load every tool schema into the prompt, and one question cost seventy times more. */
    "--strict-mcp-config",
    "--no-session-persistence",
    "--model", ask.model,
    ...(ask.effort ? ["--effort", ask.effort] : []),
  ];
}

export const claude: Driver = {
  name: "claude",
  async available(env = process.env): Promise<Availability> {
    const version = await onPath("claude");
    if (!version) return { ok: false, why: "the claude CLI is not on PATH" };
    return { ok: true, model: modelFor(env, CLAUDE_DEFAULT_MODEL), how: `claude -p (${version})` };
  },
  async complete(ask: Ask): Promise<Completion> {
    const { stdout, stderr, code } = await spawnWithStdin("claude", claudeArgs(ask), ask.user, { timeoutMs: ask.timeoutMs, cwd: ask.scratchDir, signal: ask.signal });
    if (code !== 0 && !stdout.trim()) throw new Error(`claude exited ${code}: ${stderr.trim().split("\n").slice(-1)[0] ?? ""}`);
    const result = parseJsonLoosely(stdout) as {
      is_error?: boolean;
      result?: string;
      subtype?: string;
      error?: unknown;
      api_error_status?: unknown;
      structured_output?: unknown;
      modelUsage?: Record<string, { inputTokens?: number; outputTokens?: number; canonicalModel?: string }>;
    };
    if (result.is_error) {
      /* The CLI's error lives in whichever of these it chose to fill; the log should carry all of them, not an empty string. */
      const why = [result.subtype, result.error && JSON.stringify(result.error), result.api_error_status && `api ${JSON.stringify(result.api_error_status)}`, result.result].filter(Boolean).join(" · ");
      throw new Error(`claude answered with an error: ${String(why || stderr.trim().split("\n").slice(-1)[0] || "(no detail)").slice(0, 300)}`);
    }
    const json = result.structured_output ?? parseJsonLoosely(String(result.result ?? ""));
    /* The heaviest model in the usage table is the one that wrote the answer; the CLI also bills a small router model. */
    const used = Object.values(result.modelUsage ?? {}).sort((a, b) => (b.outputTokens ?? 0) - (a.outputTokens ?? 0))[0];
    return { json, model: used?.canonicalModel ?? ask.model, usage: used ? { input: used.inputTokens, output: used.outputTokens } : undefined };
  },
};
