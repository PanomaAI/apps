/*
  The deliberate exception to the length rule: a sub-10-second seamless loop built
  for rewatches. Everything periodic is a pure function of angle, so frame N is
  congruent with frame 0 by construction; the one non-periodic element — the counter
  — jumps at the seam, and the seam flash turns that jump into a beat. The algorithm
  rewards exactly this: rewatch outweighs completion in every 2025-2026 weighting
  we found.
*/
import { AbsoluteFill, interpolate, useFrame } from "@panoma/video-engine";
import type { Brief, Format, Line } from "@panoma/video-core";
import { display, mono } from "../lib/fonts.ts";
import { stage } from "@panoma/video-core";
import { useColor, useInkAlpha, useVeil } from "../lib/theme-context.tsx";
import { loopDuration, seamFlash, sweepAngle } from "./timing.ts";

export { loopDuration };

const TICKS = 24;

export const Loop: React.FC<{ brief: Brief; hook: Line; lang: string; format: Format }> = ({
  brief,
  hook,
  lang,
  format,
}) => {
  const color = useColor();
  const inkAlpha = useInkAlpha();
  const { pop } = useVeil();
  const { frame, durationInFrames } = useFrame();
  const s = stage(format);
  const radius = Math.min(s.width, s.height) * 0.34;
  const cx = format.width / 2;
  const cy = format.safe.top + s.height / 2;
  const angle = sweepAngle(frame, durationInFrames);
  const target = Number(brief.params?.count ?? 47);
  const count = Math.min(target, Math.floor((frame / durationInFrames) * (target + 1)));
  const flash = seamFlash(frame, durationInFrames);
  const size = Math.min(s.width, s.height) / 100;

  return (
    <AbsoluteFill style={{ background: color.paper }}>
      {/* The ring: brightness is a function of angular distance behind the sweep,
          which is periodic — this is what makes the loop invisible. */}
      {Array.from({ length: TICKS }, (_, i) => {
        const tickAngle = (360 / TICKS) * i;
        const behind = (((angle - tickAngle) % 360) + 360) % 360;
        const heat = Math.max(0, 1 - behind / 140);
        const rad = ((tickAngle - 90) * Math.PI) / 180;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: cx + Math.cos(rad) * radius,
              top: cy + Math.sin(rad) * radius,
              width: size * 1.6,
              height: size * 1.6,
              marginLeft: -size * 0.8,
              marginTop: -size * 0.8,
              borderRadius: "50%",
              background: inkAlpha(0.12 + heat * 0.88),
              transform: `scale(${1 + heat * 0.5})`,
            }}
          />
        );
      })}

      {/* The sweep line. */}
      <div
        style={{
          position: "absolute",
          left: cx,
          top: cy,
          width: radius,
          height: 2,
          transformOrigin: "0 50%",
          transform: `rotate(${angle - 90}deg)`,
          background: `linear-gradient(to right, transparent, ${inkAlpha(0.9)})`,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: cx,
          top: cy,
          transform: "translate(-50%, -50%)",
          textAlign: "center",
        }}
      >
        <div style={{ fontFamily: mono, fontWeight: 600, fontSize: size * 11, color: color.ink, fontVariantNumeric: "tabular-nums" }}>
          {count}
        </div>
        <div style={{ fontFamily: display, fontWeight: 600, fontSize: size * 3.2, color: color.muted, marginTop: size }}>
          {hook.text[lang]}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: format.safe.bottom + size * 2,
          textAlign: "center",
          fontFamily: display,
          fontWeight: 800,
          fontSize: size * 3.4,
          color: color.ink,
          letterSpacing: "0.02em",
        }}
      >
        {brief.lines[0]?.text[lang] ?? ""}
      </div>

      {flash > 0 && <AbsoluteFill style={{ background: pop(flash * 0.9) }} />}
    </AbsoluteFill>
  );
};
