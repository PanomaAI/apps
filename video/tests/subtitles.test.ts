import assert from "node:assert/strict";
import { test } from "node:test";
import { CUE_MIN_GAP, CUE_MIN_SECONDS, cuesFromWords, srtTime, toSrt, toTranscript, toVtt, vttTime } from "@panoma/video-core";
import type { Cue } from "@panoma/video-core";

const SAMPLE: Cue[] = [
  { start: 0, end: 1.5, text: "Hello there." },
  { start: 2, end: 3661.25, text: "Line two" },
];

test("SRT is byte-exact: numbered blocks, comma milliseconds, one trailing newline", () => {
  assert.equal(toSrt(SAMPLE), "1\n00:00:00,000 --> 00:00:01,500\nHello there.\n\n2\n00:00:02,000 --> 01:01:01,250\nLine two\n");
  assert.equal(toSrt([]), "");
});

test("VTT is byte-exact: the header, a blank line, full-stop milliseconds, no identifiers", () => {
  assert.equal(toVtt(SAMPLE), "WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nHello there.\n\n00:00:02.000 --> 01:01:01.250\nLine two\n");
  assert.equal(toVtt([]), "WEBVTT\n");
});

test("VTT escapes the three characters that are markup; SRT leaves them alone", () => {
  const cue = [{ start: 0, end: 1, text: "<b> & </b>" }];
  assert.equal(toVtt(cue), "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n&lt;b&gt; &amp; &lt;/b&gt;\n");
  assert.equal(toSrt(cue), "1\n00:00:00,000 --> 00:00:01,000\n<b> & </b>\n");
});

test("timestamps round to the millisecond and never go below zero", () => {
  assert.equal(srtTime(0.0005), "00:00:00,001");
  assert.equal(vttTime(59.9996), "00:01:00.000");
  assert.equal(srtTime(-3), "00:00:00,000");
  assert.equal(vttTime(3600 * 27), "27:00:00.000");
});

test("a blank line inside a cue would end the block early, so it is collapsed", () => {
  const cue = [{ start: 0, end: 1, text: "one\n\n\ntwo" }];
  assert.equal(toSrt(cue), "1\n00:00:00,000 --> 00:00:01,000\none\ntwo\n");
});

test("a cue breaks at a full stop and at a real pause, never inside a breath", () => {
  const words = say(["Open", "the", "app.", "Then", "click", "run"], 0, 0.3, 0.05);
  const cues = cuesFromWords(words);
  assert.deepEqual(
    cues.map((c) => c.text),
    ["Open the app.", "Then click run"],
  );
  const paused = [
    { text: "one", start: 0, end: 0.3 },
    { text: "two", start: 0.9, end: 1.2 },
  ];
  const [first, second] = cuesFromWords(paused);
  assert.equal(first.text, "one");
  assert.equal(second.text, "two");
  /* Too short to keep, no room to merge across a 0.6 s pause: it stretches up to two frames before the next. */
  assert.ok(first.end <= 0.9 - CUE_MIN_GAP + 1e-9);
  assert.ok(first.end > 0.3);
});

test("a cue never exceeds 42 characters or 7 seconds", () => {
  const long = say("the quick brown fox jumps over the lazy dog again and again until the line is full".split(" "), 0, 0.25, 0.05);
  for (const c of cuesFromWords(long)) assert.ok(c.text.length <= 42, c.text);
  const slow = say(Array.from({ length: 12 }, () => "w"), 0, 0.5, 0.5);
  const cues = cuesFromWords(slow);
  assert.ok(cues.length >= 2);
  for (const c of cues) assert.ok(c.end - c.start <= 7 + 1e-9);
});

test("a short cue is stretched to five sixths of a second when the silence allows", () => {
  const cues = cuesFromWords([
    { text: "Hi.", start: 0, end: 0.2 },
    { text: "Later.", start: 5, end: 5.4 },
  ]);
  assert.equal(cues.length, 2);
  assert.ok(Math.abs(cues[0].end - CUE_MIN_SECONDS) < 1e-9);
  assert.ok(Math.abs(cues[1].end - (5 + CUE_MIN_SECONDS)) < 1e-9);
});

test("with no room to stretch, a short cue merges forward into the sentence that follows", () => {
  const cues = cuesFromWords([
    { text: "Yes.", start: 0, end: 0.2 },
    { text: "Then", start: 0.3, end: 0.5 },
    { text: "go.", start: 0.6, end: 1.0 },
  ]);
  assert.deepEqual(cues, [{ start: 0, end: 1.0, text: "Yes. Then go." }]);
});

test("when the next line is full, a short cue merges backward instead", () => {
  const cues = cuesFromWords([
    ...say("Open the settings panel now.".split(" "), 0, 0.4, 0),
    { text: "Go.", start: 2.1, end: 2.3 },
    ...say("Then wait for the very long sentence here.".split(" "), 2.4, 0.2, 0),
  ]);
  assert.equal(cues[0].text, "Open the settings panel now. Go.");
  assert.equal(cues[0].start, 0);
  assert.equal(cues[0].end, 2.3);
  assert.equal(cues[1].text, "Then wait for the very long sentence here.");
});

test("a merge never crosses a pause, even to reach the minimum", () => {
  const cues = cuesFromWords([
    { text: "Hi.", start: 0, end: 0.2 },
    { text: "There.", start: 1.0, end: 1.3 },
  ]);
  assert.equal(cues.length, 2);
  assert.ok(cues[0].end <= 1.0 - CUE_MIN_GAP + 1e-9);
});

test("empty words are dropped and the rest are put in time order", () => {
  const cues = cuesFromWords([
    { text: "two.", start: 0.6, end: 1.0 },
    { text: "  ", start: 0.45, end: 0.5 },
    { text: "One", start: 0, end: 0.4 },
  ]);
  assert.deepEqual(
    cues.map((c) => c.text),
    ["One two."],
  );
  assert.deepEqual(cuesFromWords([]), []);
});

test("the transcript joins a breath with spaces and opens a paragraph at a pause over a second", () => {
  const cues: Cue[] = [
    { start: 0, end: 1, text: "A b." },
    { start: 1.5, end: 2.5, text: "C d." },
    { start: 4, end: 5, text: "E\nf." },
  ];
  assert.equal(toTranscript(cues), "A b. C d.\n\nE f.\n");
  assert.equal(toTranscript([]), "");
});

/** Words spoken one after another: each `each` seconds long, `gap` seconds apart. */
function say(texts: string[], from: number, each: number, gap: number) {
  return texts.map((text, i) => ({ text, start: from + i * (each + gap), end: from + i * (each + gap) + each }));
}
