/*
  A track someone brings, scored for the grid.

  The procedural bed is on the grid by construction. A brought track is not: it has its
  own tempo, its first downbeat is wherever the producer left it, and nothing in it knows
  what a frame is. This module reads the file once and writes three things next to the
  workspace's music:

    1. the analysis — tempo, beats, downbeats, loudness (packages/audio/src/beat.ts);
    2. the conformed track — cut to its first downbeat and stretched to the nearest tempo
       with a whole number of frames per beat, so beat n of the file is frame n × beatFrames
       of the composition, exactly, and every cut on the grid is a cut on the music;
    3. the pulse — one number per frame the picture moves with (apps/render/src/recipes/pulse.ts
       reads it), already in the composition's time so the render never sees the head cut
       or the stretch.

  All three are keyed on the file's bytes, the frame rate and TRACK_VERSION, so a second
  run with the same track costs nothing and a different track cannot be served a stale
  pulse. The stretch is small — under 4% up to 150 BPM at 30 fps, usually under 1% — and
  ffmpeg's atempo keeps the pitch; the exact figure is on the provenance record.
*/
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { analyseTrack, conformTrack, gridTempo, loudness, type TrackAnalysis } from "@panoma/video-audio";
import { readJson, writeJson } from "./workspace.ts";

/** Bumped when the analysis, the conform or the pulse changes shape or arithmetic. */
export const TRACK_VERSION = 2;

export type ScoredTrack = {
  version: number;
  /** The file as brought. */
  source: string;
  /** The conformed WAV: cut to its first downbeat, stretched to the grid, 48 kHz stereo. */
  file: string;
  /** The per-frame pulse the render reads. */
  pulse: string;
  fps: number;
  /** The grid's tempo: whole frames per beat at `fps`. */
  bpm: number;
  beatFrames: number;
  /** The track's own tempo, measured. */
  measured: number;
  /** The atempo factor that put it on the grid; 1 is untouched, above 1 is faster. */
  ratio: number;
  /** Seconds cut before the first downbeat. */
  head: number;
  /** Seconds of the conformed track. */
  seconds: number;
  /** Integrated loudness of the track as brought, so the mix can seat it where the bed sits. */
  lufs?: number;
};

/*
  What the render reads (a structural copy of `Pulse` in apps/render/src/recipes/pulse.ts,
  plus the loudness the mix wants): one value per composition frame, and every beat on
  the timeline with how hard it hit.
*/
type PulseFile = {
  fps: number;
  lufs?: number;
  bpm: number;
  energy: number[];
  low: number[];
  beats: { frame: number; strength: number; down: boolean }[];
};

async function hashOf(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex").slice(0, 16);
}

/*
  Where the film opens: the first beat of the track that is actually a hit, moved forward
  to the phase the bars start on.

  `beats[downbeat]` is not that. The detected phase is one of four, so the beat it names is
  always one of the first four the tracker found — and the tracker chains beats back
  through anything at the right period, a noise floor or a pad included. Any intro longer
  than a bar therefore kept most of itself and the film opened over it, while the
  documentation, the CLI and the MCP tools all promised the first downbeat.

  A beat is a hit when its strength — now the peak of the low band, so a real number about
  the music (packages/audio/src/beat.ts) — reaches a tenth of the strongest beat's, which
  is 20 dB down. On the two-bar pad intro of the test fixture the intro beats measure
  0.002 and the softest kick 0.510, so the gate sits 50× above the pad and 5× under the
  quietest real kick. Twenty decibels under the loudest hit of its own track is not a hit;
  a track that never has one keeps the old answer.
*/
export const HEAD_HIT = 0.1;
export function headOf(a: TrackAnalysis): { index: number; seconds: number } {
  const first = a.strength.findIndex((s) => s >= HEAD_HIT);
  if (first < 0) return { index: a.downbeat, seconds: a.beats[a.downbeat] ?? 0 };
  const index = first + (((a.downbeat - first) % 4) + 4) % 4;
  const seconds = a.beats[index];
  return seconds === undefined ? { index: first, seconds: a.beats[first] ?? 0 } : { index, seconds };
}

/** The pulse in composition time: the head and the stretch are resolved here, once. */
export function pulseOf(a: TrackAnalysis, conform: { head: number; ratio: number; beatFrames: number; fps: number; seconds: number; beat0?: number }, lufs?: number): PulseFile {
  const { fps, beatFrames } = conform;
  const frames = Math.max(1, Math.round(conform.seconds * fps));
  /*
    Past the end of the analysed audio there is no loudness, so the pulse is 0 there. The
    index used to be clamped to the last frame, and a track shorter than the piece left the
    stage lights breathing at its final loudness over the silence that followed.
  */
  const at = (arr: number[], f: number) => {
    const i = Math.round((conform.head + (f / fps) * conform.ratio) * a.envelopeHz);
    return i >= arr.length ? 0 : arr[Math.max(0, i)] ?? 0;
  };
  const energy: number[] = [];
  const low: number[] = [];
  for (let f = 0; f < frames; f++) {
    energy.push(at(a.energy, f));
    low.push(at(a.low, f));
  }
  /*
    Beat n of the conformed file is frame n × beatFrames by construction; its strength is
    the measured beat's, counted from the beat the head cut landed on. Past the last
    measured beat the file is over anyway (the conform cut it there), so the beats stop.
  */
  const beat0 = conform.beat0 ?? a.downbeat;
  const beats: PulseFile["beats"] = [];
  for (let n = 0; n * beatFrames < frames; n++) {
    const strength = a.strength[beat0 + n];
    if (strength === undefined) break;
    beats.push({ frame: n * beatFrames, strength, down: n % 4 === 0 });
  }
  return { fps, ...(lufs !== undefined ? { lufs } : {}), bpm: (fps * 60) / beatFrames, energy, low, beats };
}

/*
  What counts as a track someone brought. This check used to live in the request
  validator the browser Studio called, which refused a directory or a `.env` before a
  byte of it was read; the terminal's `--music=` never reached that validator, so a
  mistyped or simply wrong argument went to ffmpeg and came back as whatever ffmpeg says
  about a file that is not a track. It belongs here instead, on the one path every
  brought track is scored through.
*/
const AUDIO_SUFFIXES = [".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".aiff", ".aif"];

export async function scoreTrack(ws: { paths: { music: string } }, source: string, fps: number): Promise<ScoredTrack> {
  if (!existsSync(source)) throw new Error(`No music file at ${source}.`);
  if (!statSync(source).isFile() || !AUDIO_SUFFIXES.includes(extname(source).toLowerCase())) {
    throw new Error(`${basename(source)} is not an audio file. Choose a local MP3, WAV, FLAC, M4A, AAC, OGG, Opus or AIFF track.`);
  }
  const hash = await hashOf(source);
  const stem = `${basename(source, extname(source)).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${hash}`;
  const record = join(ws.paths.music, `${stem}.${fps}fps.track.json`);
  const cached = await readJson<ScoredTrack>(record);
  if (cached && cached.version === TRACK_VERSION && existsSync(cached.file) && existsSync(cached.pulse)) return cached;

  const analysisFile = join(ws.paths.music, `${stem}.analysis.json`);
  const analysis = (await readJson<TrackAnalysis & { version?: number }>(analysisFile).then((a) => (a && a.version === TRACK_VERSION ? a : null))) ?? (await analyseTrack(source));
  await writeJson(analysisFile, { version: TRACK_VERSION, ...analysis });
  const measured = await loudness(source);
  const lufs = measured === undefined ? undefined : Number.parseFloat(measured);

  const tempo = gridTempo(analysis.bpm, fps);
  const { index: beat0, seconds: head } = headOf(analysis);
  const seconds = Math.max(0, (analysis.seconds - head) / tempo.ratio);
  const file = join(ws.paths.music, `${stem}.${fps}fps.wav`);
  await conformTrack(source, file, { head, ratio: tempo.ratio, seconds });

  const pulse = join(ws.paths.music, `${stem}.${fps}fps.pulse.json`);
  await writeJson(pulse, pulseOf(analysis, { head, ratio: tempo.ratio, beatFrames: tempo.beatFrames, fps, seconds, beat0 }, Number.isFinite(lufs) ? lufs : undefined));

  const scored: ScoredTrack = {
    version: TRACK_VERSION,
    source,
    file,
    pulse,
    fps,
    bpm: tempo.bpm,
    beatFrames: tempo.beatFrames,
    measured: analysis.bpm,
    ratio: tempo.ratio,
    head,
    seconds,
    ...(lufs !== undefined && Number.isFinite(lufs) ? { lufs } : {}),
  };
  await writeJson(record, scored);
  return scored;
}

/** One line for the stage report: what the track is and what the grid did to it. */
export function describeTrack(t: ScoredTrack): string {
  const stretch = Math.abs(t.ratio - 1) < 0.0005 ? "untouched" : `${t.ratio > 1 ? "sped up" : "slowed"} ${(Math.abs(t.ratio - 1) * 100).toFixed(1)}%`;
  return `${basename(t.source)} · ${t.measured.toFixed(1)} BPM measured → ${t.bpm.toFixed(2)} on the grid (${t.beatFrames} frames a beat, ${stretch}) · ${t.seconds.toFixed(0)} s${t.lufs !== undefined ? ` · ${t.lufs.toFixed(1)} LUFS` : ""}`;
}
