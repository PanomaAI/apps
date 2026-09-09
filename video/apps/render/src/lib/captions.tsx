/*
  A caption arrives whole and holds its layout. The spoken word changes colour;
  nothing scales, shifts or reflows underneath a viewer reading the interface.
  Dense technical strings (a command, a path) stay out of the caption track and
  appear as typography in their recipe instead.

  Words carry seconds (they come from the TTS alignment); frames are derived here so the
  same words file works at any fps.
*/
import { AbsoluteFill, useFrame } from "@panoma/video-engine";
import { captionCards } from "../recipes/timing.ts";
import { display } from "./fonts.ts";
import { useColor, useScrim } from "./theme-context.tsx";

export type Word = { text: string; start: number; end: number };

/** Even spacing for silent pieces: caption timing without any audio to align to. */
export function evenWords(text: string, startSec: number, endSec: number): Word[] {
  const parts = text.split(/\s+/).filter(Boolean);
  const slice = (endSec - startSec) / parts.length;
  return parts.map((w, i) => ({ text: w, start: startSec + i * slice, end: startSec + (i + 1) * slice }));
}

export const KineticCaptions: React.FC<{
  words: Word[];
  /** Vertical position inside the stage, 0..1 from the top. */
  at?: number;
  size: number;
}> = ({ words, at = 0.82, size }) => {
  const color = useColor();
  const scrim = useScrim();
  const { frame, fps } = useFrame();
  const t = frame / fps;

  /*
    Cards, not a sliding window of three words: grouped by the same function the
    readability check reads, so a card that passes the check is the card that gets
    rendered, and a card never shows the tail of one sentence beside the head of
    the next.
  */
  const cards = captionCards(words);
  const card = cards.find((c) => t >= c.start && t < c.shownUntil);
  if (!card) return null;

  /*
    The whole card is legible from the moment it appears, and the word being said is
    the bright one.

    Hiding the words not yet spoken was the first design, and in a 16:9 frame it
    renders as a wide empty plate with two words at the left — the card reserves the
    space it will need, so the longer the sentence the more it looks broken. Every
    kinetic caption that works does this instead: the line is there, the read-ahead
    is possible (which is the whole point for a muted viewer), and the highlight is
    what moves.
  */
  const current = card.words.findIndex((w) => t >= w.start && t < w.end);
  const said = card.words.filter((w) => t >= w.start).length - 1;
  const active = current === -1 ? said : current;

  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center" }}>
      <div
        style={{
          position: "absolute",
          top: `${at * 100}%`,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          /* A card at a real caption size overflows a portrait stage on three long
             words; wrapping is the difference between two lines and a clipped one. */
          maxWidth: "92%",
          gap: `${size * 0.16}px ${size * 0.3}px`,
          lineHeight: 1.2,
          alignItems: "baseline",
          /*
            The chip: captions float over anything — busy UI, video, a face — so they
            carry their own contrast instead of borrowing it from the background.

            At 0.55 it did not: over a bright product section with its own large dark
            headline, a half-transparent plate turns mid-grey and the white caption on
            it fails against the page's own type showing through. There is no WCAG
            criterion for pixels inside a video, so the plate has to be dense enough
            that the answer does not depend on what is behind it.
          */
          background: scrim(0.78),
          padding: `${size * 0.28}px ${size * 0.55}px`,
          borderRadius: size * 0.35,
        }}
      >
        {card.words.map((w, i) => (
          <span
            key={i}
            style={{
              fontFamily: display,
              fontWeight: 800,
              fontSize: size,
              lineHeight: 1.2,
              color: i === active ? color.ink : color.muted,
              opacity: i > active ? 0.74 : 1,
            }}
          >
            {w.text}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};
