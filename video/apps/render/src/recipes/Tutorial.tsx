/*
  The tutorial. "Tired of opening folders? Come with me and I'll show you."

  Everything else in this repository sells; this one teaches, and the two want
  opposite things. A sales cut is a montage — the camera punches on every click and
  the viewer is never asked to follow anything. A tutorial has a viewer who is trying
  to DO what they are watching, so the frame stays legible, the pushes are gentle,
  one thing is pointed at at a time, and the clock belongs to the narrator (see the
  Tutorial section of timing.ts, where the retiming lives).

  What is on screen, and why each piece is there:

  - THE COLD OPEN is a question, not a feature. The pain first, the product second —
    and only one of them at a time: the question has the frame to itself, and the
    window arrives on the beat the question ends. That arrival is "come with me". It
    used to sit behind the title the whole time, receded and softened, which asked the
    viewer to read a sentence and a screenshot at once.
  - THE STEP TITLE opens every step, with the frame to itself, and then the product
    has the frame to itself. That is the signaling principle — 103 studies, 12,201
    participants, retention g+ = 0.53 — and it is also the thing Guo, Kim & Rubin
    recommend from measuring 6.9 million viewing sessions: tutorials are scrubbed and
    re-watched rather than played through, and they ask for "visual signposts, such as
    big blocks of text to signify transitions" so the timeline is legible as a
    filmstrip. It used to be a chip laid OVER the picture, which said the same thing
    with the product underneath it — two things on one screen, and no signpost a
    scrubber can see. What is still NOT supported is the counter and the rail: the
    intuition that "people quit when they cannot tell how much is left" is folklore,
    and the controlled work runs against it — Matzat et al. (n=2,460) found
    progress-indicator effects on completion negative or absent, and Conrad et al.
    found early feedback implying slow progress raises abandonment. So the progress
    furniture stays opt-in per brief (`params.progress`), off by default. When it is
    on it reads `2/4`, never "2 steps" — a digit is never glued to a word that
    inflects.
  - THE CALLOUT is one ring, on the thing the sentence is about. Drawn on the content
    box after the camera transform, so it holds its size while the picture pushes in.
    It used to darken everything around it as well; that is a shadow, this film draws
    none, and a viewer following along in their own window needs the rest of the
    interface to still be there.
  - THE CAPTIONS are the argument, because most of this is watched muted. When no
    voice has been generated yet the step's sentence is shown as static type
    instead, so a tutorial is readable before it is audible.
  - THE RAIL, when a brief asks for it, is the whole piece's progress with a notch
    per step. It is the only element that knows the future, and the evidence above is
    why that is a choice rather than a default.
*/
import { AbsoluteFill, interpolate, useFrame } from "@panoma/video-engine";
import type { Brief, Format, Line } from "@panoma/video-core";
import type { SessionLog } from "@panoma/video-capture";
import { alphaOf } from "@panoma/video-brand/direction";
import { display, mono } from "../lib/fonts.ts";
import { Backdrop } from "../lib/Backdrop.tsx";
import { KineticCaptions, type Word } from "../lib/captions.tsx";
import { KineticTitle, type TitleVoice } from "../lib/KineticTitle.tsx";
import { ProductWindow } from "../lib/ProductWindow.tsx";
import { ElementBurst } from "../lib/ElementBurst.tsx";
import { Stage, captionSize, cardSize } from "../lib/layout.tsx";
import { useColor, useScrim } from "../lib/theme-context.tsx";
import {
  calloutRamp,
  cameraAt,
  cameraTransform,
  castFrame,
  gridOf,
  liftAt,
  projectPoint,
  tutorialSourceAt,
  tutorialStepAt,
  type CastShot,
  type TutorialPlan,
} from "./timing.ts";
import { cursorAtMs, cursorPathOf } from "./motion.ts";
import { dancedZoom, pulseAt, type Pulse } from "./pulse.ts";

const textOf = (line: Line, lang: string) => line.text[lang] ?? line.text[Object.keys(line.text)[0]] ?? "";

export const Tutorial: React.FC<{
  brief: Brief;
  hook: Line;
  lang: string;
  format: Format;
  session: SessionLog;
  /*
    The element a press is punctuated with, when the library has one.

    Optional and always has been: a film with no library is the film this recipe has always
    made, and the burst is punctuation on top of it rather than something it depends on.
  */
  burst?: { file: string; blend: "screen" | "multiply" };
  plan: TutorialPlan;
  shots: CastShot[];
  voiced?: { words: Word[] };
  /*
    The music's pulse, at the piece's level (compositions.tsx). A tutorial is words first,
    so what reaches it is already the light level: the lights breathe, the picture keeps a
    third of the punch, and nothing pumps under a sentence.
  */
  pulse?: Pulse;
}> = ({ brief, hook, lang, format, session, plan, shots, voiced, burst, pulse}) => {
  const color = useColor();
  const scrim = useScrim();
  const { frame, fps } = useFrame();
  const grid = gridOf(brief);
  const unit = Math.min(format.width, format.height) / 100;
  /* Captions are sized against the canvas, not the stage — see layout.tsx. */
  const cap = captionSize(format);

  const win = castFrame(format, session.viewport, { isMobile: session.isMobile });
  const videoSec = tutorialSourceAt(plan, session, frame, fps);
  const ms = videoSec * 1000;

  /*
    The camera, drawn exactly as the shot list decided it.

    There used to be a per-format fudge here — half the push on a phone, fifteen per cent
    more on a vertical cut — reaching by hand for something that is now measured: the
    recording is a 1x asset, so how far it may be pushed before it is an upscale depends on
    the size the format draws it at. `videoWhole` is that number and `tutorialShots` caps
    every framing with it, which is the same correction with a reason attached. A phone take
    arrives already magnified and its ceiling comes out below 1, so the camera declines to
    zoom rather than being told to halve.
  */
  const cam = cameraAt(shots, frame, grid.beatFrames);
  /* The beat, if a track was brought: a punch in on the kick, on top of whatever the camera is doing. */
  const beatNow = pulseAt(pulse, frame);
  const zoom = dancedZoom(cameraTransform(cam), beatNow);

  /* Off unless the brief asks: see the note above the component. */
  const progress = brief.params?.progress === true || brief.params?.progress === "on";
  const step = tutorialStepAt(plan, frame);
  const total = plan.steps.length;
  const line = step ? brief.lines.find((l) => l.id === step.id) : undefined;

  /*
    Three states, and never two of them at once: the question, the product, the closing
    card. The product is not on screen under either card — both are type, and type over a
    picture is two things asking for one eye. Captions are the exception, because a
    caption is the narration and the viewer needs it while the product is doing something.

    On the frame, not over a beat. The product used to sit behind the question the whole
    time, receded and softened, and come forward as the question faded; that put the two
    on screen together for exactly the beat this rule exists to prevent, and the arrival
    reads harder as a cut anyway. The question ends, and the product is there.
  */
  const asking = frame < plan.hookFrames;
  const closing = frame >= plan.outroFrom;
  /* A step's own title, with the frame to itself, before the product gets it back. */
  const titling = step !== null && frame < step.cardTo;
  const onScreen = !asking && !closing && !titling ? 1 : 0;
  /* The title names the step alone; captions begin when the product gets the frame. */
  const captioned = onScreen === 1;
  /*
    The CLOSING card is the opposite polarity, as it is in the trailer and the spotlight.
    The cold open is not, and the reason is the poster: a feed shows the first frame of a
    piece as its thumbnail, and flipping the question onto a dark ground made the first
    frame of a light product's tutorial a black one (mean luma 36, `video.firstframe`).
    An ending may change the ground. A beginning is the first thing anyone sees of the
    product, so it keeps the product's — and the cut out of it still reads, because the
    card carries the sentence once now instead of once as type and again as a caption.
  */
  const inverted = { ...color, paper: color.inverted.paper, ink: color.inverted.ink, muted: color.inverted.muted, accent: color.inverted.ink };
  const ground = closing || titling ? inverted : color;
  /* From frame 0 the picture is there: a feed shows the first frame as the poster, and a poster that is a backdrop is nothing. */
  const enter = interpolate(frame, [0, grid.beatFrames], [0.55, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const whip = cam.enter === "whip" ? 1 - cam.entering : 0;
  const closingText = brief.lines
    .filter((l) => !l.mark)
    .map((l) => textOf(l, lang))
    .join(" ");

  /*
    The press, on the timeline. It used to be found on the recording's clock — `(ms - c.t) /
    450` — which a retimed picture compresses to a flicker or freezes solid; the plan now
    writes every press of the step in composition frames, and the pulse, the ring and the
    pointer's own give all read the same one. Just under a beat is its whole life: the pulse
    is over inside the first two thirds of that, the ring runs to the end.
  */
  const PRESS = Math.max(6, Math.round(fps * 0.45));
  const press = step?.presses.map((p) => ({ p, age: (frame - p.frame) / PRESS })).find(({ age }) => age >= 0 && age < 1) ?? null;
  /* The pointer gives on the press frame and springs back over the next few. */
  const pressed = press ? (frame - press.p.frame < 2 ? (frame - press.p.frame + 1) / 2 : Math.exp(-(frame - press.p.frame - 2) / 3)) : 0;
  /*
    The pointer: Cap's spring, not a tween. `cursorAt` eased between the logged glide ends
    and arrived WITH the click, which a viewer reads as the machine doing it; `cursorPath`
    sits the pointer on the click point half a second early, at rest, and drops the tremor
    a hand would have left. The path is one array per take (see motion.ts), and a tutorial
    seeks it by the recording's own milliseconds because its picture is retimed.
  */
  const pointer = cursorAtMs(cursorPathOf(session, fps), session, fps, ms);

  /*
    The callout lives for the sentence, not for the shot: it arrives a tick after the
    step starts — late enough that the viewer has seen the cut — and leaves a beat
    before the step ends, so the frame is clean when the next one arrives.
  */
  const spot = step ? calloutRamp(frame, Math.max(step.calloutFrom, step.cardTo + grid.tickFrames), step.calloutTo, grid.beatFrames) : 0;
  /*
    Depth, from geometry we measured rather than depth we inferred.

    The control the step is about is lifted onto its own plane in front of the page — the
    product's own pixels at the density the page rendered them, moving a little faster than
    everything behind it as the camera pushes. It is the one cue in this film that says
    "this is a space and not a picture", and it costs nothing: the asset has been written by
    every take for months.

    Not on a scroll: a scroll is the whole page moving, and there is nothing in front of it.
  */
  const lift =
    step && step.kind === "click" && !titling && !closing
      ? liftAt({
          macros: session.macros,
          mark: step.mark,
          frame,
          from: step.cardTo,
          /*
            What the press does to the page decides how long the plane lives, and `liftAt`
            decides it from the macro. A macro is the control as it looked AT its mark, so
            after a press that navigated the lifted copy is a picture of a screen that is no
            longer under it — the first render of this held the catalog's project tile in the
            air over the project page it had just opened — and the plane is taken down before
            the control is touched. But most presses do not navigate, and for those the take
            re-rendered the same box on the frame after (`afterControl`): the plane swaps to
            it on the press frame and stays through the push and the hold, which is where the
            camera is closest and the pixels behind it are giving up the most.

            `pressAt` is the step's own press. It used to be derived as a beat back from
            `settleFrom`, a beat past the segment's LAST action — on a step that clicks and
            then scrolls, three seconds too late.
          */
          to: step.to,
          pressAt: step.pressAt,
          settled: step.stableTo >= step.to,

          beatFrames: grid.beatFrames,
          tickFrames: grid.tickFrames,
          focus: { fx: step.fx, fy: step.fy },
          pageWidthPx: win.content.width * zoom.scale,
          viewportWidth: session.viewport.width,
        })
      : null;
  const point = step ? projectPoint(zoom, step.fx, step.fy) : { x: 0.5, y: 0.5 };
  /* A scroll has no point to ring — it is the whole page moving. */
  const rings = step?.kind === "click" && spot > 0.02 && !titling;
  const ringSize = unit * (format.id === "h" ? 7 : 9);

  /* Keys the product was sent during this step, drawn as caps. */
  const keys = step
    ? session.events.filter(
        (e): e is Extract<typeof e, { kind: "key" }> =>
          e.kind === "key" && e.t >= step.sourceFrom * 1000 && e.t < step.sourceTo * 1000,
      )
    : [];

  return (
    <AbsoluteFill style={{ background: ground.paper }}>
      {closing || titling ? null : <Backdrop barFrames={grid.barFrames} {...(pulse ? { pulse: { beat: beatNow.beat, energy: beatNow.energy } } : {})} />}

      <ProductWindow
        format={format}
        take={session}
        win={win}
        videoSec={videoSec}
        zoom={zoom}
        enter={enter * onScreen}
        whip={whip}
        {...(lift ? { lift } : {})}
        cursor={{ ...pointer, press: pressed }}
        ripple={press ? { x: press.p.x, y: press.p.y, age: press.age } : null}

        over={
          rings ? (
            <>
              {/* One ring, on the thing the sentence is about.

                  It used to sit inside a darkened surround — everything but the
                  subject dimmed by a radial gradient. That is a shadow drawn around
                  the product, which this film no longer does anywhere, and the ring
                  alone answers "which one am I supposed to look at" without taking
                  the rest of the interface away from a viewer who is trying to
                  follow along in their own window. */}
              <div
                style={{
                  position: "absolute",
                  left: `${(point.x * 100).toFixed(3)}%`,
                  top: `${(point.y * 100).toFixed(3)}%`,
                  width: ringSize,
                  height: ringSize,
                  marginLeft: -ringSize / 2,
                  marginTop: -ringSize / 2,
                  borderRadius: "50%",
                  border: `${Math.max(2, unit * 0.35)}px solid ${color.accent}`,
                  opacity: spot,
                  transform: `scale(${interpolate(spot, [0, 1], [1.35, 1]).toFixed(3)})`,
                }}
              />
            </>
          ) : null
        }
      />

      <Stage format={format}>
        {/*
          The step's title, alone on the frame.

          It replaces a chip that used to sit over the picture in the top-left corner. The
          chip was legible and it was wrong: it put a label and a moving interface on one
          screen, and a viewer dragging the scrubber saw no boundary at all — which is how
          most of a tutorial is actually watched. The card is the boundary, and it is the
          opposite polarity of the shots on either side of it, so the cut is a cut and not
          a caption appearing.

          The counter, when a brief asks for one, rides the card rather than the product.
        */}
        {titling && step && (
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
            {(() => {
              const label = line?.label?.[lang] ?? "";
              const span = Math.max(1, step.cardTo - step.from);
              const local = frame - step.from;
              /*
                And it moves, by two per cent across its length. A card that is a perfect
                freeze is a slide, and the review counts it as duplicate frames — rightly.
                The house rule that type does not move once it has landed is about type
                laid OVER a picture; here the type IS the picture.
              */
              const drift = 1 + 0.02 * Math.min(1, Math.max(0, local / span));
              return (
                <div style={{ width: "100%", textAlign: "center", transform: `scale(${drift.toFixed(4)})` }}>
                  {progress && (
                    <div
                      style={{
                        fontFamily: mono,
                        fontSize: cap * 0.62,
                        letterSpacing: "0.06em",
                        color: inverted.accent,
                        fontVariantNumeric: "tabular-nums",
                        marginBottom: cap * 0.5,
                      }}
                    >
                      {step.index}/{total}
                    </div>
                  )}
                  <KineticTitle
                    text={label}
                    size={cardSize(format, label)}
                    voice={(brief.params?.voice as TitleVoice) ?? "editorial"}
                    step={0}
                    from={step.from}
                    color={inverted.ink}
                    plate={false}
                  />
                  {/* The accent rule that grows under a title: a bar of light, not a glowing one. */}
                  <div
                    style={{
                      width: interpolate(local, [0, grid.beatFrames * 2], [unit * 2, unit * 14], {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                      }),
                      height: Math.max(3, unit * 0.4),
                      margin: `${unit * 3}px auto 0`,
                      borderRadius: 999,
                      background: inverted.accent,
                    }}
                  />
                </div>
              );
            })()}
          </AbsoluteFill>
        )}

        {/* Keycaps: what was typed, while it is being typed. */}
        {keys.length > 0 && step && spot > 0.02 && onScreen === 1 && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${cap * 1.7}px`,
              display: "flex",
              justifyContent: "center",
              gap: cap * 0.18,
              opacity: spot,
            }}
          >
            {keys.map((k, i) => (
              <span
                key={i}
                style={{
                  fontFamily: mono,
                  fontSize: cap * 0.55,
                  color: color.ink,
                  background: color.card,
                  border: `1px solid ${color.line}`,
                  borderRadius: cap * 0.15,
                  padding: `${cap * 0.12}px ${cap * 0.26}px`,
                }}
              >
                {k.text}
              </span>
            ))}
          </div>
        )}

        {/* The cold open: the promise, said. Nothing else is on screen while it is. */}
        {asking && (
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
            <KineticTitle
              text={textOf(hook, lang)}
              size={cardSize(format, textOf(hook, lang))}
              voice={(brief.params?.voice as TitleVoice) ?? "editorial"}
              step={0}
              from={0}
              color={ground.ink}
              plate={false}
            />
          </AbsoluteFill>
        )}

        {/* The closing card: the product has cut away, and the words have the frame. */}
        {closing && (
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
            <KineticTitle
              text={closingText}
              size={cardSize(format, closingText)}
              voice={(brief.params?.voice as TitleVoice) ?? "editorial"}
              step={0}
              from={plan.outroFrom}
              color={ground.ink}
              plate={false}
            />
          </AbsoluteFill>
        )}

        {/*
          Word by word if there is a voice to follow; the sentence itself if not — and
          only while the product is on screen. Over a card the narration is ALREADY the
          type in the middle of the frame, so a caption of the same sentence at 80% height
          was the same words twice, which is the plainest form of the thing this piece
          stopped doing: two things on one screen.
        */}
        {!captioned ? null : voiced ? (
          <KineticCaptions words={voiced.words} at={0.8} size={cap} />
        ) : (
          step &&
          line && (
            <div
              style={{ position: "absolute", left: 0, right: 0, bottom: cap * 0.8, display: "flex", justifyContent: "center" }}
            >
              <div
                style={{
                  /*
                    The silent fallback wears the caption's own chip: same width, same
                    density, same corner. At 94% and 0.62 it was a translucent band across
                    a third of the frame with the product legible through it — which is
                    the plate failing at the one job a plate has.
                  */
                  maxWidth: "78%",
                  textAlign: "center",
                  fontFamily: display,
                  fontWeight: 800,
                  fontSize: cap * 0.86,
                  lineHeight: 1.2,
                  color: color.ink,
                  background: scrim(0.78),
                  padding: `${cap * 0.28}px ${cap * 0.55}px`,
                  borderRadius: cap * 0.35,
                }}
              >
                {textOf(line, lang)}
              </div>
            </div>
          )
        )}

        {/* The rail: how much is left, and where the steps are. */}
        {progress && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: Math.max(4, cap * 0.11),
            borderRadius: cap * 0.06,
            background: alphaOf(ground.ink, 0.18),
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${((frame / plan.durationInFrames) * 100).toFixed(2)}%`,
              background: ground.accent,
            }}
          />
          {plan.steps.map((s) => (
            <div
              key={s.id}
              style={{
                position: "absolute",
                left: `${((s.from / plan.durationInFrames) * 100).toFixed(2)}%`,
                top: 0,
                bottom: 0,
                width: Math.max(2, cap * 0.04),
                background: ground.paper,
              }}
            />
          ))}
        </div>
        )}
      </Stage>

      {/*
        The press, as a physical event.

        Anchored to the PRESS FRAME, not to the ripple. The ripple lives in the recording's
        clock — 450 ms after a click — and a tutorial does not play the recording at its own
        speed: it runs at `playRate` and then freezes at `sourceTo` while the narrator
        finishes. So those 450 ms compress to a handful of frames, or fall inside the frozen
        stretch and never advance at all, and the burst either flickers or never fires. It
        did not fire, and that is how this was found.

        `settleFrom` is a beat past the action, so a beat back from it is the press itself —
        the same anchor the lift uses to be gone before it. One beat of element, and it is
        over.

        It sits outside the window and over everything, because a blend has to see the frame
        it is blending with: inside the window's own transform it would blend against the
        page's white and disappear.
      */}
      {burst && step && step.kind === "click" && !titling && !closing && (() => {
        const press = step.pressAt;
        const life = (frame - press) / grid.beatFrames;
        if (life < 0 || life >= 1) return null;
        const where = projectPoint(zoom, step.fx, step.fy);
        const inFrame = {
          x: (win.x + win.content.x + where.x * win.content.width) / format.width,
          y: (win.y + win.content.y + where.y * win.content.height) / format.height,
        };
        if (inFrame.x < 0 || inFrame.x > 1 || inFrame.y < 0 || inFrame.y > 1) return null;
        return (
          <ElementBurst
            file={burst.file}
            blend={burst.blend}
            at={inFrame}
            size={format.width * 0.42}
            /* The element's own clock: its first half-second is where the event happens. */
            second={life * 0.55}
            opacity={Math.min(1, (1 - life) * 2.2)}
          />
        );
      })()}
    </AbsoluteFill>
  );
};
