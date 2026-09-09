/*
  What each platform will accept, as a dated table. These numbers move — X changed its
  limit with a subscription tier, Shorts went from 60 s to 180 s — so every row carries
  the page it was read from and the day it was read, and a reader who finds the table
  stale knows exactly what to re-check.

  Two kinds of limit live here and they are judged differently: a hard limit the
  platform enforces (duration, file size) fails; a recommendation the platform will
  transcode around (profile, colour tags, faststart) warns. Neither is a substitute
  for the visual checks — a file can be perfectly conformant and black.

  Bitrate is the exception among the recommendations: it is noted and never warned.
  The platform tables assume a rate-targeted encode of live footage, and a CRF encode
  of a piece that is mostly flat cards spends a fraction of that for the same quality
  — a 16 s render measured 4.0 Mbps at crf 17 against YouTube's 8 Mbps row and looked
  perfect. Only a floor the platform itself enforces (TikTok's 2.5 Mbps) warns.
*/
import type { ReviewCheck } from "./types.ts";
import { NO_FIX, reportFix } from "./types.ts";
import type { Probe } from "./probe.ts";

export type Target = "youtube" | "shorts" | "tiktok" | "reels" | "x" | "linkedin";

export type Conformance = {
  /** Hard limits; fail when exceeded. */
  maxSeconds?: number;
  minSeconds?: number;
  maxBytes?: number;
  /** A soft limit: over it the platform still takes the file but treats it differently. */
  warnSeconds?: number;
  /** Bits per second the platform will not take less of (a hard floor); warn below. */
  minBitrate?: (probe: Probe) => number | undefined;
  /** Bits per second the platform recommends, by the short side of the frame; noted below, never judged. */
  recommendedBitrate?: (probe: Probe) => number | undefined;
  codec: string;
  profile: string;
  pixFmt: string;
  audio: { codec: string; sampleRate: number; minBitrate: number; recommendedBitrate?: number };
  recommendedFps?: number;
  source: string;
  verified: string;
};

const MB = 1024 * 1024;

/** YouTube's recommended SDR bitrates by resolution class and frame rate (Mbps). */
export function youtubeBitrate(probe: Probe): number | undefined {
  const v = probe.video;
  if (!v) return undefined;
  const p = Math.min(v.width, v.height);
  const high = v.fps >= 48;
  const table: [number, number, number][] = [
    /* short side, ≤30 fps, 48-60 fps — https://support.google.com/youtube/answer/1722171 */
    [2160, 40, 60],
    [1440, 16, 24],
    [1080, 8, 12],
    [720, 5, 7.5],
    [480, 2.5, 4],
    [360, 1, 1.5],
  ];
  for (const [side, low, fast] of table) if (p >= side) return (high ? fast : low) * 1_000_000;
  return undefined;
}

const H264 = { codec: "h264", profile: "High", pixFmt: "yuv420p" };
const AAC = { codec: "aac", sampleRate: 48000, minBitrate: 128_000 };

export const CONFORMANCE: Record<Target, Conformance> = {
  youtube: {
    ...H264,
    recommendedBitrate: youtubeBitrate,
    audio: { ...AAC, recommendedBitrate: 384_000 },
    source: "https://support.google.com/youtube/answer/1722171",
    verified: "2026-09-01",
  },
  shorts: {
    ...H264,
    maxSeconds: 180,
    recommendedBitrate: youtubeBitrate,
    audio: AAC,
    source: "https://support.google.com/youtube/answer/10059070",
    verified: "2026-09-01",
  },
  tiktok: {
    ...H264,
    maxSeconds: 600,
    maxBytes: 500 * MB,
    minBitrate: () => 2_500_000,
    audio: AAC,
    source: "https://ads.tiktok.com/help/article/video-ads-specifications",
    verified: "2026-09-01",
  },
  reels: {
    ...H264,
    /* Instagram Help: Reels over 3 minutes are not recommended to new audiences;
       the ad spec caps at 15 minutes, organic at 20. */
    warnSeconds: 180,
    maxSeconds: 900,
    maxBytes: 4096 * MB,
    audio: AAC,
    source: "https://www.facebook.com/business/ads-guide/update/video/instagram-reels",
    verified: "2026-09-01",
  },
  x: {
    ...H264,
    /* Non-Premium limits; a Premium account allows far more. */
    maxSeconds: 140,
    maxBytes: 512 * MB,
    audio: AAC,
    source: "https://help.x.com/en/using-x/x-videos",
    verified: "2026-09-01",
  },
  linkedin: {
    ...H264,
    minSeconds: 3,
    maxSeconds: 1800,
    maxBytes: 500 * MB,
    audio: AAC,
    recommendedFps: 30,
    source: "https://business.linkedin.com/advertise/ads/sponsored-content/video-ads/specs",
    verified: "2026-09-01",
  },
};

export const TARGETS = Object.keys(CONFORMANCE) as Target[];

const mbps = (bps: number) => `${(bps / 1_000_000).toFixed(1)} Mbps`;
const kbps = (bps: number) => `${Math.round(bps / 1000)} kbps`;
const secs = (s: number) => (s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);

/** The checks one target's row produces for one probed file. */
export function conformTo(probe: Probe, target: string): ReviewCheck[] {
  const row = (CONFORMANCE as Record<string, Conformance>)[target];
  const id = (what: string) => `platform.${target}.${what}`;
  if (!row) {
    return [{ id: id("table"), status: "skip", summary: `no conformance table for target "${target}"; known targets: ${TARGETS.join(", ")}`, fix: NO_FIX }];
  }
  const src = `${row.source} (read ${row.verified})`;
  const checks: ReviewCheck[] = [];
  const v = probe.video;

  const tooLong = row.maxSeconds !== undefined && probe.seconds > row.maxSeconds;
  const tooShort = row.minSeconds !== undefined && probe.seconds < row.minSeconds;
  const soft = !tooLong && row.warnSeconds !== undefined && probe.seconds > row.warnSeconds;
  checks.push({
    id: id("duration"),
    status: tooLong || tooShort ? "fail" : soft ? "warn" : "pass",
    summary: tooLong
      ? `${probe.seconds.toFixed(1)} s is over ${target}'s ${secs(row.maxSeconds!)} limit; cut it or choose another target`
      : tooShort
        ? `${probe.seconds.toFixed(1)} s is under ${target}'s ${secs(row.minSeconds!)} minimum`
        : soft
          ? `${probe.seconds.toFixed(1)} s is over ${secs(row.warnSeconds!)}; ${target} takes it but stops recommending it to new audiences`
          : `${probe.seconds.toFixed(1)} s fits ${target}`,
    threshold: [row.minSeconds !== undefined ? `≥ ${secs(row.minSeconds)}` : "", row.maxSeconds !== undefined ? `≤ ${secs(row.maxSeconds)}` : "", row.warnSeconds !== undefined ? `warn > ${secs(row.warnSeconds)}` : ""].filter(Boolean).join(", ") || "no limit",
    source: src,
    fix: tooLong
      ? { by: "plan", hint: `shorten the piece to ${secs(row.maxSeconds!)} or under: fewer lines, or a shorter hook`, args: { seconds: probe.seconds, maxSeconds: row.maxSeconds } }
      : tooShort
        ? { by: "plan", hint: `lengthen the piece to ${secs(row.minSeconds!)} or over: another line`, args: { seconds: probe.seconds, minSeconds: row.minSeconds } }
        : soft
          ? { by: "plan", hint: `shorten the piece to ${secs(row.warnSeconds!)} or under, or accept that ${target} stops recommending it to new audiences`, args: { seconds: probe.seconds, warnSeconds: row.warnSeconds } }
          : NO_FIX,
  });

  if (row.maxBytes !== undefined) {
    const over = probe.bytes > row.maxBytes;
    checks.push({
      id: id("size"),
      status: over ? "fail" : "pass",
      summary: over ? `${(probe.bytes / MB).toFixed(0)} MB is over ${target}'s ${Math.round(row.maxBytes / MB)} MB limit; lower the bitrate` : `${(probe.bytes / MB).toFixed(1)} MB fits ${target}`,
      threshold: `≤ ${Math.round(row.maxBytes / MB)} MB`,
      source: src,
      fix: over ? reportFix(id("size"), `the file is over ${target}'s ${Math.round(row.maxBytes / MB)} MB limit at this length and bitrate`, { bytes: probe.bytes, maxBytes: row.maxBytes }) : NO_FIX,
    });
  }

  const floor = row.minBitrate?.(probe);
  const recommended = row.recommendedBitrate?.(probe);
  if ((floor !== undefined || recommended !== undefined) && v) {
    const frame = `${Math.min(v.width, v.height)}p${v.fps}`;
    const low = floor !== undefined && probe.bitrate < floor;
    const under = !low && recommended !== undefined && probe.bitrate < recommended;
    checks.push({
      id: id("bitrate"),
      status: low ? "warn" : "pass",
      summary: low
        ? `${mbps(probe.bitrate)} is under the ${mbps(floor)} ${target} accepts at ${frame}; text edges will soften in the re-encode`
        : under
          ? `${mbps(probe.bitrate)} is under the ${mbps(recommended)} ${target} recommends at ${frame}; a CRF encode of flat cards needs fewer bits than the table assumes, so this is noted, not judged`
          : recommended !== undefined
            ? `${mbps(probe.bitrate)} meets the ${mbps(recommended)} ${target} recommends at ${frame}`
            : `${mbps(probe.bitrate)} is over the ${mbps(floor!)} ${target} floor`,
      threshold: floor !== undefined ? `≥ ${mbps(floor)}` : `${mbps(recommended!)} recommended, not required`,
      source: src,
      fix: low ? reportFix(id("bitrate"), `the encoder's rate sits under ${target}'s floor`, { bitrate: probe.bitrate, floor }) : NO_FIX,
    });
  }

  if (v) {
    const problems: string[] = [];
    if (v.codec !== row.codec) problems.push(`codec ${v.codec} (want ${row.codec})`);
    if (v.profile && v.profile !== row.profile) problems.push(`profile ${v.profile} (want ${row.profile})`);
    if (v.pixFmt && v.pixFmt !== row.pixFmt) problems.push(`pixel format ${v.pixFmt} (want ${row.pixFmt})`);
    if (v.fieldOrder && v.fieldOrder !== "progressive") problems.push(`interlaced (${v.fieldOrder})`);
    if (probe.faststart === false) problems.push("moov after mdat (no faststart)");
    const colour = [v.colour.primaries, v.colour.transfer, v.colour.space];
    if (colour.some((c) => c && c !== "bt709")) problems.push(`colour tags ${colour.map((c) => c ?? "untagged").join("/")} (want bt709)`);
    else if (colour.some((c) => !c)) problems.push(`colour tags ${colour.map((c) => c ?? "untagged").join("/")} — primaries/transfer/matrix must all say bt709 (players assume it; tag it explicitly)`);
    checks.push({
      id: id("encoding"),
      status: problems.length ? "warn" : "pass",
      summary: problems.length ? `${problems.join("; ")}; ${target} transcodes anyway, but the recommendation is ${row.codec} ${row.profile} ${row.pixFmt} progressive bt709 with faststart` : `${row.codec} ${row.profile} ${row.pixFmt} progressive, bt709, moov first`,
      threshold: `${row.codec} ${row.profile}, ${row.pixFmt}, progressive, bt709 tags, moov before mdat`,
      source: src,
      fix: problems.length ? reportFix(id("encoding"), `the encoder wrote ${problems.join("; ")}`, { problems }) : NO_FIX,
    });
    if (row.recommendedFps !== undefined) {
      const off = Math.abs(v.fps - row.recommendedFps) > 0.01;
      checks.push({
        id: id("fps"),
        status: "pass",
        summary: off ? `${v.fps} fps is accepted; ${target} recommends ${row.recommendedFps}` : `${v.fps} fps, the recommended rate`,
        threshold: `${row.recommendedFps} fps recommended, not required`,
        source: src,
        fix: NO_FIX,
      });
    }
  }

  if (probe.audio) {
    const a = probe.audio;
    const problems: string[] = [];
    if (a.codec !== row.audio.codec) problems.push(`codec ${a.codec} (want ${row.audio.codec})`);
    if (a.sampleRate !== row.audio.sampleRate) problems.push(`${a.sampleRate} Hz (want ${row.audio.sampleRate})`);
    if (a.bitrate !== undefined && a.bitrate < row.audio.minBitrate) problems.push(`${kbps(a.bitrate)} (want ≥ ${kbps(row.audio.minBitrate)})`);
    const note = row.audio.recommendedBitrate !== undefined && a.bitrate !== undefined && a.bitrate < row.audio.recommendedBitrate ? `; ${target} recommends ${kbps(row.audio.recommendedBitrate)} stereo` : "";
    checks.push({
      id: id("audio"),
      status: problems.length ? "warn" : "pass",
      summary: problems.length ? `${problems.join("; ")}${note}` : `${a.codec} ${a.sampleRate} Hz${a.bitrate !== undefined ? ` ${kbps(a.bitrate)}` : ""}, ${a.channels === 2 ? "stereo" : a.channels === 1 ? "mono" : `${a.channels} channels`}${note}`,
      threshold: `${row.audio.codec} ${row.audio.sampleRate} Hz ≥ ${kbps(row.audio.minBitrate)}`,
      source: src,
      fix: problems.length ? reportFix(id("audio"), `the master wrote ${problems.join("; ")}`, { problems }) : NO_FIX,
    });
  }
  return checks;
}

/** Every target's checks, in the order the targets were given. */
export function conformance(probe: Probe, targets: readonly string[]): ReviewCheck[] {
  return targets.flatMap((t) => conformTo(probe, t));
}
