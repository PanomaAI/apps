/*
  Which encoder wrote the file, and the promise that it is never a surprise.

  `@panoma/video-codec` picks a different encoder on each operating system, so the thing
  worth testing is not the table — a test that restates a table only proves it was
  copied twice. What is tested here is the four things that must hold whichever branch
  ran: the encoder chosen is one this ffmpeg actually has, the file it wrote says which
  one it was, the rate clears the lowest floor any platform sets even on a short piece,
  and no ffmpeg comes bundled in the tree for it to choose from.

  The last one is the oldest rule in this project restated for binaries. `licenses.test.ts`
  keeps non-free source out; this keeps a codec out of the package, which is a separate
  question with separate consequences — see `docs/codecs.md`.
*/
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { platform } from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { aac, chosen, encoders, h264, h264Intermediate } from "@panoma/video-codec";
import { startEncoder } from "@panoma/video-engine/encoder";
import { probe } from "@panoma/video-review";

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/* The rate the engine asks for, and the lowest floor any target in `conformance.ts` sets. */
const ASKED = 5_000_000;
const LOWEST_PLATFORM_FLOOR = 2_500_000;

test("every encoder chosen is one this ffmpeg actually has", () => {
  const have = encoders();
  assert.ok(have.size > 0, "ffmpeg on PATH reported no encoders at all");
  /* Printed, not asserted: what each system picks is the thing CI is here to tell us. */
  console.log(`      ${chosen()}`);
  for (const choice of [h264(ASKED), h264Intermediate(), aac(256_000)]) {
    assert.ok(have.has(choice.name), `${choice.name} was chosen and this ffmpeg does not have it`);
    assert.ok(choice.why.length > 0, `${choice.name} was chosen without saying why`);
  }
});

/*
  A fallback has three causes and a report has to tell them apart, because two of them
  are a person's problem and one is not. Linux ships no H.264 encoder and is working as
  designed. An ffmpeg built without the encoder its own system ships is a build worth
  replacing. And a system whose encoder was tried and turned down is neither — which is
  Windows, where this line first went out saying the machine ships no encoder of its own
  while `h264_mf` sat right there. A message that is merely reassuring is worse than none.
*/
test("a fallback never tells a system it has no encoder when it has one", () => {
  const choice = h264(ASKED);
  if (choice.system) return;
  if (platform() === "win32" || platform() === "darwin") {
    assert.ok(
      !/ships no encoder of its own/.test(choice.why),
      `${platform()} ships an H.264 encoder and the report denies it: "${choice.why}"`,
    );
  }
});

/*
  The trap that cost an afternoon: VideoToolbox holds a rate through `constant_bit_rate`
  and stops holding it the moment a maximum is set as well. The same flat card came out
  at 33 kbps with both, and at 4.4 Mbps with only the first. It looks like the careful
  spelling, which is why it is worth a test and not a comment.
*/
test("a constant rate is never asked for alongside a maximum", () => {
  const { args } = h264(ASKED);
  if (args.includes("-constant_bit_rate")) {
    assert.ok(!args.includes("-maxrate"), "-constant_bit_rate and -maxrate together silence the rate control");
    assert.ok(!args.includes("-bufsize"), "-constant_bit_rate and -bufsize together silence the rate control");
  }
});

test("the delivered file names its own encoder, and it is the one that was chosen", async () => {
  const dir = await mkdtemp(join(tmpdir(), "panoma-video-codec-"));
  try {
    const card = join(dir, "card.png");
    await run("ffmpeg", [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "color=c=0x0b0b0f:s=720x1280",
      "-vf", "drawbox=x=60:y=520:w=600:h=240:color=0xf5f7fa:t=fill",
      "-frames:v", "1",
      card,
    ]);
    const png = await readFile(card);

    /*
      A second and a half: shorter than anything this engine delivers, and deliberately
      so. Rate control has not converged this early — `encode.test.ts` measures the
      curve — so this is the worst case, and the worst case still has to clear the
      floor the platforms set rather than the one libx264 happens to hit.
    */
    const out = join(dir, "short.mp4");
    const encoder = startEncoder({ out, fps: 30, durationInFrames: 45, audio: [] });
    for (let i = 0; i < 45; i++) await encoder.write(png);
    await encoder.finish();

    const p = await probe(out);
    assert.ok(p.video, "no video stream");
    assert.ok(
      p.video.encoder?.includes(h264(ASKED).name),
      `the file says it was written by ${p.video.encoder ?? "nothing"}, and ${h264(ASKED).name} was chosen`,
    );
    assert.ok(
      p.bitrate > LOWEST_PLATFORM_FLOOR,
      `the shortest possible piece leaves at ${Math.round(p.bitrate / 1000)} kbps, under the ${LOWEST_PLATFORM_FLOOR / 1000} kbps floor a platform sets`,
    );
    assert.equal(p.video.codec, "h264");
    assert.equal(p.video.profile, "High");
    assert.equal(p.video.pixFmt, "yuv420p");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/*
  No ffmpeg travels inside this product, and that has two separate reasons that happen
  to point the same way. A build carrying libx264 is GPL, which is a copyright problem
  for a package (`packages/review/src/exec.ts`). A build carrying any H.264 encoder at
  all is a codec we would be shipping rather than one the machine already had, which is
  a patent question and a different one (`docs/codecs.md`). Either reason alone is
  enough; the packages below are the usual way it happens by accident.
*/
const BUNDLERS = [/^ffmpeg-static/, /^ffprobe-static/, /^@ffmpeg-installer\//, /^@ffprobe-installer\//, /^ffbinaries$/, /^@ffmpeg\/core/];

test("no manifest in this repository pulls in a bundled ffmpeg", () => {
  const manifests = ["package.json", "briefs/package.json"];
  for (const scope of ["apps", "packages"]) {
    for (const entry of readdirSync(join(ROOT, scope), { withFileTypes: true })) {
      if (entry.isDirectory()) manifests.push(join(scope, entry.name, "package.json"));
    }
  }
  const offenders: string[] = [];
  for (const manifest of manifests) {
    const d = JSON.parse(readFileSync(join(ROOT, manifest), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const name of Object.keys({ ...d.dependencies, ...d.devDependencies })) {
      if (BUNDLERS.some((re) => re.test(name))) offenders.push(`${manifest}: ${name}`);
    }
  }
  assert.deepEqual(offenders, [], "an ffmpeg binary would ship inside the package");
});
