/*
  Responsive design, but for video. A recipe never asks "am I vertical?" to place pixels;
  it renders inside <Stage>, which is the canvas minus the platform UI overlays, and
  scales type from the stage's short side. The same scene tree reflows into 9:16, 16:9
  and 1:1 the way a web page reflows into a phone.
*/
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill } from "@panoma/video-engine";
import { stage, type Format } from "@panoma/video-core";

/**
 * Caption type: 6.667% of the canvas short side, and never the stage's.
 *
 * The stage-derived scale is right for a recipe whose type IS the composition, and
 * wrong for words laid over footage: a 9:16 stage is 870px wide, so `typeScale * 3`
 * produced 27px captions on a 1080px canvas — under half of what a caption may be.
 * BBC's ttml-validator publishes the number (T.8: 6.667% of render height landscape,
 * 3.75% vertical; both resolve to 72px on a 1080 short side) with a line height of
 * 120-125% (T.9), and it is the only primary, checkable type-size figure in the field.
 */
export function captionSize(f: Format): number {
  return Math.round(0.0667 * Math.min(f.width, f.height));
}

/**
 * Title type, backing off as the sentence lengthens.
 *
 * One constant cannot serve "Name ten." and a twelve-word hook: the first wants the
 * frame and the second overflows a portrait stage three words in. So the size is a
 * function of the text it has to carry, which also means an author rewriting a hook
 * never has to re-tune a number.
 */
export function titleSize(f: Format, text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.round(Math.min(f.width, f.height) * Math.max(0.062, 0.132 - words * 0.006));
}

/**
 * Claim type: a card that is the only thing on screen is set to the stage it has.
 *
 * `titleSize` backs off from a constant, which is right for words laid over a picture —
 * they are a guest on the frame. A claim card is not a guest: the product is not on
 * screen, and the whole point of giving the claim its own bar is that it lands. At
 * `titleSize` a one-word claim came out at 12.6% of the short side and sat in the
 * middle of an empty 1920 frame looking like a caption that had lost its video.
 *
 * So: as large as the longest word allows on one line, capped at a fifth of the short
 * side, then stepped down until the whole claim fits in three lines of two thirds of
 * the stage. `EM` is the display face's average advance measured off a rendered frame
 * ("More places to open it", 22 characters, 1180 px at 136 px = 0.394), with a sixth
 * of slack on top, because a claim that overflows its stage is worse than one set small.
 */
export function cardSize(f: Format, text: string): number {
  const EM = 0.46;
  const LINE = 1.12;
  const s = stage(f);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return titleSize(f, text);
  const room = s.width * 0.94;
  const longest = Math.max(...words.map((w) => w.length));
  const chars = words.reduce((n, w) => n + w.length, 0) + words.length - 1;
  let size = Math.min(room / (longest * EM), Math.min(f.width, f.height) * 0.2);
  /* Twenty-four steps of 6% is a factor of four: past that the claim is not a card, it is a paragraph. */
  for (let i = 0; i < 24; i++) {
    const perLine = Math.max(1, Math.floor(room / (size * EM)));
    if (Math.ceil(chars / perLine) * size * LINE <= s.height * 0.66) break;
    size *= 0.94;
  }
  return Math.round(size);
}

/** Type scale anchored to the stage, not the canvas: overlays don't shrink the text. */
export function typeScale(f: Format): number {
  const s = stage(f);
  return Math.min(s.width, s.height) / 100;
}

export const Stage: React.FC<{ format: Format; style?: CSSProperties; children: ReactNode }> = ({
  format,
  style,
  children,
}) => {
  const s = stage(format);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: s.x,
          top: s.y,
          width: s.width,
          height: s.height,
          ...style,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};
