/*
  The `codex` CLI as a brain: `codex exec` in its read-only sandbox, ephemeral (no
  session on disk), with the schema in a file it enforces and the last message written
  to another. Codex has no separate system prompt, so the two travel as one text; it
  runs from the scratch directory rather than from the project or from panoma video's own
  repository, so a brain that decided to look around would find nothing to look at.
  The model is whatever the person configured for codex, unless PANOMA_VIDEO_BRAIN_MODEL says.
*/
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { redact } from "@panoma/video-core";
import { onPath, parseJsonLoosely, spawnWithStdin, type Ask, type Availability, type Completion, type Driver } from "../driver.ts";
import { codexSchema, CODEX_WIRE_INSTRUCTION } from "./codex-schema.ts";

/** Codex's own configured default: an empty model here means "do not pass --model". */
export const CODEX_DEFAULT_MODEL = "";

export function codexArgs(schemaFile: string, outFile: string, model: string, effort?: string): string[] {
  return [
    "exec",
    "--sandbox", "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    // A named model needs auth, not the operator's unrelated MCPs, hooks or settings.
    // Without one, preserve Codex's configured model/provider as before.
    ...(model ? ["--ignore-user-config"] : []),
    ...["shell_tool", "apps", "hooks", "multi_agent", "remote_plugin"].flatMap(feature => ["--disable", feature]),
    "--config", 'web_search="disabled"',
    "--output-schema", schemaFile,
    "--output-last-message", outFile,
    ...(model ? ["--model", model] : []),
    /* The person's codex may be configured at xhigh, which is minutes per answer; a question says how hard it is. */
    ...(effort ? ["--config", `model_reasoning_effort="${effort}"`] : []),
    "-",
  ];
}

/** Prefer the backend's cause over a later MCP shutdown warning. Never log the prompt. */
export function codexFailureText(stderr: string, stdout: string): string {
  const text = stderr || stdout;
  const messages = [...text.matchAll(/"message"\s*:\s*("(?:[^"\\]|\\.)*")/g)];
  const structured = messages.map(match => { try { return JSON.parse(match[1]) as string; } catch { return ""; } }).filter(Boolean);
  const lines = text.trim().split("\n");
  const reason = structured.at(-1) ?? [...lines].reverse().find(line => /^ERROR:|^error:/i.test(line)) ?? lines.at(-1) ?? "no diagnostic returned";
  return redact(reason).text.replace(/\s+/g, " ").slice(0, 1200);
}

export const codex: Driver = {
  name: "codex",
  async available(env = process.env): Promise<Availability> {
    const version = await onPath("codex");
    if (!version) return { ok: false, why: "the codex CLI is not on PATH" };
    return { ok: true, model: env.PANOMA_VIDEO_BRAIN_MODEL?.trim() || CODEX_DEFAULT_MODEL, how: `codex exec (${version})` };
  },
  async complete(ask: Ask): Promise<Completion> {
    const dir = await mkdtemp(join(ask.scratchDir, "codex-"));
    try {
      const schemaFile = join(dir, "schema.json");
      const outFile = join(dir, "answer.json");
      const wire = codexSchema(ask.schema);
      await writeFile(schemaFile, JSON.stringify(wire.schema));
      const { stderr, stdout, code } = await spawnWithStdin("codex", codexArgs(schemaFile, outFile, ask.model, ask.effort), `${ask.system}\n\n${CODEX_WIRE_INSTRUCTION}\n\n${ask.user}`, {
        timeoutMs: ask.timeoutMs,
        cwd: dir,
        signal: ask.signal,
      });
      const last = await readFile(outFile, "utf8").catch(() => "");
      if (!last.trim()) throw new Error(`codex exited ${code} without an answer: ${codexFailureText(stderr, stdout)}`);
      /* Codex prints its configuration to stderr before the transcript; the model line is the one worth keeping. */
      const model = /^model:\s*(\S+)/m.exec(stderr)?.[1] ?? (ask.model || "codex");
      const tokens = /tokens used\s*\n?\s*([\d,]+)/i.exec(stderr + stdout)?.[1];
      return { json: wire.decode(parseJsonLoosely(last)), model, usage: tokens ? { output: Number(tokens.replace(/,/g, "")) } : undefined };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};
