/*
  The speedrun: a terminal races the clock. Dev short-form's most honest format —
  Fireship built 4M subscribers on information density — and the one place where
  monospace IS the typography. The command types itself over the first bar, output
  lands every half bar (fast enough to feel alive, slow enough to skim), and the
  summary slams on its own bar in the film's accent. The hook floats above for the first
  two bars only; after that the terminal has earned the frame.

  The authored terminal follows the film's palette: light for Panoma Video's house
  theme, or the measured product's direction when one is supplied.
*/
import { AbsoluteFill, Sequence, interpolate, spring, useFrame } from "@panoma/video-engine";
import type { Brief, Format, Line } from "@panoma/video-core";
import { SCENE_MATERIALS } from "@panoma/video-core/theme";
import { display, mono } from "../lib/fonts.ts";
import { Stage, typeScale } from "../lib/layout.tsx";
import { useColor } from "../lib/theme-context.tsx";
import { gridOf, terminalDuration, terminalParts, terminalRowFrame, terminalSummaryFrame } from "./timing.ts";

export { terminalDuration };

const Caret: React.FC<{ size: number }> = ({ size }) => {
  const color = useColor();
  const { frame, fps } = useFrame();
  /* Blinks at 2 Hz, phase-locked to the composition clock — deterministic. */
  const on = Math.floor((frame / fps) * 2) % 2 === 0;
  return (
    <span
      style={{
        display: "inline-block",
        width: size * 0.55,
        height: size * 1.05,
        marginLeft: size * 0.15,
        verticalAlign: "text-bottom",
        background: on ? color.ink : "transparent",
      }}
    />
  );
};

export const TerminalRun: React.FC<{ brief: Brief; hook: Line; lang: string; format: Format }> = ({
  brief,
  hook,
  lang,
  format,
}) => {
  const color = useColor();
  const { frame, fps } = useFrame();
  const grid = gridOf(brief);
  const { command, output, summary } = terminalParts(brief);
  const scale = typeScale(format);
  const size = scale * (format.id === "h" ? 3.1 : 3.6);

  const commandText = command.text[lang];
  const typed = Math.min(
    commandText.length,
    Math.ceil(interpolate(frame, [grid.beat(0.5), grid.bar(1) - 2], [0, commandText.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })),
  );

  const summaryAt = terminalSummaryFrame(brief);
  const summarySpring = spring({
    frame: frame - summaryAt,
    fps,
    config: { damping: 16, mass: 0.6 },
    durationInFrames: 10,
  });

  const hookFade = interpolate(frame, [grid.bar(2) - 8, grid.bar(2)], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: color.paper }}>
      <Stage format={format} style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
        {hookFade > 0 && (
          <div
            style={{
              position: "absolute",
              top: 0,
              width: "92%",
              textAlign: "center",
              fontFamily: display,
              fontWeight: 900,
              fontSize: scale * 6,
              lineHeight: 1.08,
              color: color.ink,
              opacity: hookFade,
            }}
          >
            {hook.text[lang]}
          </div>
        )}

        <div
          style={{
            width: format.id === "h" ? "72%" : "100%",
            borderRadius: scale * 1.4,
            overflow: "hidden",
            border: `1px solid ${color.line}`,
          }}
        >
          <div style={{ background: color.card, display: "flex", gap: size * 0.4, padding: `${size * 0.55}px ${size * 0.7}px`, alignItems: "center" }}>
            {SCENE_MATERIALS.windowControls.map((dot) => (
              <span key={dot} style={{ width: size * 0.55, height: size * 0.55, borderRadius: "50%", background: dot }} />
            ))}
            <span style={{ marginLeft: size * 0.4, fontFamily: mono, fontSize: size * 0.75, color: color.muted }}>~/Dev</span>
          </div>
          <div style={{ background: color.paper, padding: `${size}px ${size * 1.1}px ${size * 1.2}px`, fontFamily: mono, fontSize: size, lineHeight: 1.75 }}>
            <div style={{ color: color.ink, whiteSpace: "pre-wrap" }}>
              <span style={{ color: color.muted }}>$ </span>
              {commandText.slice(0, typed)}
              <Sequence durationInFrames={grid.bar(1)}>
                <Caret size={size} />
              </Sequence>
            </div>
            {output.map((line, i) => (
              <Sequence key={line.id} from={terminalRowFrame(brief, i)} name={line.id}>
                <div style={{ color: color.muted }}>
                  <span style={{ color: color.good }}>✓ </span>
                  {line.text[lang]}
                </div>
              </Sequence>
            ))}
            <Sequence from={summaryAt} name="summary">
              <div
                style={{
                  color: color.accent,
                  fontWeight: 600,
                  transform: `scale(${interpolate(summarySpring, [0, 1], [1.12, 1])})`,
                  transformOrigin: "left center",
                }}
              >
                {summary.text[lang]}
              </div>
            </Sequence>
          </div>
        </div>
      </Stage>
    </AbsoluteFill>
  );
};
