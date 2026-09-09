/*
  The OpenAI API as a brain, with no SDK: chat completions with a JSON Schema response
  format. Not strict mode — strict requires every property required and nullable, and
  the questions have optional fields — so the shape is validated again above, in
  brain.ts, where every driver's answer is. Untested against a live key in the session
  that wrote it; the request is what the documentation specifies, and a test checks it.
*/
import { modelFor, parseJsonLoosely, type Ask, type Availability, type Completion, type Driver } from "../driver.ts";

/** Configuration, not a constant of the design: PANOMA_VIDEO_BRAIN_MODEL overrides it. */
export const OPENAI_DEFAULT_MODEL = "gpt-5.4";
export const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export function openaiRequest(ask: Ask, key: string): { url: string; init: RequestInit } {
  return {
    url: OPENAI_URL,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: ask.model,
        messages: [
          { role: "system", content: ask.system },
          { role: "user", content: ask.user },
        ],
        response_format: { type: "json_schema", json_schema: { name: "answer", schema: ask.schema } },
      }),
    },
  };
}

export const openai: Driver = {
  name: "openai",
  async available(env = process.env): Promise<Availability> {
    if (!env.OPENAI_API_KEY) return { ok: false, why: "OPENAI_API_KEY is not set" };
    return { ok: true, model: modelFor(env, OPENAI_DEFAULT_MODEL), how: "the OpenAI API" };
  },
  async complete(ask: Ask): Promise<Completion> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not set");
    const { url, init } = openaiRequest(ask, key);
    const signal = ask.signal ? AbortSignal.any([ask.signal, AbortSignal.timeout(ask.timeoutMs)]) : AbortSignal.timeout(ask.timeoutMs);
    const response = await fetch(url, { ...init, signal });
    if (!response.ok) throw new Error(`the OpenAI API answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const body = (await response.json()) as { model?: string; choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const text = body.choices?.[0]?.message?.content;
    if (!text) throw new Error("the OpenAI API returned no message content");
    return { json: parseJsonLoosely(text), model: body.model ?? ask.model, usage: { input: body.usage?.prompt_tokens, output: body.usage?.completion_tokens } };
  },
};
