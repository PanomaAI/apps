/*
  Tone of voice, from the README, as five numbers and a label. A video that says
  "Ship it! 🚀" over a product whose README reads like an RFC is wrong in a way no
  colour check catches, and no free library classifies register — dembrandt's voice.ts
  only samples copy by role. So this is a heuristic layer, deliberately small and
  seedless: the same README always yields the same metrics, and the thresholds below
  are the ones the brand research recommended (recommendation 7), so they can be
  argued with as numbers rather than as a model's mood.

  Metrics (sample = the first 400 words after the title, code fences removed):
    meanSentenceLen  words per sentence
    secondPersonRate share of sentences containing you / your / you're / yours
    exclamationRate  share of sentences ending in "!"
    emojiRate        emoji per word
    passiveRate      share of sentences with a be-verb + past participle
    codeFenceShare   characters inside ``` fences over the WHOLE README
    flesch           Flesch reading ease (Flesch 1948; syllables by vowel groups)
*/
import type { Register } from "./types.ts";

export const TONE_SAMPLE_WORDS = 400;

/* Emoji: the pictographic blocks plus regional indicators. Not exhaustive by design — a
   README with three rockets and a sparkle is playful whichever face is missed. */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F000}-\u{1F2FF}]/gu;

const SECOND_PERSON = /\b(you|your|yours|you're|you've|you'll|you'd)\b/i;

/* was/were/been/being/is/are/be + a participle: -ed, -en, or a short irregular list.
   A heuristic, not a parser: "is designed", "was built", "are shown". */
const PASSIVE =
  /\b(was|were|been|being|is|are|be|get|gets|got)\s+(?:\w+ly\s+)?(\w+(?:ed|en)|built|made|written|done|given|taken|known|shown|seen|run|set|kept|held|sent|put|read|found|left|paid|sold|told|thought|understood|used)\b/i;

/** Sentences of a text: split on terminal punctuation followed by space or end, keeping the terminator. */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[])|\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 2);
}

/** A crude but stable syllable count: vowel groups, minus a trailing silent e, never below 1. */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  const groups = w.match(/[aeiouy]+/g)?.length ?? 0;
  const silentE = /[^aeiou]e$/.test(w) && groups > 1 ? 1 : 0;
  return Math.max(1, groups - silentE);
}

/** Markdown → prose: fences out, links to their text, images and HTML and badges gone. */
function proseOf(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
    .replace(/\|/g, " ")
    .replace(/[ \t]+/g, " ");
}

export type ToneMetrics = {
  meanSentenceLen: number;
  secondPersonRate: number;
  exclamationRate: number;
  emojiRate: number;
  passiveRate: number;
  codeFenceShare: number;
  flesch: number;
  words: number;
  sentences: number;
};

export function toneMetrics(readme: string): ToneMetrics {
  const total = readme.replace(/\s+/g, "").length || 1;
  const fenced = (readme.match(/```[\s\S]*?```|~~~[\s\S]*?~~~/g) ?? []).join("").replace(/\s+/g, "").length;
  const codeFenceShare = fenced / total;

  /* The sample starts after the title line; badges and the H1 are not voice. */
  const body = readme.replace(/^\s*#\s[^\n]*\n/, "");
  const prose = proseOf(body);
  const allWords = prose.split(/\s+/).filter(Boolean);
  const sampleText = allWords.slice(0, TONE_SAMPLE_WORDS).join(" ");
  const sentences = sentencesOf(sampleText);
  const words = sampleText.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  const n = sentences.length || 1;
  const w = words.length || 1;

  const emoji = (sampleText.match(EMOJI) ?? []).length;
  const syl = words.reduce((sum, word) => sum + syllables(word), 0);
  const round = (v: number): number => Math.round(v * 1000) / 1000;

  return {
    meanSentenceLen: round(w / n),
    secondPersonRate: round(sentences.filter((s) => SECOND_PERSON.test(s)).length / n),
    exclamationRate: round(sentences.filter((s) => /!["')\]]*$/.test(s)).length / n),
    emojiRate: round(emoji / w),
    passiveRate: round(sentences.filter((s) => PASSIVE.test(s)).length / n),
    codeFenceShare: round(codeFenceShare),
    /* Flesch reading ease: 206.835 − 1.015 (words/sentences) − 84.6 (syllables/words). */
    flesch: round(206.835 - 1.015 * (w / n) - 84.6 * (syl / w)),
    words: words.length,
    sentences: sentences.length,
  };
}

/*
  Thresholds from the brand research, recommendation 7, checked in this order. The
  order matters: a playful README is playful even when it is also technical, and
  "friendly" is the residual second-person register once the louder ones are excluded.
*/
export function registerOf(m: ToneMetrics): Register {
  if (m.emojiRate > 0.02 || m.exclamationRate > 0.15) return "playful";
  if (m.flesch < 45 && m.codeFenceShare > 0.25) return "technical";
  if (m.passiveRate > 0.2 && m.secondPersonRate < 0.1) return "formal";
  if (m.secondPersonRate > 0.3) return "friendly";
  return "neutral";
}

export function toneOf(readme: string): { register: Register; metrics: Record<string, number> } {
  const metrics = toneMetrics(readme);
  return { register: registerOf(metrics), metrics: { ...metrics } };
}

export function neutralTone(): { register: Register; metrics: Record<string, number> } {
  return { register: "neutral", metrics: {} };
}
