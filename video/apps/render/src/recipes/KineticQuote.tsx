/*
  Kinetic typography, cut to the grid. The hook owns the first two bars — one word per
  beat, accumulating, because the first seconds decide everything and a static title
  card is how a short dies. Then each line takes a bar, slamming in on the downbeat.
  Dark is rationed: the hook and the close, nothing else — polarity flips are the
  punctuation, and punctuation everywhere is punctuation nowhere.
*/
import { AbsoluteFill, Sequence, interpolate, spring, useFrame } from "@panoma/video-engine";
import type { Brief, Format, Grid, Line } from "@panoma/video-core";
import { gridOf, quoteDuration } from "./timing.ts";
import { display } from "../lib/fonts.ts";
import { typeScale } from "../lib/layout.tsx";
import { useColor } from "../lib/theme-context.tsx";

export { quoteDuration };

const HookBars: React.FC<{ text: string; grid: Grid; size: number }> = ({ text, grid, size }) => {
  const color = useColor();
  const { frame } = useFrame();
  const words = text.split(/\s+/).filter(Boolean);
  /* Spread the words over the hook's eight beats; several may share one beat. */
  const perBeat = Math.ceil(words.length / 8);
  const visible = Math.min(words.length, (Math.floor(frame / grid.beatFrames) + 1) * perBeat);

  return (
    <AbsoluteFill style={{ background: color.paper, justifyContent: "center", alignItems: "center" }}>
      <div style={{ width: "86%", textAlign: "center" }}>
        {words.map((w, i) => {
          const beatIn = Math.floor(i / perBeat) * grid.beatFrames;
          const pop = interpolate(frame - beatIn, [0, 3], [1.12, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <span
              key={i}
              style={{
                fontFamily: display,
                fontWeight: 900,
                fontSize: size,
                lineHeight: 1.06,
                color: i < visible ? color.ink : "transparent",
                display: "inline-block",
                transform: `scale(${i < visible ? pop : 1})`,
                transformOrigin: "center bottom",
              }}
            >
              {w}{"\u00a0"}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const Slam: React.FC<{ text: string; size: number; dark?: boolean; accent?: boolean }> = ({
  text,
  size,
  dark,
  accent,
}) => {
  const color = useColor();
  const { frame, fps } = useFrame();
  const s = spring({ frame, fps, config: { damping: 16, mass: 0.6 }, durationInFrames: 10 });
  const scale = interpolate(s, [0, 1], [1.35, 1]);

  return (
    <AbsoluteFill
      style={{
        background: dark ? color.paper : color.inverted.paper,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: "86%",
          textAlign: "center",
          fontFamily: display,
          fontWeight: 900,
          fontSize: size,
          lineHeight: 1.04,
          letterSpacing: "-0.02em",
          color: accent ? color.accent : dark ? color.ink : color.inverted.ink,
          transform: `scale(${scale})`,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

export const KineticQuote: React.FC<{ brief: Brief; hook: Line; lang: string; format: Format }> = ({
  brief,
  hook,
  lang,
  format,
}) => {
  const color = useColor();
  const grid = gridOf(brief);
  const size = typeScale(format) * (format.id === "h" ? 7.5 : 9);

  return (
    <AbsoluteFill style={{ background: color.paper }}>
      <Sequence durationInFrames={grid.bar(2)} name="hook">
        <HookBars text={hook.text[lang]} grid={grid} size={size} />
      </Sequence>
      {brief.lines.map((line, i) => {
        const last = i === brief.lines.length - 1;
        return (
          <Sequence key={line.id} from={grid.bar(2 + i)} durationInFrames={grid.barFrames} name={line.id}>
            <Slam text={line.text[lang]} size={size * (last ? 1.15 : 1)} dark={last} accent={last} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
