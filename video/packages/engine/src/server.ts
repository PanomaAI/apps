/*
  The asset server: a few dozen lines of node:http instead of a framework. It serves
  the shell, the vendored fonts, the composition's assets, recorded sessions (with
  HTTP Range, or Chromium refuses to seek the video), and whatever routes a caller
  mounts through `extra` (the studio). It binds 127.0.0.1 on an ephemeral port;
  nothing is ever exposed.
*/
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, normalize, relative, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { shellHtml } from "./document.ts";

const FONTS_DIR = fileURLToPath(new URL("../assets/fonts/", import.meta.url));

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".json": "application/json",
};

function contentType(path: string): string {
  const dot = path.lastIndexOf(".");
  return TYPES[path.slice(dot)] ?? "application/octet-stream";
}

/**
 * One satisfiable byte range, or null. Video seeking depends on this: Chromium asks
 * for ranges and treats a server that answers 200-with-everything as unseekable.
 */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    /* suffix form: last N bytes */
    const n = Number(m[2]);
    if (n === 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return null;
  return { start, end };
}

/** Serve `root/<rest>` below `prefix`, refusing any path that escapes the root. */
async function serveFile(root: string, rest: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  /*
    A string prefix is not a path boundary, and this is the guard whose whole job is the
    boundary. `join` collapses `..` before the comparison, so a `rest` of
    `../assets-old/secret` under a root of `/x/assets` normalizes to `/x/assets-old/secret`
    — which starts with `/x/assets` and was served. Any sibling directory whose name merely
    extends the root's got in, on every platform.

    `relative` answers the question that was being asked: an empty string is the root
    itself, and anything that has to climb out says so with `..`.
  */
  const path = normalize(join(root, rest));
  const step = relative(normalize(root), path);
  if (step === ".." || step.startsWith(`..${sep}`) || isAbsolute(step)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const info = await stat(path);
    const range = parseRange(req.headers.range, info.size);
    if (range) {
      res.writeHead(206, {
        "Content-Type": contentType(path),
        "Content-Range": `bytes ${range.start}-${range.end}/${info.size}`,
        "Content-Length": range.end - range.start + 1,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      });
      createReadStream(path, { start: range.start, end: range.end }).pipe(res);
      return;
    }
    const bytes = await readFile(path);
    res.writeHead(200, {
      "Content-Type": contentType(path),
      "Content-Length": info.size,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    }).end(bytes);
  } catch {
    res.writeHead(404).end();
  }
}

export type AssetServer = { port: number; origin: string; close: () => Promise<void>; server: Server };

export type AssetMounts = { assets: string; sessions?: string };

export async function startAssetServer(
  mounts: AssetMounts,
  extra?: (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean>,
): Promise<AssetServer> {
  const server = createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch {
      /* One malformed request (bad percent-encoding, a throwing extra route) must
         not become an unhandled rejection that kills a render. */
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/__shell__") {
      const w = Number(url.searchParams.get("w") ?? 1080);
      const h = Number(url.searchParams.get("h") ?? 1920);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(shellHtml(w, h));
      return;
    }
    if (url.pathname.startsWith("/__fonts__/")) {
      await serveFile(FONTS_DIR, url.pathname.slice("/__fonts__/".length), req, res);
      return;
    }
    if (url.pathname.startsWith("/assets/")) {
      await serveFile(mounts.assets, decodeURIComponent(url.pathname.slice("/assets/".length)), req, res);
      return;
    }
    if (mounts.sessions && url.pathname.startsWith("/sessions/")) {
      await serveFile(mounts.sessions, decodeURIComponent(url.pathname.slice("/sessions/".length)), req, res);
      return;
    }
    if (extra && (await extra(req, res, url))) return;
    res.writeHead(404).end();
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("asset server failed to bind");
  return {
    port: address.port,
    origin: `http://127.0.0.1:${address.port}`,
    server,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
