/*
  A served instance is evidence of its own, not of the checkout beside it.

  Read the entry document and a bounded sample of its linked code/style bytes on
  every camera run. Only hashes leave memory. A finite capture age covers live
  data, lazy chunks and routes this small probe cannot observe; it is deliberately
  not a claim that one HTML response describes an entire application.
*/
import { createHash, randomUUID } from "node:crypto";

export const CAPTURE_SOURCE_VERSION = 1;
export const CAPTURE_SOURCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_ASSETS = 12;
const MAX_BYTES = 12 * 1024 * 1024;
const DOCUMENT_BYTES = 2 * 1024 * 1024;
const ASSET_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export type CaptureSource = {
  version: number;
  /** No URL, response body, cookie or request header is persisted. */
  urlHash: string;
  key: string;
  fingerprint?: string;
  capturedAt: string;
  checkedAt: string;
  state: "unchanged" | "initial" | "changed" | "expired" | "forced" | "unverified";
  resources: number;
  reason: string;
};

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const credentialQuery = /(?:^|[_-])(?:token|secret|password|passwd|pwd|key|signature|credential|authorization)(?:$|[_-])/i;

function publicUrl(raw: string, base?: string): URL {
  const url = new URL(raw, base);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || [...url.searchParams.keys()].some(key => credentialQuery.test(key))) {
    throw new Error("the source address requires credentials or is not HTTP");
  }
  url.hash = "";
  return url;
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return (match?.[1] ?? match?.[2] ?? match?.[3])?.replace(/&amp;/gi, "&").replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}

function assetsOf(html: string, finalUrl: string): string[] {
  const baseTag = html.match(/<base\b[^>]*>/i)?.[0];
  const base = baseTag ? new URL(attribute(baseTag, "href") ?? finalUrl, finalUrl).href : finalUrl;
  const assets: string[] = [];
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) ?? []) {
    const script = /^<script\b/i.test(tag);
    if (!script && !/\b(?:stylesheet|modulepreload)\b/i.test(attribute(tag, "rel") ?? "")) continue;
    const ref = attribute(tag, script ? "src" : "href");
    if (!ref) continue;
    try { assets.push(new URL(ref, base).href); } catch { /* An invalid reference cannot supply bytes. */ }
  }
  return [...new Set(assets)].sort();
}

/** Read-only probe. Save its result only after both takes have completed. */
export async function probeCaptureSource(raw: string, options: {
  previous?: CaptureSource | null;
  now?: number;
  force?: boolean;
  signal?: AbortSignal;
} = {}): Promise<CaptureSource> {
  options.signal?.throwIfAborted();
  const now = options.now ?? Date.now();
  const checkedAt = new Date(now).toISOString();
  const urlHash = digest(raw);
  const previous = options.previous;
  let resources = 0;
  const fallback = (reason: string): CaptureSource => ({ version: CAPTURE_SOURCE_VERSION, urlHash,
    key: randomUUID(), capturedAt: checkedAt, checkedAt, state: "unverified", resources,
    reason: `${reason}; the source cannot vouch for cached footage` });
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let bytes = 0;
  const read = async (start: URL, limit: number, origin?: string): Promise<{ url: string; body: Buffer }> => {
    let url = start;
    for (let redirect = 0; redirect <= 3; redirect++) {
      const response = await fetch(url, { signal, redirect: "manual", credentials: "omit", cache: "no-store",
        headers: { "Cache-Control": "no-cache", "Accept": "text/html,text/css,application/javascript,*/*;q=0.1" } });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location || redirect === 3) throw new Error("the source redirect did not resolve");
        url = publicUrl(location, url.href);
        if (origin && url.origin !== origin) throw new Error("a linked asset redirected outside its origin");
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`source probe returned HTTP ${response.status}`); }
      if (!response.body) throw new Error("source probe returned no body");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          bytes += value.byteLength;
          if (size > limit || bytes > MAX_BYTES) throw new Error("source probe exceeded its byte budget");
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => undefined); }
      resources++;
      return { url: url.href, body: Buffer.concat(chunks) };
    }
    throw new Error("the source redirect did not resolve");
  };
  try {
    const entry = await read(publicUrl(raw), DOCUMENT_BYTES);
    const html = entry.body.toString("utf8");
    if (!/<(?:!doctype\s+html|html|head|body|main|div|h1)\b/i.test(html)) throw new Error("source probe did not receive an HTML document");
    const assets = assetsOf(html, entry.url);
    const origin = new URL(entry.url).origin;
    const sampled = assets.filter(ref => { try { return publicUrl(ref).origin === origin; } catch { return false; } }).slice(0, MAX_ASSETS);
    const parts: unknown[] = [CAPTURE_SOURCE_VERSION, entry.url,
      // A fresh CSP nonce changes no product pixels or application code.
      digest(html.replace(/\snonce\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, " nonce=\"<nonce>\"")), assets];
    for (const ref of sampled) {
      const asset = await read(publicUrl(ref), ASSET_BYTES, origin);
      parts.push([ref, asset.url, digest(asset.body)]);
    }
    const fingerprint = digest(JSON.stringify(parts));
    const age = previous ? now - Date.parse(previous.capturedAt) : NaN;
    const valid = previous?.version === CAPTURE_SOURCE_VERSION && previous.urlHash === urlHash
      && typeof previous.key === "string" && previous.key.length > 0 && /^[a-f0-9]{64}$/.test(previous.fingerprint ?? "")
      && Number.isFinite(age) && age >= 0;
    const state: CaptureSource["state"] = options.force ? "forced" : !valid ? "initial"
      : previous.fingerprint !== fingerprint ? "changed" : age >= CAPTURE_SOURCE_MAX_AGE_MS ? "expired" : "unchanged";
    const reason = state === "unchanged" ? "entry document and sampled assets unchanged; capture is under 24 hours old"
      : state === "changed" ? "served document or linked asset bytes changed; refreshing the tour and both takes"
      : state === "expired" ? "capture reached its 24-hour limit for client data and unsampled routes; refreshing the tour and both takes"
      : state === "forced" ? "a fresh capture was explicitly requested"
      : "no verified capture of this served instance; recording source evidence with both takes";
    return { version: CAPTURE_SOURCE_VERSION, urlHash, key: state === "unchanged" ? previous!.key : randomUUID(),
      fingerprint, capturedAt: state === "unchanged" ? previous!.capturedAt : checkedAt, checkedAt, state, resources, reason };
  } catch (error) {
    options.signal?.throwIfAborted();
    const message = error instanceof Error && /^(?:the source|a linked asset|source probe)/.test(error.message)
      ? error.message : timeout.aborted ? "source probe timed out" : "source probe could not complete";
    return fallback(message);
  }
}
