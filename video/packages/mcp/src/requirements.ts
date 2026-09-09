/* A read-only local probe shared by the host handshake and doctor. No provider calls. */
import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { z } from "zod";
import { FFMPEG, FFPROBE, encoders, h264, aac } from "@panoma/video-codec";
import { videoHome } from "@panoma/video-director";
const run = promisify(execFile);
export const APP_PROTOCOL = "1";
/** The figure the manifest discloses before the download; `manifest.test.ts` holds them together. */
export const BROWSER_APPROX_MB = 550;
export const RequirementsSchema = z.object({
  browser: z.object({ present: z.boolean(), path: z.string().optional(), version: z.string().optional(), name: z.literal("chromium"), approxMB: z.literal(BROWSER_APPROX_MB) }),
  ffmpeg: z.object({ present: z.boolean(), version: z.string().optional(), encoders: z.object({ h264: z.string(), aac: z.string() }) }),
  home: z.string(),
});
export type Requirements = z.infer<typeof RequirementsSchema>;

/*
  How hard to look. `deep` starts the browser, which is the only way to tell a Chromium that is
  merely on disk from one whose system libraries are there too; it also costs a second or more,
  and a first start on a cold machine or behind an antivirus costs several.

  The host asks `quick` for the handshake it makes before every job, and `deep` when a person
  presses "check requirements" or a browser has just been downloaded. `doctor` is always deep.
  Either answer is cached for a minute, so two probes in one session are one launch.
 */
export type ProbeDepth = "quick" | "deep";
export const PROBE_CACHE_MS = 60_000;
let cached: { at: number; depth: ProbeDepth; value: Requirements } | undefined;

export async function probeRequirements(depth: ProbeDepth = "deep"): Promise<Requirements> {
  // A deep answer also answers a quick question; the reverse is not true.
  const usable = cached && Date.now() - cached.at < PROBE_CACHE_MS
    && (cached.depth === depth || cached.depth === "deep");
  if (usable && cached) return cached.value;
  const value = await probe(depth);
  cached = { at: Date.now(), depth, value };
  return value;
}

/** Forget what was measured. A test that asks the cheap question must not read a deep answer. */
export function resetRequirementsProbe(): void { cached = undefined; }

async function probe(depth: ProbeDepth): Promise<Requirements> {
  const path = chromium.executablePath();
  const pathPresent = await access(path).then(() => true, () => false);
  let browserPresent = pathPresent && depth === "quick";
  let browserVersion: string | undefined;
  if (depth === "deep") {
    try {
      const browser = await chromium.launch({ timeout: 5000 });
      try { browserVersion = browser.version(); browserPresent = true; }
      finally { await browser.close(); }
    } catch { /* Missing binaries and missing system libraries are both unready. */ }
  }
  const versions = await Promise.all([FFMPEG, FFPROBE].map(async command => {
    try { return (await run(command, ["-version"], { timeout: 5000, maxBuffer: 256_000 })).stdout.match(/version\s+(\d+(?:\.\d+)*)/)?.[1]; }
    catch { return undefined; }
  }));
  const selected = { h264: h264(5_000_000).name, aac: aac(192_000).name };
  const available = encoders();
  return { browser: { present: browserPresent, ...(pathPresent ? { path } : {}), ...(browserVersion ? { version: browserVersion } : {}), name: "chromium", approxMB: BROWSER_APPROX_MB },
    ffmpeg: { present: versions.every(version => version !== undefined && Number(version.split(".")[0]) >= 6) && available.has(selected.h264) && available.has(selected.aac), ...(versions[0] ? { version: versions[0] } : {}), encoders: selected }, home: videoHome() };
}
