/*
  The Anthropic API as a brain, with no SDK: one POST, the answer forced through a
  tool whose input schema is the shape asked for, so the model cannot answer in prose.
  A key in the environment is consent to spend; the cap in brain.ts is what bounds it.
*/
import { modelFor, type Ask, type Availability, type Completion, type Driver } from "../driver.ts";

/** Configuration, not a constant of the design: PANOMA_VIDEO_BRAIN_MODEL overrides it. */
export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-5";
export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export function anthropicRequest(ask: Ask, key: string): { url: string; init: RequestInit } {
  return {
    url: ANTHROPIC_URL,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: ask.model,
        max_tokens: 4096,
        system: ask.system,
        messages: [{ role: "user", content: ask.user }],
        tools: [{ name: "answer", description: "The answer, in exactly the shape asked for.", input_schema: ask.schema }],
        tool_choice: { type: "tool", name: "answer" },
      }),
    },
  };
}

export const anthropic: Driver = {
  name: "anthropic",
  async available(env = process.env): Promise<Availability> {
    if (!env.ANTHROPIC_API_KEY) return { ok: false, why: "ANTHROPIC_API_KEY is not set" };
    return { ok: true, model: modelFor(env, ANTHROPIC_DEFAULT_MODEL), how: "the Anthropic API" };
  },
  async complete(ask: Ask): Promise<Completion> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    const { url, init } = anthropicRequest(ask, key);
    const signal = ask.signal ? AbortSignal.any([ask.signal, AbortSignal.timeout(ask.timeoutMs)]) : AbortSignal.timeout(ask.timeoutMs);
    const response = await fetch(url, { ...init, signal });
    if (!response.ok) throw new Error(`the Anthropic API answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const body = (await response.json()) as { model?: string; content?: { type: string; input?: unknown }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    const tool = body.content?.find((c) => c.type === "tool_use");
    if (!tool) throw new Error("the Anthropic API returned no tool_use block");
    return { json: tool.input, model: body.model ?? ask.model, usage: { input: body.usage?.input_tokens, output: body.usage?.output_tokens } };
  },
};
