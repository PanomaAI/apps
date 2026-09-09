/*
  The sound, measured on the final encoded track — never on the wav the master step
  wrote, because the AAC encode is what the platform receives and inter-sample overs
  are born in it. One ffmpeg pass carries three filters:

  - ebur128 (ITU-R BS.1770 loudness; `peak=true` adds true peak, `metadata=1` stamps
    the 100 ms short-term loudness on every frame so the maximum is a max(), not a
    parse of a verbose log);
  - silencedetect: a gap in the middle is a missing line or a voice file that did
    not arrive; leading silence is a dead half-second before the hook;
  - astats: peak level and flat factor, the two numbers that say "clipped".

  Where the limits come from:
  - True peak ≤ -1.0 dBTP: AES TD1004.1.15-10 (streaming) and EBU R 128, both to
    survive the platform's lossy re-encode. https://www.aes.org/technical/documents/AESTD1004_1_15_10.pdf
  - Max short-term ≤ integrated + 5 LU for short-form ≤ 60 s: AES TD1004 (EBU R 128 s1
    says the same for adverts as an absolute -18 LUFS).
  - Integrated -12..-18 LUFS: NOT a published number. No social platform documents a
    target; -14 is inferred from YouTube's "stats for nerds" and the band is what
    normalisation is observed to leave alone (https://apu.software/youtube-audio-loudness-target/).
    That is why it warns and says "observed, not published". AES's own range is -16..-20.
*/
import type { ReviewCheck } from "./types.ts";
import { NO_FIX, reportFix } from "./types.ts";
import type { Probe } from "./probe.ts";
import { ffmpegFrames } from "./exec.ts";

export type AudioOptions = {
  /** The cut is meant to have no sound: a missing track is a skip, not a warning. */
  expectSilent?: boolean;
};

export type AudioAnalysis = {
  checks: ReviewCheck[];
  lufs?: number;
  truePeak?: number;
  lra?: number;
  maxShortTerm?: number;
  silences: { from: number; to: number }[];
};

export const TRUE_PEAK_MAX_DBTP = -1.0;
export const SHORT_TERM_HEADROOM_LU = 5;
export const SHORT_FORM_SECONDS = 60;
export const INTEGRATED_BAND = { low: -18, high: -12 };
export const AES_BAND = { low: -20, high: -16 };
export const SILENCE_NOISE_DB = -50;
/* An internal gap this long is a missing line; the detector runs at the leading
   limit, the shorter of the two, and the internal rule filters by length afterwards. */
export const SILENCE_MIN_SECONDS = 1;
export const LEADING_SILENCE_MAX = 0.5;
/* A decoded float sample at or above full scale clips on every integer output and
   every re-encode; a flat top at -0.1 dBFS is a limiter or a clip that already happened. */
export const CLIP_PEAK_DBFS = 0;
export const FLAT_TOP_PEAK_DBFS = -0.1;
/* ebur128 reports -120.7 LUFS for digital silence and gates below -70 (BS.1770). */
const GATE_LUFS = -70;

const AES = "AES TD1004.1.15-10, https://www.aes.org/technical/documents/AESTD1004_1_15_10.pdf";
const OBSERVED = "observed, not published — https://apu.software/youtube-audio-loudness-target/";
const FFMPEG_DOCS = "https://ffmpeg.org/ffmpeg-filters.html";

const fmt = (s: number) => `${s.toFixed(2)} s`;
const num = (re: RegExp, text: string) => {
  const m = re.exec(text);
  return m ? Number(m[1]) : undefined;
};

function at(seconds: number[], fps: number) {
  return seconds.map((s) => ({ seconds: Number(s.toFixed(3)), frame: Math.round(s * fps) }));
}

/** Parse silencedetect's log lines into spans; a start with no end runs to `seconds`. */
export function parseSilences(stderr: string, seconds: number): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  let open: number | undefined;
  for (const line of stderr.split("\n")) {
    const start = num(/silence_start:\s*(-?[\d.]+)/, line);
    if (start !== undefined) open = start;
    const end = num(/silence_end:\s*(-?[\d.]+)/, line);
    if (end !== undefined && open !== undefined) {
      spans.push({ from: open, to: end });
      open = undefined;
    }
  }
  if (open !== undefined) spans.push({ from: open, to: seconds });
  return spans;
}

/** One decode, three filters, the checks; a file without an audio stream is skipped. */
export async function analyseAudio(probe: Probe, opts: AudioOptions = {}): Promise<AudioAnalysis> {
  const fps = probe.video?.fps ?? 25;
  if (!probe.audio) {
    return {
      checks: [
        {
          id: "audio.stream",
          status: "skip",
          summary: opts.expectSilent
            ? "no audio stream, as expected; nothing measured"
            : "no audio stream, so nothing was measured; if this cut should have sound, the mastering step dropped the track",
          fix: opts.expectSilent ? NO_FIX : reportFix("audio.stream", "the mastering step dropped the track"),
        },
      ],
      silences: [],
    };
  }

  let maxShortTerm = -Infinity;
  let truePeakLinear = 0;
  const graph =
    "ebur128=peak=true:metadata=1:framelog=quiet,ametadata=mode=print:file=-," +
    `silencedetect=n=${SILENCE_NOISE_DB}dB:d=${LEADING_SILENCE_MAX},` +
    "astats=measure_overall=Peak_level+Peak_count+Abs_Peak_count+Flat_factor:measure_perchannel=none";
  const stderr = await ffmpegFrames(["-loglevel", "info", "-i", probe.file, "-vn", "-sn", "-af", graph, "-f", "null", "-"], (f) => {
    const s = Number(f.tags["lavfi.r128.S"]);
    if (Number.isFinite(s) && s > GATE_LUFS && s > maxShortTerm) maxShortTerm = s;
    const tp = Number(f.tags["lavfi.r128.true_peak"]);
    if (Number.isFinite(tp) && tp > truePeakLinear) truePeakLinear = tp;
  });

  const lufs = num(/I:\s+(-?[\d.]+) LUFS/, stderr);
  const lra = num(/LRA:\s+(-?[\d.]+) LU/, stderr);
  /* With peak=true the summary's "Peak:" line is the true peak, printed as dBFS. */
  const truePeak = num(/Peak:\s+(-?[\d.]+) dBFS/, stderr) ?? (truePeakLinear > 0 ? 20 * Math.log10(truePeakLinear) : undefined);
  const peakDb = num(/Peak level dB:\s*(-?[\d.]+)/, stderr);
  const flat = num(/Flat factor:\s*(-?[\d.]+)/, stderr) ?? 0;
  const silences = parseSilences(stderr, probe.seconds);
  const checks: ReviewCheck[] = [];

  const silentTrack = lufs === undefined || lufs <= GATE_LUFS;
  if (silentTrack) {
    checks.push({
      id: "audio.silence",
      status: opts.expectSilent ? "skip" : "fail",
      summary: opts.expectSilent
        ? "the track is digital silence, as expected"
        : "the audio track is silent for its whole length; the voice or the bed never reached the mix",
      threshold: `integrated loudness above the ${GATE_LUFS} LUFS gate`,
      source: FFMPEG_DOCS,
      fix: opts.expectSilent ? NO_FIX : reportFix("audio.silence", "the voice or the bed never reached the mix"),
    });
    return { checks, lufs, truePeak, lra, silences };
  }

  const tpHot = truePeak !== undefined && truePeak > TRUE_PEAK_MAX_DBTP;
  checks.push({
    id: "audio.truepeak",
    status: tpHot ? "fail" : "pass",
    summary: tpHot
      ? `true peak ${truePeak.toFixed(1)} dBTP is above ${TRUE_PEAK_MAX_DBTP.toFixed(1)} dBTP and will clip in the platform's re-encode; lower the limiter ceiling`
      : `true peak ${truePeak?.toFixed(1) ?? "?"} dBTP`,
    threshold: `≤ ${TRUE_PEAK_MAX_DBTP.toFixed(1)} dBTP`,
    source: `${AES}; EBU R 128`,
    fix: tpHot ? reportFix("audio.truepeak", `the master's limiter let a true peak of ${truePeak.toFixed(1)} dBTP through`, { truePeak, max: TRUE_PEAK_MAX_DBTP }) : NO_FIX,
  });

  const outside = lufs < INTEGRATED_BAND.low || lufs > INTEGRATED_BAND.high;
  checks.push({
    id: "audio.integrated",
    status: outside ? "warn" : "pass",
    summary: outside
      ? `integrated ${lufs.toFixed(1)} LUFS sits outside the ${INTEGRATED_BAND.low}..${INTEGRATED_BAND.high} band social feeds are observed to leave alone (observed, not published; AES streaming range is ${AES_BAND.low}..${AES_BAND.high}); re-master toward -14`
      : `integrated ${lufs.toFixed(1)} LUFS, inside the observed ${INTEGRATED_BAND.low}..${INTEGRATED_BAND.high} band (observed, not published; AES streaming range is ${AES_BAND.low}..${AES_BAND.high})`,
    threshold: `${INTEGRATED_BAND.low}..${INTEGRATED_BAND.high} LUFS`,
    source: OBSERVED,
    fix: outside ? reportFix("audio.integrated", `the master landed at ${lufs.toFixed(1)} LUFS instead of -14`, { lufs, band: INTEGRATED_BAND }) : NO_FIX,
  });

  const st = Number.isFinite(maxShortTerm) ? maxShortTerm : undefined;
  const stHot = st !== undefined && st > lufs + SHORT_TERM_HEADROOM_LU;
  const shortForm = probe.seconds <= SHORT_FORM_SECONDS;
  checks.push({
    id: "audio.shortterm",
    status: stHot ? (shortForm ? "fail" : "warn") : "pass",
    summary: stHot
      ? `max short-term ${st.toFixed(1)} LUFS is ${(st - lufs).toFixed(1)} LU above the integrated ${lufs.toFixed(1)} LUFS${shortForm ? "" : " (the AES rule is written for pieces ≤ 60 s, so this is a warning)"}; a beat drop or a sound effect is too hot against the rest`
      : `max short-term ${st?.toFixed(1) ?? "?"} LUFS, ${st !== undefined ? (st - lufs).toFixed(1) : "?"} LU above integrated`,
    threshold: `max short-term ≤ integrated + ${SHORT_TERM_HEADROOM_LU} LU (short-form ≤ ${SHORT_FORM_SECONDS} s)`,
    source: AES,
    fix: stHot ? reportFix("audio.shortterm", "a beat drop or an effect is mixed too hot against the rest", { maxShortTerm: st, lufs, headroom: SHORT_TERM_HEADROOM_LU }) : NO_FIX,
  });

  const edge = 1 / fps;
  const internal = silences.filter((s) => s.from > edge && s.to < probe.seconds - edge && s.to - s.from >= SILENCE_MIN_SECONDS);
  const leading = silences.find((s) => s.from <= edge);
  const leadTooLong = leading !== undefined && leading.to - leading.from > LEADING_SILENCE_MAX;
  checks.push({
    id: "audio.silence",
    status: internal.length ? "fail" : leadTooLong ? "warn" : "pass",
    summary: internal.length
      ? `silence for ${internal.map((s) => `${fmt(s.to - s.from)} at ${fmt(s.from)}`).join(", ")} in the middle of the piece; a line did not arrive or the bed stopped`
      : leadTooLong
        ? `${fmt(leading.to - leading.from)} of silence before the first sound; the hook should land inside the first half second`
        : "no silent gaps",
    threshold: `no internal gap > ${SILENCE_MIN_SECONDS} s below ${SILENCE_NOISE_DB} dB; leading silence ≤ ${LEADING_SILENCE_MAX} s`,
    source: `house rule; silencedetect per ${FFMPEG_DOCS}`,
    ...(internal.length || leadTooLong ? { at: at((internal.length ? internal : [leading!]).map((s) => s.from), fps) } : {}),
    fix: internal.length
      ? reportFix("audio.silence", "a line did not reach the mix or the bed stopped", { gaps: internal })
      : leadTooLong
        ? reportFix("audio.silence", `the first sound comes ${fmt(leading.to - leading.from)} in`, { leading })
        : NO_FIX,
  });

  const clipped = peakDb !== undefined && (peakDb >= CLIP_PEAK_DBFS || (peakDb >= FLAT_TOP_PEAK_DBFS && flat > 0));
  checks.push({
    id: "audio.clipping",
    status: clipped ? "fail" : "pass",
    summary: clipped
      ? `sample peak ${peakDb.toFixed(2)} dBFS${flat > 0 ? ` with a flat top (flat factor ${flat.toFixed(2)})` : ""}: the track clips; the limiter ceiling or the mix gain is too high`
      : `sample peak ${peakDb?.toFixed(2) ?? "?"} dBFS, no flat tops`,
    threshold: `sample peak < ${CLIP_PEAK_DBFS} dBFS, and no flat top at ≥ ${FLAT_TOP_PEAK_DBFS} dBFS`,
    source: `astats per ${FFMPEG_DOCS}`,
    fix: clipped ? reportFix("audio.clipping", "the mix gain or the limiter ceiling clips the track", { peakDb, flat }) : NO_FIX,
  });

  return { checks, lufs, truePeak, lra, maxShortTerm: st, silences };
}
