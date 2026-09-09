/*
  The stage a product film is shot on, and what moves on it besides the product: a
  spotlight, a sweep of light, a cursor, a tap, the ring a press leaves, and type
  that arrives. Nothing here is an asset — gradients, one SVG path drawn below, CSS
  — so there is no licence to audit and nothing to download. Every value is a
  function of the numbers the caller passes; nothing reads a clock.

  The look is measured from the reference launch films (Diffusion Studio, Scenivia):
  a stage lit from above in the brand's accent, one real interface element in the
  middle of it, and a pointer that is there before the click. Nothing here draws a
  shadow or a glow; see the rule in tests/house-style.test.ts.
*/
import type { CSSProperties } from "react";
import { AbsoluteFill } from "@panoma/video-engine";
import { SCENE_MATERIALS } from "@panoma/video-core/theme";
import { useVeil } from "./theme-context.tsx";

/** `#rrggbb` to `rgba()`. Anything else falls back to a neutral, so a bad brand never throws a frame. */
export function hexRgba(hex: string, alpha: number): string {
  const candidate = hex.replace("#", "");
  const raw = /^[0-9a-f]{6}$/i.test(candidate) ? candidate : SCENE_MATERIALS.neutralFallback.slice(1);
  const n = Number.parseInt(raw, 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * The stage: the paper, a spotlight from above in the accent, and a faint second
 * light low and to the side. `intensity` turns the lights down under a shot that
 * must not compete.
 *
 * There is no vignette. A ring of dark around the frame is a shadow, and this film
 * does not draw shadows (see the house rule in tests/house-style.test.ts): the eye
 * is kept on the product by what is lit, not by what is darkened around it.
 */
export const SpotStage: React.FC<{
  paper: string;
  accent: string;
  intensity?: number;
  /*
    The music, this frame (recipes/pulse.ts), with the Backdrop's numbers: at half energy
    the lights sit where they always sat, a quiet passage dims them by a quarter, a loud one
    lifts them by the same, and a beat flares the accent for a few frames. Without it the
    stage is exactly what it was.
  */
  pulse?: { beat: number; energy: number };
}> = ({ paper, accent, intensity = 1, pulse }) => {
  const { pop } = useVeil();
  const breath = pulse ? 0.75 + 0.5 * Math.min(1, Math.max(0, pulse.energy)) : 1;
  const flare = pulse ? 1 + 0.9 * Math.min(1, Math.max(0, pulse.beat)) : 1;
  const lit = (alpha: number) => Math.min(1, alpha * intensity * breath);
  return (
    <AbsoluteFill style={{ background: paper, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background:
            `radial-gradient(ellipse 70% 55% at 50% -12%, ${hexRgba(accent, lit(0.3 * flare))}, transparent 70%),` +
            `radial-gradient(ellipse 45% 40% at 88% 96%, ${hexRgba(accent, lit(0.1))}, transparent 70%),` +
            `radial-gradient(ellipse 60% 50% at 8% 90%, ${pop(lit(0.035))}, transparent 70%)`,
        }}
      />
    </AbsoluteFill>
  );
};

/*
  There used to be a LightSweep here: a blurred bar of the accent crossing the frame
  on every cut, over the kicker and over every claim card. On tape it is a lens flare —
  a fat gold diagonal across a third of the frame with the claim sitting under it —
  and it belongs to the same family as the glows and the vignette this file lost on
  2026-09-03. The cut carries itself now: a card is the opposite polarity of the shot
  on either side of it, which is a change no viewer and no scene detector can miss.
*/

/*
  The pointer, drawn: a dark arrow with a light edge so it reads on the product
  and on the stage alike. Pressed, it gives by a seventh and springs back — `press` is
  0..1 of the same squash ProductWindow draws, so a press looks the same in every
  recipe. It used to be a boolean held for five frames, which is a pointer that
  drops and snaps rather than one that gives. The path is this file's own.
*/
export const Cursor: React.FC<{ x: number; y: number; size: number; press?: number; opacity?: number }> = ({ x, y, size, press = 0, opacity = 1 }) => (
  <svg
    viewBox="0 0 13 20"
    width={size}
    height={(size * 20) / 13}
    style={{
      position: "absolute",
      left: x - size * 0.09,
      top: y - size * 0.06,
      transform: `scale(${(1 - 0.14 * Math.min(1, Math.max(0, press))).toFixed(3)})`,
      transformOrigin: "9% 4%",
      opacity,
      overflow: "visible",
    }}
  >
    <path d="M1.2 1 L1.2 15.6 L4.9 12.3 L7.5 18.6 L10 17.5 L7.4 11.4 L12.3 11.4 Z" fill={SCENE_MATERIALS.pointerFill} stroke={SCENE_MATERIALS.pointerEdge} strokeWidth="1.15" strokeLinejoin="round" />
  </svg>
);

/** A finger on glass: a soft disc that appears where the tap lands, since a phone has no pointer to travel. */
export const Tap: React.FC<{ x: number; y: number; size: number; opacity: number }> = ({ x, y, size, opacity }) => {
  const { pop } = useVeil();
  return (
    <div
      style={{
        position: "absolute",
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${pop(0.55)}, ${pop(0.18)} 60%, transparent 72%)`,
        border: `1.5px solid ${pop(0.55)}`,
        opacity,
      }}
    />
  );
};

/**
 * A press, over its `age` (0..1): the same two things ProductWindow draws, so a press
 * looks the same in every recipe. The PULSE is a soft disc of the veil's pop that blooms
 * under the pointer and is gone inside the first two thirds of the press — the 200–300 ms,
 * low-opacity confirmation every guide on screen recording asks for. The RING is the line
 * that runs on to the end and only has to say where. ProductWindow's own drawing is not
 * shared from here because that file is not this change's to edit; the numbers are its.
 */
export const Ripple: React.FC<{ x: number; y: number; size: number; age: number; color: string }> = ({ x, y, size, age, color }) => {
  const { pop } = useVeil();
  if (age < 0 || age >= 1) return null;
  const d = size * (0.4 + age * 1.6);
  const pulseAge = Math.min(1, age / 0.65);
  const pulse = size * (0.5 + pulseAge * 0.9);
  return (
    <>
      {pulseAge < 1 && (
        <div
          style={{
            position: "absolute",
            left: x - pulse / 2,
            top: y - pulse / 2,
            width: pulse,
            height: pulse,
            borderRadius: "50%",
            background: pop(0.3 * (1 - pulseAge)),
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          left: x - d / 2,
          top: y - d / 2,
          width: d,
          height: d,
          borderRadius: "50%",
          border: `${Math.max(1.5, size * 0.06)}px solid ${hexRgba(color, 0.9 * (1 - age))}`,
        }}
      />
    </>
  );
};

/**
 * Type that lands one word per step, whole: letters and final shape on one frame,
 * and nothing about it moves afterwards — the house rule for type, because a word
 * that also travels over a moving picture reads as noise. Every word holds its
 * space from the first frame, so the line never reflows under itself.
 *
 * It used to take a `glow`, and every caller passed one: the accent, blurred, behind
 * the letters. On a card that is the only thing on screen a glow is a halo nobody
 * asked for, and it is the reason type here looked printed on rather than set.
 */
export const Arrive: React.FC<{
  text: string;
  frame: number;
  from: number;
  step: number;
  font: string;
  size: number;
  color: string;
  align?: "left" | "center";
  weight?: number;
  style?: CSSProperties;
}> = ({ text, frame, from, step, font, size, color, align = "left", weight = 850, style }) => {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <div style={{ fontFamily: font, fontSize: size, fontWeight: weight, lineHeight: 1.02, letterSpacing: "-0.035em", color, textAlign: align, textWrap: "balance", ...style }}>
      {words.map((word, i) => (
        <span
          key={`${word}-${i}`}
          style={{
            display: "inline-block",
            marginRight: "0.24em",
            opacity: frame >= from + i * step ? 1 : 0,
          }}
        >
          {word}
        </span>
      ))}
    </div>
  );
};

/** A chip of small type on a plate: the claim under a context shot, the result the interface gave. */
export const Chip: React.FC<{ text: string; font: string; size: number; ink: string; plate: string; accent?: string; style?: CSSProperties }> = ({ text, font, size, ink, plate, accent, style }) => {
  const { pop } = useVeil();
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.5,
        fontFamily: font,
        fontSize: size,
        fontWeight: 650,
        letterSpacing: "0.01em",
        color: ink,
        background: plate,
        padding: `${size * 0.42}px ${size * 0.8}px`,
        borderRadius: size * 0.5,
        border: `1px solid ${accent ? hexRgba(accent, 0.35) : pop(0.12)}`,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {accent ? <span style={{ width: size * 0.5, height: size * 0.5, borderRadius: "50%", background: accent, flex: "none" }} /> : null}
      {text}
    </div>
  );
};
