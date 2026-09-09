/*
  The product on screen, moving. A deterministic still with a slow push sells better
  than a screen recording: no cursor, no accidents, retakeable pixel-for-pixel. The
  image covers the full canvas in every format — the crop IS the responsive layout —
  and the caption words carry the argument for the 80% who watch muted.
*/
import { AbsoluteFill, Sequence, asset, interpolate, useFrame } from "@panoma/video-engine";
import type { Brief, Format, Line } from "@panoma/video-core";
import { gridOf, screenDuration } from "./timing.ts";
import type { Word } from "../lib/captions.tsx";
import { KineticCaptions, evenWords } from "../lib/captions.tsx";
import { display } from "../lib/fonts.ts";
import { typeScale } from "../lib/layout.tsx";
import { useColor, useScrim } from "../lib/theme-context.tsx";

export { screenDuration };

export const ScreenDemo: React.FC<{
  brief: Brief;
  hook: Line;
  lang: string;
  format: Format;
  voiced?: { words: Word[] };
}> = ({ brief, hook, lang, format, voiced }) => {
  const color = useColor();
  const scrim = useScrim();
  const grid = gridOf(brief);
  const { frame } = useFrame();
  const total = screenDuration(brief);
  const scale = typeScale(format);

  /* One continuous push-in across the whole piece; cuts happen in the type, not the image. */
  const push = interpolate(frame, [0, total], [1.04, 1.16]);

  /* Real voice timing when the assets exist; even spacing is the silent fallback. */
  const words =
    voiced?.words ??
    brief.lines.flatMap((line, i) =>
      evenWords(
        line.text[lang],
        grid.bar(2 + i * 2) / grid.fps,
        grid.bar(2 + (i + 1) * 2) / grid.fps - 0.25,
      ),
    );

  return (
    <AbsoluteFill style={{ background: color.paper }}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", overflow: "hidden" }}>
        <img
          src={asset(`${brief.shots ?? "demo"}/hero.png`)}
          style={{
            width: format.id === "h" ? "100%" : "auto",
            height: format.id === "h" ? "auto" : "100%",
            minWidth: "100%",
            minHeight: "100%",
            objectFit: "cover",
            transform: `scale(${push})`,
          }}
        />
      </AbsoluteFill>
      <Sequence durationInFrames={grid.bar(2)} name="hook">
        <AbsoluteFill style={{ alignItems: "center" }}>
          <div
            style={{
              position: "absolute",
              top: format.safe.top + scale * 2,
              width: "80%",
              textAlign: "center",
              fontFamily: display,
              fontWeight: 900,
              fontSize: scale * 7,
              lineHeight: 1.08,
              color: color.ink,
              /* Its own plate, like the captions below it. The piece used to darken
                 the whole top and bottom of the screenshot with a gradient and blur a
                 shadow behind the letters; both are shadows drawn over the product,
                 and a plate the type actually sits on is what carries contrast now. */
              background: scrim(0.72),
              padding: `${scale * 0.9}px ${scale * 1.6}px`,
              borderRadius: scale * 1.2,
            }}
          >
            {hook.text[lang]}
          </div>
        </AbsoluteFill>
      </Sequence>
      <KineticCaptions words={words} size={scale * 5.5} at={format.id === "h" ? 0.84 : 0.72} />
    </AbsoluteFill>
  );
};
