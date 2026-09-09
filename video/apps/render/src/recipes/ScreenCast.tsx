/*
  The beautifier, done our way. Screen Studio bakes a hand-moved cursor into pixels
  and re-records every UI change by hand; here the material is a scripted session of
  the real product, the cursor is drawn by the renderer from the input log (eased,
  never shaky), and the auto-zoom attacks on the musical beat because the plan is
  arithmetic in timing.ts. Change the product, run `panoma-video record`, render again —
  identical take, new UI.

  THE FRAME IS THE PRODUCT'S, NOT THE TYPE'S. The first version reserved flow space
  for a hook and a caption and gave the recording whatever was left: 25% of a 9:16
  canvas, a stamp in an empty frame. Now `castFrame` spends the canvas on the
  recording and the words float on top of it. A mobile take wears a device bezel; a
  desktop take wears a browser bar — see ProductWindow, shared with Tutorial.

  BUT THE WORDS STILL LIVE INSIDE THE SAFE RECTANGLE. The correction after that:
  floating type was first placed in the platform's margins on a gradient, which
  confuses two different problems. A scrim solves contrast; it does nothing about
  the platform painting its own caption and action rail over that strip. So type
  is laid out through `Stage` like every other recipe — inside the safe rectangle,
  where nothing covers it — and carries a plate for contrast over a bright product,
  the same device the kinetic captions use.
*/
import { AbsoluteFill, interpolate, useFrame } from "@panoma/video-engine";
import type { Brief, Format, Line } from "@panoma/video-core";
import type { SessionLog } from "@panoma/video-capture";
import { display } from "../lib/fonts.ts";
import { Backdrop } from "../lib/Backdrop.tsx";
import { KineticTitle, type TitleVoice } from "../lib/KineticTitle.tsx";
import { ProductWindow } from "../lib/ProductWindow.tsx";
import { Stage, captionSize, titleSize } from "../lib/layout.tsx";
import { useColor, useScrim, useVeil } from "../lib/theme-context.tsx";
import { cameraAt, cameraTransform, castFrame, castSpeed, eventFrame, gridOf, type CastEvent, type CastPlan, type CastShot } from "./timing.ts";
import { cursorAtFrame, cursorPathOf } from "./motion.ts";
import { dancedZoom, pulseAt, type Pulse } from "./pulse.ts";

export const ScreenCast: React.FC<{
  brief: Brief;
  hook: Line;
  lang: string;
  format: Format;
  session: SessionLog;
  plan: CastPlan;
  shots: CastShot[];
  /** The music's pulse (pulse.ts), when the brief brought a track. Absent, the piece is exactly what it was. */
  pulse?: Pulse;
}> = ({ brief, hook, lang, format, session, plan, shots, pulse }) => {
  const color = useColor();
  const scrim = useScrim();
  const { pop } = useVeil();
  const { frame, fps } = useFrame();
  const grid = gridOf(brief);
  const cap = captionSize(format);

  const win = castFrame(format, session.viewport, { isMobile: session.isMobile });
  /*
    Seek past the blank head, and play the take conformed to the timeline so every
    rendered frame gets its own source frame instead of repeating one every sixth.
  */
  const ready = (session.readyMs ?? 0) / 1000;
  const rate = castSpeed(session, fps);
  const videoSec = Math.min(
    ready + Math.max(0, (frame - plan.videoStart) / fps) * rate,
    session.durationMs / 1000 - 1 / fps,
  );

  /*
    The camera, drawn exactly as the shot list decided it, and then punched by the beat.

    There used to be a per-format fudge here — half the push on a phone, fifteen per cent
    more on a vertical cut — reaching by hand for something `castShots` now measures: every
    framing is capped at `videoWhole`, the scale at which the recording is drawn 1:1 in this
    format, so nothing is drawn past the file. The dance comes AFTER the transform and only
    ever punches in; under a narration it keeps a third of itself, because the words are
    what the viewer is there for.
  */
  const at = pulseAt(pulse, frame);
  const cam = cameraAt(shots, frame, grid.beatFrames);
  const zoom = dancedZoom(cameraTransform(cam), at);

  /* Transitions ride the first half-beat of a shot. */
  const arriving = 1 - cam.entering;
  const whip = cam.enter === "whip" ? arriving : 0;
  const flash = cam.enter === "flash" ? arriving : 0;

  /*
    The press, on the timeline. The cast plays its take linearly, so `(ms - c.t) / 450` was
    only ever wrong by the conform rate — a fifth short on a 25 fps take — but the tutorial
    and the trailer age their presses in composition frames, and one clock for the pulse,
    the ring and the pointer's give is the point. `eventFrame` is that mapping. Chrome earns
    nothing here either: a consent click gets no ripple, as it gets no punch.
  */
  const PRESS = Math.max(6, Math.round(fps * 0.45));
  const presses = session.events
    .filter((e): e is Extract<CastEvent, { kind: "click" }> => e.kind === "click" && e.role !== "chrome")
    .map((e) => ({ frame: eventFrame(session, plan, fps, e.t), x: e.x, y: e.y }));
  const press = presses.map((p) => ({ p, age: (frame - p.frame) / PRESS })).find(({ age }) => age >= 0 && age < 1) ?? null;
  /* The pointer gives on the press frame and springs back over the next few. */
  const pressed = press ? (frame - press.p.frame < 2 ? (frame - press.p.frame + 1) / 2 : Math.exp(-(frame - press.p.frame - 2) / 3)) : 0;
  /*
    Cap's spring, not the tween. The path is one point per conformed timeline frame of the
    take — the very mapping `videoSec` above applies — so the cast indexes it by frame, with
    no interpolation to do: `frame - videoStart` IS the path's index, and before the take
    starts it clamps to the pointer at rest.
  */
  const pointer = cursorAtFrame(cursorPathOf(session, fps), frame - plan.videoStart);

  /* The window arrives on the first beat rather than fading in from nothing. */
  /* From frame 0 the picture is there: a feed shows the first frame as the poster, and a poster that is a backdrop is nothing. */
  const enter = interpolate(frame, [0, grid.beatFrames], [0.55, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const hookOut = interpolate(frame, [grid.bar(2) - 10, grid.bar(2)], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: color.paper }}>
      <Backdrop barFrames={grid.barFrames} {...(pulse ? { pulse: { beat: at.beat, energy: at.energy } } : {})} />

      <ProductWindow
        format={format}
        take={session}
        win={win}
        videoSec={videoSec}
        zoom={zoom}
        enter={enter}
        whip={whip}
        tilt={cam.tilt}
        /* A phone has no cursor. On a mobile take the pointer is never drawn — only
           the tap blooms where a finger landed, wider and softer than a mouse click,
           because that is the whole visual vocabulary a touch device has. */
        cursor={{ ...pointer, press: pressed }}
        ripple={press ? { x: press.p.x, y: press.p.y, age: press.age } : null}
      />

      {flash > 0.02 && (
        <AbsoluteFill style={{ background: pop(flash * 0.55) }} />
      )}

      {/* The words live over the product, but inside the rectangle the platform
          leaves alone — Stage is that rectangle. */}
      <Stage format={format}>
        {hookOut > 0 && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              display: "flex",
              justifyContent: "center",
              opacity: hookOut,
            }}
          >
            <KineticTitle
              text={hook.text[lang]}
              size={titleSize(format, hook.text[lang])}
              voice={(brief.params?.voice as TitleVoice) ?? "editorial"}
              step={grid.tickFrames * 2}
              from={grid.beatFrames}
            />
          </div>
        )}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, display: "flex", justifyContent: "center" }}>
          <div
            style={{
              maxWidth: "94%",
              textAlign: "center",
              fontFamily: display,
              fontWeight: 800,
              fontSize: cap,
              letterSpacing: "0.01em",
              color: color.ink,
              background: scrim(0.62),
              padding: `${cap * 0.3}px ${cap * 0.6}px`,
              borderRadius: cap * 0.36,
            }}
          >
            {brief.lines[0]?.text[lang] ?? ""}
          </div>
        </div>
      </Stage>
    </AbsoluteFill>
  );
};
