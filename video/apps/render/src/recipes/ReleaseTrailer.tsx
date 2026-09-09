/*
  The release trailer, the way the genre's reference pieces are actually built.

  Linear's "Introducing X" announcements have no speech and no hard cut of footage:
  one continuous camera move over the product, type cards of two to five words, a
  wordmark hold at the end. Cursor, Framer and Raycast do the same with a lighter
  background. The unit all of them share is a CLAIM CARD — at most five words, two to
  three seconds — followed by six to twelve seconds of the product PROVING it, three
  or four times, between fixed furniture: product in motion first, the name inside the
  first five seconds, a counted ticker, a status line, the wordmark last.

  What is on screen, by section (the clock is in timing.ts, `trailerPlan`):

  ONE THING ON SCREEN AT A TIME. A card is type on the stage and nothing else; a proof
  is the product and nothing else. Until 2026-09-03 every card was played OVER the
  product — pushed back, dimmed 58%, still moving behind the words — and every proof
  carried the claim again as a label in the corner. Two things asking for the same eye
  is what makes a film look busy, and it is the reason a card here never landed: the
  viewer was still reading the picture.

  - OPEN: the recording at its hero mark, moving, nothing written over it. A trailer
    that opens on a logo is a trailer that opens on nothing.
  - KICKER, THEME: the product's name and version, then the release headline, on the
    stage, with the product off screen. Type arrives word by word on ticks.
  - CLAIM: the card, alone. The footage jump from one moment to the next now happens
    while the product is not on screen at all, which is the cleanest cut there is.
  - PROOF: the product doing the thing, at the conform rate, camera closing on the
    action. Nothing is written over it.
  - TICKER, STATUS, END: the counted line, the typed status, the wordmark and the
    address, on the stage.

  Wordless by default. A voiced trailer is a patch away, and the captions then obey
  the same rules as everywhere else.
*/
import { AbsoluteFill, interpolate, useFrame } from "@panoma/video-engine";
import type { Brief, Format, Line } from "@panoma/video-core";
import type { SessionLog } from "@panoma/video-capture";
import { display, mono } from "../lib/fonts.ts";
import { Backdrop } from "../lib/Backdrop.tsx";
import { KineticTitle, type TitleVoice } from "../lib/KineticTitle.tsx";
import { ProductWindow } from "../lib/ProductWindow.tsx";
import { Stage, cardSize, titleSize } from "../lib/layout.tsx";
import { useColor } from "../lib/theme-context.tsx";
import {
  cameraAt,
  cameraTransform,
  castFrame,
  gridOf,
  trailerSectionAt,
  trailerSourceAt,
  type CastShot,
  type TrailerPlan,
  type TrailerSection,
} from "./timing.ts";
import { cursorAtMs, cursorPathOf } from "./motion.ts";
import { dancedScale, dancedZoom, pulseAt, type Pulse } from "./pulse.ts";

const textOf = (line: Line | undefined, lang: string) => (line ? (line.text[lang] ?? line.text[Object.keys(line.text)[0]] ?? "") : "");

/** Which sections the product is on screen for. Everything else is a card on the stage. */
const LIVE: Record<TrailerSection["kind"], boolean> = {
  open: true,
  kicker: false,
  theme: false,
  claim: false,
  proof: true,
  ticker: false,
  status: false,
  end: false,
};

/** The wordmark is the kicker without its version: the first tokens before one that starts with a digit. */
function wordmarkOf(kicker: string): string {
  const words = kicker.split(/\s+/).filter(Boolean);
  const cut = words.findIndex((w) => /^v?\d/.test(w));
  return (cut > 0 ? words.slice(0, cut) : words).join(" ");
}

export const ReleaseTrailer: React.FC<{
  brief: Brief;
  hook: Line;
  lang: string;
  format: Format;
  session: SessionLog;
  plan: TrailerPlan;
  shots: CastShot[];
  /** The music's pulse (pulse.ts), when the brief brought a track. Absent, the piece is exactly what it was. */
  pulse?: Pulse;
}> = ({ brief, hook, lang, format, session, plan, shots, pulse }) => {
  const color = useColor();
  const { frame, fps } = useFrame();
  const grid = gridOf(brief);
  const unit = Math.min(format.width, format.height) / 100;

  const win = castFrame(format, session.viewport, { isMobile: session.isMobile });
  const videoSec = trailerSourceAt(plan, session, frame, fps);
  const ms = videoSec * 1000;
  /* The beat, this frame. A trailer is wordless, so it dances at full gain. */
  const at = pulseAt(pulse, frame);

  const section = trailerSectionAt(plan, frame);
  /*
    On or off, on the frame. The depth used to blend over half a beat at every
    boundary so a card never popped; a card that does not pop is a card that arrives
    while the picture behind it is still moving, which is the softness this piece was
    losing its edges to. A card is a cut now, and the cut is declared.
  */
  const live = LIVE[section.kind];
  /*
    A card is the opposite polarity of the product's stage, and it moves.

    Both for the same reason: with the cards and the proofs on one ground, ninety per
    cent of every frame in the piece was the same colour, and scdet scored the cuts
    between them under its threshold — the review said a planned cut was not visible in
    the file, and it was right. A flipped ground is a cut nobody can miss and gives the
    piece its dark-light-dark rhythm; the two per cent of drift is what keeps a card from
    being a slide once its last word has landed.
  */
  const ground = live ? color : { ...color, paper: color.inverted.paper, ink: color.inverted.ink, muted: color.inverted.muted };
  /* And with a track, the type pumps with the kick: the same impulse the camera gets, on the card's scale. */
  const drift = (live ? 1 : 1 + 0.022 * ((frame - section.from) / Math.max(1, section.to - section.from))) * dancedScale(at);

  /*
    The camera, drawn exactly as the shot list decided it, and then punched by the beat.

    There used to be a per-format fudge here — half the push on a phone, fifteen per cent
    more on a vertical cut — reaching by hand for something `trailerShots` now measures:
    every framing is capped at `videoWhole`, the scale at which the recording is drawn 1:1
    in this format, so nothing is drawn past the file. The dance comes AFTER the transform
    and only ever punches in, so a framing that kept the recording's edge out still does.
  */
  const cam = cameraAt(shots, frame, grid.beatFrames);
  const zoom = dancedZoom(cameraTransform(cam), at);

  /* From frame 0 the picture is there: a feed shows the first frame as the poster, and a poster that is a backdrop is nothing. */
  const enter = interpolate(frame, [0, grid.beatFrames], [0.55, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  /*
    The press, on the timeline — the tutorial's device. It used to be aged on the recording's
    clock, `(ms - c.t) / 450`, which the proof's conform rate compresses and its hold past
    `sourceTo` freezes solid; the plan writes every press of a proof in composition frames
    and the pulse, the ring and the pointer's own give all read the same one.
  */
  const PRESS = Math.max(6, Math.round(fps * 0.45));
  const presses = section.kind === "proof" ? section.presses : [];
  const press = presses.map((p) => ({ p, age: (frame - p.frame) / PRESS })).find(({ age }) => age >= 0 && age < 1) ?? null;
  /* The pointer gives on the press frame and springs back over the next few. */
  const pressed = press ? (frame - press.p.frame < 2 ? (frame - press.p.frame + 1) / 2 : Math.exp(-(frame - press.p.frame - 2) / 3)) : 0;
  /* Cap's spring, not the tween: the pointer is on the click point half a second early, at rest. The proof is retimed, so it seeks by the recording's milliseconds. */
  const pointer = cursorAtMs(cursorPathOf(session, fps), session, fps, ms);

  const line = (id: string | undefined) => (id ? brief.lines.find((l) => l.id === id) : undefined);
  const kicker = textOf(hook, lang);
  const voice = (brief.params?.voice as TitleVoice) ?? "editorial";
  const big = titleSize(format, kicker);

  /* Typewriter for the status line: characters over the first two thirds of the section. */
  const typed = (text: string) => {
    const span = Math.max(1, (section.to - section.from) * 0.66);
    const n = Math.round(interpolate(frame, [section.from, section.from + span], [0, text.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
    return text.slice(0, n);
  };

  return (
    <AbsoluteFill style={{ background: ground.paper }}>
      {live ? <Backdrop barFrames={grid.barFrames} intensity={0.7} {...(pulse ? { pulse: { beat: at.beat, energy: at.energy } } : {})} /> : null}

      {live && (
        <ProductWindow
          format={format}
          take={session}
          win={win}
          videoSec={videoSec}
          zoom={zoom}
          enter={enter}
          tilt={cam.tilt}
          cursor={{ ...pointer, press: pressed }}
          ripple={press ? { x: press.p.x, y: press.p.y, age: press.age } : null}
        />
      )}

      <Stage format={format} style={{ transform: `scale(${drift.toFixed(4)})` }}>
        {/*
            A card's line lands on the frame of the cut — whole, all of it, at once.

            It used to arrive a word per tick, half a beat after the section began. Both
            halves of that were written for type over a moving picture: the wait was for
            the picture to settle, and the word-by-word rhythm reads as arrival only
            when there is something for the words to arrive ONTO. With the product cut
            away, the wait rendered as a black frame with nothing on it and the rhythm
            as one word sitting at the left of a line whose space was already reserved.
            The cut is the event; the line is what it delivers.
        */}
        {section.kind === "kicker" && (
          <Centered>
            <KineticTitle text={kicker} size={big} voice={voice} step={0} from={section.from} color={ground.ink} plate={false} />
          </Centered>
        )}
        {section.kind === "theme" && (
          <Centered>
            <KineticTitle text={textOf(line(section.id), lang)} size={Math.round(big * 0.62)} voice="plain" step={0} from={section.from} color={ground.ink} plate={false} />
          </Centered>
        )}
        {/* A claim is alone on the stage now, so it is set to the stage — not to the size the KICKER's word count asked for. */}
        {section.kind === "claim" && (
          <Centered>
            <KineticTitle text={textOf(line(section.id), lang)} size={cardSize(format, textOf(line(section.id), lang))} voice={voice} step={0} from={section.from} color={ground.ink} plate={false} />
          </Centered>
        )}
        {section.kind === "ticker" && (
          <Centered>
            {/* No plate: the ticker is on the stage, not over the product, so it has nothing to carry contrast against. */}
            <div style={{ fontFamily: mono, fontSize: Math.round(big * 0.55), color: ground.ink, textAlign: "center", letterSpacing: "0.02em" }}>
              {textOf(line(section.id), lang)}
            </div>
          </Centered>
        )}
        {section.kind === "status" && (
          <Centered>
            {/* The ink, not the accent: a swatch chosen to contrast the product's stage has no promise to keep on the opposite one. */}
            <div style={{ fontFamily: mono, fontSize: Math.round(big * 0.5), color: ground.ink, textAlign: "center", letterSpacing: "0.14em", textTransform: "uppercase" }}>
              {typed(textOf(line(section.id), lang))}
              <span style={{ opacity: Math.floor((frame - section.from) / 8) % 2 === 0 ? 1 : 0 }}>_</span>
            </div>
          </Centered>
        )}
        {section.kind === "end" && (
          <Centered>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: display, fontWeight: 900, fontSize: Math.round(big * 1.15), letterSpacing: "-0.03em", color: ground.ink, lineHeight: 1 }}>
                {wordmarkOf(kicker)}
              </div>
              {section.id && (
                <div style={{ marginTop: unit * 2.2, fontFamily: mono, fontSize: Math.round(big * 0.42), color: ground.muted, letterSpacing: "0.04em" }}>
                  {typed(textOf(line(section.id), lang))}
                </div>
              )}
            </div>
          </Centered>
        )}
      </Stage>
    </AbsoluteFill>
  );
};

const Centered: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4%" }}>
    <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>{children}</div>
  </div>
);
