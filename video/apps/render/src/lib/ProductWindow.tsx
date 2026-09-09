/*
  The frame the product is shown in, and everything that lives inside it.

  Both recipes that play a recorded take draw the same object — a browser window or
  a phone, a recording inside it, a synthetic cursor, the bloom of a click — and they
  disagree only about WHEN to move the camera. Keeping the window here means the
  traps it carries are paid for once: the inset shadow that a `border` would turn
  into a crop, the device bezel that wraps four sides where a browser bar steals only
  height, and the rule that a phone take never draws a mouse pointer because a phone
  does not have one.

  Overlays come in two kinds and the distinction matters. `inside` is painted within
  the camera's transform, so it travels and scales with the picture — that is where
  anything anchored to a pixel of the product belongs. `over` is painted on the
  content box after the transform, at constant size: callouts, spotlights and
  keycaps, which must stay legible while the camera pushes in.
*/
import type { ReactNode } from "react";
import { interpolate, sessionAsset } from "@panoma/video-engine";
import type { Format } from "@panoma/video-core";
import { SCENE_MATERIALS } from "@panoma/video-core/theme";
import { mono } from "./fonts.ts";
import { useColor, useInkAlpha, useVeil } from "./theme-context.tsx";
import type { CastFrame } from "../recipes/timing.ts";

/*
  A region of the page that is genuinely IN FRONT of it, drawn on its own plane.

  This is the one thing in a product film that a generative model cannot do and a
  compositor cannot fake, and the material for it has been on disk for months: `MacroAsset`
  is the control the take clicked, rasterized by Chromium itself at up to eight device
  pixels per CSS pixel, with its rectangle in the recording's own coordinates. So the depth
  is not estimated from contrast the way a monocular depth model would estimate it — which
  is how a flat interface ends up bowed, with skewed panel edges. It is READ, from the DOM
  geometry of the thing that was actually pressed.

  Two cues do the work, and both are free:

  PARALLAX. The plane grows faster than the page under it as the camera pushes. Critically
  the differential is a function of `scale - 1`, so at rest it is exactly zero and the copy
  sits precisely over its own source: any constant offset would show as a doubled edge on
  every frame the camera happens to be still.

  SHARPNESS. The page is a video, and a video pushed into softens. This plane is a PNG at
  the density the page rendered it, so it stays crisp while everything behind it gives up
  detail — which is what a viewer reads as "this is nearer". `ratio` is the ceiling the
  capture documents, and `liftAt` refuses a lift that would ask for more than it.
*/
export type Lifted = {
  /** The crop's rect, in the recording's own CSS pixels. */
  box: { x: number; y: number; width: number; height: number };
  /** The product's own pixels for that rect. */
  file: string;
  /** Screenshot pixels per CSS pixel: how far this may be drawn up, and no further. */
  ratio: number;
  /** 0..1 of how far in front, ramped by the caller so the plane arrives and leaves. */
  depth: number;
};

/*
  How much faster a fully-lifted plane grows than the page behind it, per unit of push.

  Small on purpose. Parallax is read long before it is noticed: past about a tenth the
  plane stops looking nearer and starts looking like a sticker sliding on glass, which is
  the exact failure the generated plate had and the reason this is arithmetic with a
  constant rather than a taste setting.
*/
export const LIFT_GAIN = 0.085;

/*
  And how much push the gain is applied to, at most. The gain was set when a push reached
  1.58 at the very most, where it moves a plane by five per cent; a take at the device pixels
  lets the camera close to 2.6, and the same gain there is a plane a seventh bigger
  than the pixels it covers, which is the sticker. So the differential grows with the push
  up to this much of it and then holds: past 1.6 the plane is as far in front as it gets.
*/
export const LIFT_REACH = 0.6;

export type WindowTake = {
  video: string;
  url: string;
  viewport: { width: number; height: number };
  /*
    Where the product was at each mark. The address bar follows these rather than the
    one address the take opened at: in a tutorial the viewer is being walked somewhere,
    and a bar that still reads "/" three screens later is furniture pretending to be
    information. Older takes have none, and then the bar says where the take started.
  */
  frames?: { t: number; url: string }[];
};

/*
  What the address bar says.

  A film is shot against whatever instance was running, and on this machine that is a
  loopback address with a port the operating system handed out — `127.0.0.1:4173`, which
  is true, is not where any viewer will ever be, and is the single clearest tell that a
  product film was made on somebody's laptop. The repository already treats a loopback
  origin as an artefact rather than a fact: `panoma-video auto` collapses it to a word before it
  reaches a cache key, for the same reason.

  So the host is dropped when it is one, and the PATH is kept — which is the half a
  viewer following along actually needs, because it says where in the product they are.
  A real host is shown as it is: that one is a fact about the film.
*/
export function addressOf(url: string): string {
  try {
    const u = new URL(url);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]" || u.hostname === "0.0.0.0";
    return local ? u.pathname + u.search : u.host + (u.pathname === "/" ? "" : u.pathname) + u.search;
  } catch {
    return url.replace(/^https?:\/\//, "");
  }
}

export const ProductWindow: React.FC<{
  format: Format;
  take: WindowTake;
  win: CastFrame;
  /** Recorded pixels and browser chrome are outside editorial DOM layout checks. */
  lint?: "ignore";
  /** Second of the recording to paint. */
  videoSec: number;
  /** Camera, as fractions of the content box (see cameraTransform). */
  zoom: { scale: number; dx: number; dy: number };
  /** 0..1 arrival of the window itself. */
  enter: number;
  /** 0..1 lateral kick of a whip transition. */
  whip?: number;
  /** Degrees of pose. */
  tilt?: { rx: number; ry: number };
  /*
    Planes in front of the page, and where the camera is looking so they can move against
    it. Without a focus a lift has nothing to be parallax RELATIVE to.
  */
  lift?: { planes: Lifted[]; focus: { fx: number; fy: number } };
  /*
    The pointer, and how far it is pressed: 0..1 of a squash that lands on the press frame
    and springs back. A pointer that does not move when the button under it is pushed is a
    pointer drawn over the film rather than in it.
  */
  cursor?: { x: number; y: number; press?: number } | null;
  /*
    A press: source coordinates plus 0..1 of its life. On the TIMELINE — a tutorial retimes
    its footage, so a life measured in the recording's milliseconds compresses to a flicker
    or freezes with the picture (see TutorialStep.presses).
  */
  ripple?: { x: number; y: number; age: number } | null;

  /** Pushed back — the product waiting behind a title card. */
  recede?: number;
  /*
    0..1 of scrim over the whole window.

    Depth is spent on dim rather than blur on purpose: in a software video a blurred
    REGION means redaction — it is what every documentation tool uses to hide a
    credential — so heavy blur teaches the viewer that something is being kept from
    them. A little softening still reads as focus; the dim does the work.
  */
  dim?: number;
  inside?: ReactNode;
  over?: ReactNode;
}> = ({ format, take, win, lint, videoSec, zoom, enter, whip = 0, tilt = { rx: 0, ry: 0 }, lift, cursor, ripple, recede = 0, dim = 0, inside, over }) => {
  const color = useColor();
  const inkAlpha = useInkAlpha();
  const { ground, pop } = useVeil();

  const unit = Math.min(format.width, format.height) / 100;
  const device = win.chrome === "device";
  /* The last address the recording reached at or before this frame. */
  const arrived = (take.frames ?? []).filter((f) => f.t <= videoSec * 1000).sort((a, b) => a.t - b.t).pop();
  const address = addressOf(arrived?.url ?? take.url);
  const vw = take.viewport.width;
  const vh = take.viewport.height;

  const cursorSize = (unit * (format.id === "h" ? 1.5 : 2)) / zoom.scale;
  const tapSize = cursorSize * 2.6;

  return (
    <div
      data-lint={lint}
      style={{
        position: "absolute",
        left: win.x,
        top: win.y,
        width: win.width,
        height: win.height,
        borderRadius: win.radius,
        overflow: "hidden",
        background: device ? SCENE_MATERIALS.deviceBody : color.card,
        /* Depth, rationed: a degree or two of pose per shot, plus the whip's
           lateral kick. Enough that the frame has a physical presence, not so
           much that the product looks like a mockup on a slide. */
        transform:
          `perspective(${format.width * 2.4}px)` +
          ` rotateX(${tilt.rx.toFixed(2)}deg) rotateY(${tilt.ry.toFixed(2)}deg)` +
          ` translateX(${(whip * unit * 5).toFixed(2)}px)` +
          ` scale(${(interpolate(enter, [0, 1], [0.985, 1]) * (1 - recede * 0.06)).toFixed(4)})`,
        transformStyle: "preserve-3d",
        filter:
          recede > 0.02
            ? `blur(${(recede * unit * 0.22).toFixed(2)}px)`
            : whip > 0.02
              ? `blur(${(whip * unit * 0.5).toFixed(2)}px)`
              : undefined,
        /* Inset rather than `border`: with box-sizing: border-box a border shrinks
           the padding box, clipping the recording and skewing the bezel. It is the
           only box-shadow left in the render, and it is a bezel, not a shadow: the
           window is not lifted off the stage by a dark blur under it. */
        boxShadow: `inset 0 0 0 ${Math.max(1, unit * 0.12)}px ${device ? SCENE_MATERIALS.deviceBezel : color.line}`,
        opacity: enter,
      }}
    >
      {!device && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: win.chromeSize,
            background: color.card,
            display: "flex",
            alignItems: "center",
            gap: win.chromeSize * 0.22,
            paddingLeft: win.chromeSize * 0.4,
          }}
        >
          {SCENE_MATERIALS.windowControls.map((dot) => (
            <span
              key={dot}
              style={{ width: win.chromeSize * 0.2, height: win.chromeSize * 0.2, borderRadius: "50%", background: dot }}
            />
          ))}
          {address && (
            <span
              style={{
                marginLeft: win.chromeSize * 0.3,
                fontFamily: mono,
                fontSize: win.chromeSize * 0.34,
                color: color.muted,
              }}
            >
              {address}
            </span>
          )}
        </div>
      )}

      {/* The recording. Zoom transforms this whole inner world, so the video, the
          cursor and the ripple travel together and the focus point stays honest. */}
      <div
        style={{
          position: "absolute",
          left: win.content.x,
          top: win.content.y,
          width: win.content.width,
          height: win.content.height,
          overflow: "hidden",
          borderRadius: device ? win.radius * 0.72 : 0,
          background: SCENE_MATERIALS.recordingMatte,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `translate(${(zoom.dx * 100).toFixed(3)}%, ${(zoom.dy * 100).toFixed(3)}%) scale(${zoom.scale})`,
            transformOrigin: "center center",
          }}
        >
          <canvas
            data-video={sessionAsset(take.video)}
            data-seek={videoSec.toFixed(4)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          />
          {/*
            Under the pointer and the press marks, not over them. The planes are opaque copies
            of the page, and once one stays through the press (afterControl) it would paint over
            the pulse, the ring and the pointer that is pressing it — the first render of that
            showed a control being pressed by nothing.
          */}
          {/*
            The lifted planes, inside the camera's world so they travel with it, and each
            scaled about the point the camera is looking at. That origin is what makes this
            parallax rather than a zoom: a plane off to the side of the focus slides across
            the frame as it grows, and a plane on the focus only grows.
          */}
          {lift?.planes.map((plane) => {
            const gap = 1 + plane.depth * Math.min(LIFT_REACH, Math.max(0, zoom.scale - 1)) * LIFT_GAIN;

            return (
              <div
                key={plane.file}
                style={{
                  position: "absolute",
                  inset: 0,
                  transform: `scale(${gap.toFixed(5)})`,
                  transformOrigin: `${(lift.focus.fx * 100).toFixed(3)}% ${(lift.focus.fy * 100).toFixed(3)}%`,
                }}
              >
                <img
                  src={sessionAsset(plane.file)}
                  alt=""
                  style={{
                    position: "absolute",
                    left: `${((plane.box.x / vw) * 100).toFixed(3)}%`,
                    top: `${((plane.box.y / vh) * 100).toFixed(3)}%`,
                    width: `${((plane.box.width / vw) * 100).toFixed(3)}%`,
                    height: `${((plane.box.height / vh) * 100).toFixed(3)}%`,
                    opacity: plane.depth,
                  }}
                />
              </div>
            );
          })}
          {cursor && !device && (
            <div
              style={{
                position: "absolute",
                left: `${((cursor.x / vw) * 100).toFixed(3)}%`,
                top: `${((cursor.y / vh) * 100).toFixed(3)}%`,
                width: cursorSize,
                height: cursorSize,
                marginLeft: -cursorSize / 2,
                marginTop: -cursorSize / 2,
                borderRadius: "50%",
                background: inkAlpha(0.95),
                border: `${Math.max(1.5, cursorSize * 0.13)}px solid ${ground(0.55)}`,
                /* Pressed, it gives by a seventh and comes back: the one motion a pointer has of its own. */
                transform: `scale(${(1 - 0.14 * Math.min(1, Math.max(0, cursor.press ?? 0))).toFixed(3)})`,
              }}
            />
          )}

          {ripple &&
            (() => {
              /*
                A press is two things, and both are short. The PULSE is a soft disc of the
                veil's pop — the light the house keeps for a pressed control, see
                theme-context — that blooms under the pointer and is gone inside the first two
                thirds of the press: the 200–300 ms, low-opacity confirmation every guide on
                screen recording asks for, and none of the trails or sparkles they warn
                against. The RING is the ink line that runs on to the end, thinner than it
                was, because the pulse now carries the moment and the ring only has to say
                where.
              */
              const pulseAge = Math.min(1, ripple.age / 0.65);
              const pulse = device ? tapSize * (0.55 + pulseAge * 0.9) : cursorSize * (1.2 + pulseAge * 1.8);
              const size = device ? tapSize * (0.55 + ripple.age * 0.9) : cursorSize * (1 + ripple.age * 4);
              const at = { left: `${((ripple.x / vw) * 100).toFixed(3)}%`, top: `${((ripple.y / vh) * 100).toFixed(3)}%` } as const;
              return (
                <>
                  {pulseAge < 1 && (
                    <div
                      style={{
                        position: "absolute",
                        ...at,
                        width: pulse,
                        height: pulse,
                        marginLeft: -pulse / 2,
                        marginTop: -pulse / 2,
                        borderRadius: "50%",
                        background: pop((device ? 0.32 : 0.3) * (1 - pulseAge)),
                      }}
                    />
                  )}
                  <div
                    style={{
                      position: "absolute",
                      ...at,
                      width: size,
                      height: size,
                      marginLeft: -size / 2,
                      marginTop: -size / 2,
                      borderRadius: "50%",
                      border: `${Math.max(1.25, cursorSize * 0.11)}px solid ${inkAlpha((device ? 0.7 : 0.8) * (1 - ripple.age))}`,
                    }}
                  />
                </>
              );
            })()}

          {inside}
        </div>
        {over}
      </div>

      {/*
        The footage recedes toward the STAGE it is standing on, not toward black. Its job
        is to give a card the contrast to be read; on a dark film that is a darkening and
        on a light one a wash, and `rgba(10,10,10,…)` turned panoma's near-white pages
        muddy grey under every claim in the trailer.
      */}
      {dim > 0.01 && (
        <div style={{ position: "absolute", inset: 0, background: ground(dim) }} />
      )}

      {/* A phone's speaker slot, drawn rather than mocked up. */}
      {device && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: win.chromeSize * 0.35,
            width: unit * 9,
            height: unit * 0.7,
            marginLeft: -unit * 4.5,
            borderRadius: unit,
            background: SCENE_MATERIALS.deviceSpeaker,
          }}
        />
      )}
    </div>
  );
};
