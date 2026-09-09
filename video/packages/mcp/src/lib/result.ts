/*
  What a tool hands back, shaped for the reader it has: a model.

  Three rules, each paid for by someone else's issue tracker. A result carries a short
  text summary first, because that is what the model reads in the transcript, and the
  same facts again as `structuredContent` for a client that validates against the
  schema. Images travel ONLY as content blocks — Claude Code serialises anything in
  `structuredContent` as text and truncates it at the token cap, so a base64 contact
  sheet copied there arrives twice and legible zero times (anthropics/claude-code
  #70280). And every image is small: a JPEG no wider than 1280 px and under 80 KB,
  because images count against the 25,000-token result cap and there is no escape
  hatch for them (code.claude.com/docs/en/mcp). Files are never inlined; they go
  back as absolute paths and `resource_link` blocks.
*/
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

export const IMAGE_MAX_BYTES = 80 * 1024;
export const IMAGE_MAX_WIDTH = 1280;

type TextBlock = { type: "text"; text: string };
type ImageBlock = { type: "image"; data: string; mimeType: string };
type LinkBlock = { type: "resource_link"; uri: string; name: string; mimeType?: string; description?: string };
export type Block = TextBlock | ImageBlock | LinkBlock;

export type ToolResult = {
  content: Block[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".json": "application/json",
  ".md": "text/markdown",
  ".srt": "application/x-subrip",
  ".vtt": "text/vtt",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

/** A file the model may open or hand on, without its bytes. */
export function link(path: string, description?: string): LinkBlock {
  const dot = path.lastIndexOf(".");
  return {
    type: "resource_link",
    uri: pathToFileURL(path).href,
    name: basename(path),
    ...(dot >= 0 && MIME[path.slice(dot)] ? { mimeType: MIME[path.slice(dot)] } : {}),
    ...(description ? { description } : {}),
  };
}

/**
 * A JPEG from disk as an image block, refusing anything over the budget.
 *
 * Refusing rather than shrinking on the fly is deliberate: the producer (a contact
 * sheet, a frame) owns the quality knob and is tested to land under the cap; a
 * silent resize here would hide a regression there.
 */
export async function image(path: string): Promise<ImageBlock> {
  const bytes = await readFile(path);
  if (bytes.length > IMAGE_MAX_BYTES) {
    throw new Error(`${basename(path)} is ${bytes.length} bytes; images sent to a model must stay under ${IMAGE_MAX_BYTES}.`);
  }
  const mimeType = path.endsWith(".png") ? "image/png" : "image/jpeg";
  return { type: "image", data: bytes.toString("base64"), mimeType };
}

/** A successful result: summary text, the structured mirror, and whatever blocks follow. */
export function ok(summary: string, structured: Record<string, unknown>, blocks: Block[] = []): ToolResult {
  assertNoBase64(structured);
  return {
    content: [{ type: "text", text: summary }, ...blocks],
    structuredContent: structured,
  };
}

/**
 * A failure the model can act on. The message is the whole interface: it names what
 * was wrong and what to call next, in one or two sentences, never a stack trace.
 */
export function fail(message: string, structured: Record<string, unknown> = {}): ToolResult {
  /*
    No structuredContent on a failure: a tool with an outputSchema has its structured
    content validated against it, and an error shape would be rejected on the way out —
    the agent would then see a validation error instead of the sentence that tells it
    what to do. Whatever detail matters travels in the text.
  */
  const detail = Object.keys(structured).length > 0 ? `\n${JSON.stringify(structured, null, 1)}` : "";
  return {
    content: [{ type: "text", text: `${message}${detail}` }],
    isError: true,
  };
}

/** Guard: a base64 blob has no business in structuredContent (see the header). */
export function assertNoBase64(value: unknown, path = "structuredContent"): void {
  if (typeof value === "string") {
    if (value.length > 4096 && /^[A-Za-z0-9+/=\s]+$/.test(value.slice(0, 512))) {
      throw new Error(`${path} carries what looks like base64 (${value.length} chars). Images go in content blocks only.`);
    }
    return;
  }
  if (Array.isArray(value)) value.forEach((v, i) => assertNoBase64(v, `${path}[${i}]`));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) assertNoBase64(v, `${path}.${k}`);
  }
}

/** Trim a long text for the concise form of a result: whole lines, with a note of what was cut. */
export function concise(text: string, maxChars = 2400): string {
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf("\n", maxChars);
  const kept = text.slice(0, cut > maxChars / 2 ? cut : maxChars);
  return `${kept}\n… (${text.length - kept.length} more characters; ask with detail: "detailed")`;
}
