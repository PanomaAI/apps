import assert from "node:assert/strict";
import { test } from "node:test";
import { BEAT_DECAY_S, DANCE_SCALE, DANCE_UNDER_VOICE, STILL, dancedScale, dancedZoom, pulseAt, pulseFor, type Pulse } from "@panoma/video-render/pulse";

/* A pulse nobody analysed: 30 fps, a beat every 15 frames, every fourth a downbeat, energy rising. */
const FPS = 30;
const pulse: Pulse = {
  fps: FPS,
  energy: Array.from({ length: 120 }, (_, f) => f / 119),
  low: Array.from({ length: 120 }, (_, f) => (f % 15 === 0 ? 1 : 0.2)),
  beats: Array.from({ length: 8 }, (_, i) => ({ frame: i * 15, strength: i % 2 === 0 ? 1 : 0.6, down: i % 4 === 0 })),
};

test("a beat lands on its frame at its strength and is gone before the next one", () => {
  assert.equal(pulseAt(pulse, 0).beat, 1);
  assert.equal(pulseAt(pulse, 15).beat, 0.6);
  /* One time constant later, e^-1 of it is left. */
  const later = pulseAt(pulse, Math.round(BEAT_DECAY_S * FPS));
  assert.ok(Math.abs(later.beat - Math.exp(-1)) < 0.02, `${later.beat}`);
  /* Just before the next beat, under two per cent. */
  assert.ok(pulseAt(pulse, 14).beat < 0.02);
});

test("downbeats carry the same impulse in `down`, other beats none", () => {
  assert.equal(pulseAt(pulse, 0).down, 1);
  assert.equal(pulseAt(pulse, 15).down, 0);
  assert.equal(pulseAt(pulse, 60).down, 1);
});

test("the envelopes are read per frame, and end where the track does", () => {
  assert.equal(pulseAt(pulse, 0).energy, 0);
  assert.equal(pulseAt(pulse, 119).energy, 1);
  /* Past the last analysed frame there is no music, so there is nothing to breathe with: it used to hold this value for ever. */
  assert.equal(pulseAt(pulse, 500).energy, 0);
  assert.equal(pulseAt(pulse, 30).low, 1);
  assert.equal(pulseAt(pulse, 31).low, 0.2);
});

test("before the first beat there is no impulse, and without a pulse the picture is still", () => {
  const late: Pulse = { ...pulse, beats: pulse.beats.map((b) => ({ ...b, frame: b.frame + 10 })) };
  assert.equal(pulseAt(late, 5).beat, 0);
  assert.deepEqual(pulseAt(undefined, 40), STILL);
  assert.deepEqual(dancedZoom({ scale: 1.4, dx: 0.1, dy: 0 }, STILL), { scale: 1.4, dx: 0.1, dy: 0 });
});

test("the dance only ever punches in, by at most three per cent, and a voice keeps a third of it", () => {
  const zoom = { scale: 1.5, dx: 0, dy: 0 };
  for (let f = 0; f < 120; f++) {
    const d = dancedZoom(zoom, pulseAt(pulse, f));
    assert.ok(d.scale >= zoom.scale, `frame ${f} shrank`);
    assert.ok(d.scale <= zoom.scale * (1 + DANCE_SCALE * 1.5) + 1e-9, `frame ${f} punched ${d.scale}`);
  }
  assert.ok(Math.abs(dancedZoom(zoom, pulseAt(pulse, 0)).scale - zoom.scale * (1 + DANCE_SCALE * 1.5)) < 1e-9);
  assert.ok(Math.abs(dancedZoom(zoom, pulseAt(pulse, 0), DANCE_UNDER_VOICE).scale - zoom.scale * (1 + DANCE_SCALE * 1.5 * DANCE_UNDER_VOICE)) < 1e-9);
  assert.equal(dancedScale(STILL), 1);
  assert.ok(Math.abs(dancedScale(pulseAt(pulse, 15)) - (1 + DANCE_SCALE * 0.6)) < 1e-9);
});

test("the level is baked into the pulse: light keeps a third of every beat, off is no pulse", () => {
  assert.equal(pulseFor(pulse, "off"), undefined);
  assert.equal(pulseFor(pulse, undefined), undefined);
  assert.equal(pulseFor(undefined, "full"), undefined);
  assert.equal(pulseFor(pulse, "full"), pulse);
  const light = pulseFor(pulse, "light")!;
  assert.ok(Math.abs(pulseAt(light, 0).beat - DANCE_UNDER_VOICE) < 1e-9);
  assert.equal(pulseAt(light, 0).energy, pulseAt(pulse, 0).energy);
  /* The same object each time, so a per-frame caller does not rebuild it. */
  assert.equal(pulseFor(pulse, "light"), light);
});

test("past the end of the track there is nothing to breathe with", () => {
  /* Two seconds of pulse under a piece that runs longer: the lights go out rather than holding. */
  const short: Pulse = { fps: 30, energy: [1, 1, 1], low: [0.5, 0.5, 0.5], beats: [{ frame: 0, strength: 1, down: true }] };
  assert.equal(pulseAt(short, 2).energy, 1);
  assert.equal(pulseAt(short, 3).energy, 0);
  assert.equal(pulseAt(short, 900).energy, 0);
  assert.equal(pulseAt(short, 900).low, 0);
  /* The beat's impulse has decayed to nothing by then anyway, so the picture is still. */
  assert.ok(pulseAt(short, 900).beat < 1e-9);
});
