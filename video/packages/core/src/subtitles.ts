/*
  Subtitle sidecars from the word timestamps panoma video already has.

  The kinetic captions burned into every cut are not closed captions: a screen reader
  cannot read them, a viewer cannot resize them, a platform cannot index or translate
  them. WCAG 1.2.2 (Level A) wants captions as a text track, and YouTube, LinkedIn and
  a plain <video> all take an .srt or .vtt beside the file. Until this module existed
  the engine shipped none, which meant an accessible video in the frame and an inaccessible
  one on the platform — the same words, twice, and only one of them counting.

  The voice call returns word timings, so a cue list is arithmetic. What is not
  arithmetic is where a cue breaks, and this module uses the same three tells as the
  on-screen cards in apps/render (timing.ts, captionCards): a full stop, a real pause,
  a full line. It adds the two duration rules a text track needs and a card does not,
  because a card holds until the next one arrives and a cue does not: Netflix's 5/6 s
  floor and 7 s ceiling per event. A cue that is too short is stretched into the
  silence after it, or merged with a neighbour — never across a pause, because a cue
  that shows the tail of one sentence beside the head of the next reads as a mistake.
*/

export type Cue = { start: number; end: number; text: string };

export type CueWord = { readonly text: string; readonly start: number; readonly end: number };

export type CueOptions = {
  /** Characters per cue, one line. */
  readonly maxChars?: number;
  /** Longest a cue may stay up, seconds. */
  readonly maxSeconds?: number;
  /** Shortest a cue may stay up, seconds. */
  readonly minSeconds?: number;
  /** Silence between two words that ends a cue, seconds. */
  readonly gapBreak?: number;
  /** Space left between one cue's out and the next cue's in, seconds. */
  readonly minGap?: number;
};

/*
  Netflix English Timed Text Style Guide: 42 characters per line, minimum duration
  5/6 of a second (20 frames at 24 fps), maximum 7 seconds per event, and two frames
  between events. The 0.5 s pause is the value captionCards breaks on, kept equal so a
  cue and a card end at the same place.
  https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-Timed-Text-Style-Guide
*/
export const CUE_MAX_CHARS = 42;
export const CUE_MAX_SECONDS = 7;
export const CUE_MIN_SECONDS = 5 / 6;
export const CUE_GAP_BREAK = 0.5;
export const CUE_MIN_GAP = 2 / 24;

/** A sentence ends at .!? or an ellipsis, with any closing quote or bracket after it. */
const SENTENCE_END = /[.!?…][)\]"'”’»]*$/;

type Draft = { start: number; spoken: number; end: number; text: string };

function chars(a: string, b: string): number {
  return a.length + 1 + b.length;
}

/**
 * Words, in order, into cues. Words with no text are dropped; the rest are sorted by
 * start so a track assembled from several lines still reads in time order.
 */
export function cuesFromWords(input: readonly CueWord[], opts: CueOptions = {}): Cue[] {
  const maxChars = opts.maxChars ?? CUE_MAX_CHARS;
  const maxSeconds = opts.maxSeconds ?? CUE_MAX_SECONDS;
  const minSeconds = opts.minSeconds ?? CUE_MIN_SECONDS;
  const gapBreak = opts.gapBreak ?? CUE_GAP_BREAK;
  const minGap = opts.minGap ?? CUE_MIN_GAP;

  const words = input
    .map((w) => ({ text: w.text.trim(), start: w.start, end: w.end }))
    .filter((w) => w.text.length > 0)
    .sort((a, b) => a.start - b.start);

  /* Pass one: where a cue breaks. The same tells as the on-screen cards. */
  const drafts: Draft[] = [];
  let group: typeof words = [];
  for (let i = 0; i < words.length; i++) {
    group.push(words[i]);
    const next = words[i + 1];
    if (!next) break;
    const text = group.map((w) => w.text).join(" ");
    const breaks =
      SENTENCE_END.test(words[i].text) ||
      next.start - words[i].end > gapBreak ||
      chars(text, next.text) > maxChars ||
      next.end - group[0].start > maxSeconds;
    if (breaks) {
      drafts.push(draft(group));
      group = [];
    }
  }
  if (group.length > 0) drafts.push(draft(group));

  /*
    Pass two: the floor. A cue under the minimum is first stretched into the silence
    that follows it, up to two frames before the next cue. When there is no room — the
    next cue starts at once — it is merged forward, or backward, but only with a
    neighbour it shares a breath with, and only if the merge stays inside the line and
    time budgets. A one-word cue boxed in by two pauses stays short: stretching it over
    a pause would caption silence, and that is worse than a brief cue.
  */
  for (let i = 0; i < drafts.length; i++) {
    const cue = drafts[i];
    if (cue.end - cue.start >= minSeconds - 1e-9) continue;
    const next = drafts[i + 1];
    const room = next ? next.start - minGap : Infinity;
    const wanted = cue.start + minSeconds;
    if (wanted <= room) {
      cue.end = wanted;
      continue;
    }
    if (next && canMerge(cue, next, gapBreak, maxChars, maxSeconds)) {
      drafts.splice(i, 2, merged(cue, next));
      i--;
      continue;
    }
    const prev = drafts[i - 1];
    if (prev && canMerge(prev, cue, gapBreak, maxChars, maxSeconds)) {
      drafts.splice(i - 1, 2, merged(prev, cue));
      i -= 2;
      continue;
    }
    cue.end = Math.max(cue.end, room);
  }

  return drafts.map((d) => ({ start: d.start, end: d.end, text: d.text }));
}

function draft(group: readonly CueWord[]): Draft {
  const spoken = group[group.length - 1].end;
  return { start: group[0].start, spoken, end: spoken, text: group.map((w) => w.text).join(" ") };
}

function canMerge(a: Draft, b: Draft, gapBreak: number, maxChars: number, maxSeconds: number): boolean {
  return b.start - a.spoken <= gapBreak && chars(a.text, b.text) <= maxChars && b.spoken - a.start <= maxSeconds;
}

function merged(a: Draft, b: Draft): Draft {
  return { start: a.start, spoken: b.spoken, end: Math.max(b.end, b.spoken), text: `${a.text} ${b.text}` };
}

/* ---------- Writers ---------- */

function clock(seconds: number, separator: string): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const ms = total % 1000;
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60_000) % 60;
  const h = Math.floor(total / 3_600_000);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(h)}:${two(m)}:${two(s)}${separator}${String(ms).padStart(3, "0")}`;
}

/** `HH:MM:SS,mmm` — SubRip uses a comma. */
export function srtTime(seconds: number): string {
  return clock(seconds, ",");
}

/** `HH:MM:SS.mmm` — WebVTT uses a full stop. */
export function vttTime(seconds: number): string {
  return clock(seconds, ".");
}

/** A blank line ends a block in both formats, so a cue's text may never contain one. */
function oneBlock(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n[ \t]*\n+/g, "\n").trim();
}

/**
 * SubRip. Blocks numbered from 1, separated by one blank line, trailing newline.
 * https://www.matroska.org/technical/subtitles.html#srt-subtitles
 */
export function toSrt(cues: readonly Cue[]): string {
  if (cues.length === 0) return "";
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${oneBlock(c.text)}`).join("\n\n") + "\n";
}

/**
 * WebVTT. The `WEBVTT` header, a blank line, then cue blocks without identifiers.
 * Cue text is markup in this format, so the three characters that open tags or
 * entities are escaped. https://www.w3.org/TR/webvtt1/#file-structure
 */
export function toVtt(cues: readonly Cue[]): string {
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const blocks = cues.map((c) => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${escape(oneBlock(c.text))}`);
  return blocks.length === 0 ? "WEBVTT\n" : `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

/*
  A pause of a full second between two cues is a paragraph. Shorter than that and the
  cues are one breath's worth of sentences, joined with a space.
*/
const PARAGRAPH_GAP = 1;

/** Plain text, one paragraph per stretch of continuous speech, trailing newline. Empty for no cues. */
export function toTranscript(cues: readonly Cue[]): string {
  if (cues.length === 0) return "";
  const paragraphs: string[][] = [];
  let previous: Cue | undefined;
  for (const cue of cues) {
    const text = oneBlock(cue.text).replace(/\n/g, " ");
    if (!previous || cue.start - previous.end > PARAGRAPH_GAP) paragraphs.push([text]);
    else paragraphs[paragraphs.length - 1].push(text);
    previous = cue;
  }
  return paragraphs.map((p) => p.join(" ")).join("\n\n") + "\n";
}
