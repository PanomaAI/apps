/*
  Type that lands, one word per tick.

  This file used to animate: each word rose from behind its own mask while the
  variable-font axes travelled from a caption's shape into a headline's. On paper
  that is a title sequence. On tape it was two events fighting each other — the
  word's dark plate is drawn by the outer element, so the plate appeared INSTANTLY
  and complete, and then the letters climbed into it from below over the next eight
  frames, and then the weight kept thickening for most of a beat after the word had
  visibly arrived. A viewer reads that as a bug, and they are right: nothing in the
  piece justifies a box arriving before the word it is a box for.

  So a word now lands the way a cut lands: plate, letters and final type shape on
  the same frame, and nothing about it moves afterwards. The rhythm is still the
  arrival — one word per tick, on the grid — but each arrival is one event instead
  of three. The reference pieces in this genre (Linear, Apple, Raycast) cut their
  card type in for exactly this reason: over footage that is already moving, type
  that also moves reads as noise, and type that cuts reads as intent.

  What the variable fonts still buy is the SHAPE, not the travel: `editorial` is set
  at a headline's optical size and weight, with the closing word's WONK alternate on;
  `wide` is set wide. Those are the values the old animation spent a beat crawling
  towards, so the title looks like its final frame from its first one.

  Pure function of the frame, like everything else here: no state, no timers.
*/
import { useFrame } from "@panoma/video-engine";
import { axes, display, editorial, wide } from "./fonts.ts";
import { useColor, useScrim } from "./theme-context.tsx";

export type TitleVoice = "editorial" | "wide" | "plain";

/** The shape each voice is set at. One value per axis: the type does not travel. */
const VOICES: Record<TitleVoice, { family: string; axes: Record<string, number> }> = {
  /* Fraunces at a headline's optical size, with the softness its display sizes want. */
  editorial: { family: editorial, axes: { opsz: 144, wght: 800, SOFT: 20, WONK: 0 } },
  /* Anybody, wide enough that the word takes the room it is asking for. */
  wide: { family: wide, axes: { wdth: 116, wght: 800 } },
  plain: { family: display, axes: { wght: 900 } },
};

export const KineticTitle: React.FC<{
  text: string;
  size: number;
  voice?: TitleVoice;
  /** Frames between word arrivals — a beat, or half of one. */
  step: number;
  /** Frame the first word lands on. */
  from?: number;
  align?: "center" | "left";
  plate?: boolean;
  color?: string;
}> = ({ text, size, voice = "plain", step, from = 0, align = "center", plate = true, color: inkProp }) => {
  const palette = useColor();
  const scrim = useScrim();
  const ink = inkProp ?? palette.ink;
  const { frame } = useFrame();
  const words = text.split(/\s+/).filter(Boolean);
  const spec = VOICES[voice];

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: `${size * 0.12}px ${size * 0.28}px`,
        justifyContent: align === "center" ? "center" : "flex-start",
        maxWidth: "100%",
      }}
    >
      {words.map((word, i) => {
        /*
          Every word is drawn in every frame and only its opacity changes, so the
          line is laid out once: a word that has not landed still holds its space
          and the ones already on screen never shift under it. The plate is per
          word for the same reason — a plate around the block would have to grow
          on each arrival, or sit there half empty waiting for words to come.
        */
        const landed = frame >= from + i * step;
        /* The accent: the closing word of an editorial title is set on its wonky alternate. */
        const settings = voice === "editorial" && i === words.length - 1 ? { ...spec.axes, WONK: 1 } : spec.axes;

        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              opacity: landed ? 1 : 0,
              lineHeight: 1.05,
              background: plate ? scrim() : undefined,
              padding: plate ? `${size * 0.14}px ${size * 0.2}px` : undefined,
              borderRadius: plate ? size * 0.16 : undefined,
            }}
          >
            <span
              style={{
                display: "inline-block",
                fontFamily: spec.family,
                fontSize: size,
                fontVariationSettings: axes(settings),
                color: ink,
                lineHeight: 1.05,
              }}
            >
              {word}
            </span>
          </span>
        );
      })}
    </div>
  );
};
