/*
  What replaces the flat dark wash.

  A still background is half of why a screencast reads as boring: for eighteen
  seconds the only thing moving is whatever the product happens to be doing, and
  the frame around it is dead. Everything here moves — slowly, on the grid, and
  deterministically, because a render must be repeatable: positions come from the
  frame number through sines, never from a clock or a random seed.

  Nothing is an asset. The glows are radial gradients, the grid is a repeating
  gradient, and the grain is an SVG turbulence tile generated in the page — which
  means no licence to audit, no file to ship, and no CDN to go down. The grain
  cycles through a handful of seeds so it crawls like film instead of sitting
  there like dust on the lens.
*/
import { AbsoluteFill, useFrame } from "@panoma/video-engine";
import { alphaOf } from "@panoma/video-brand/direction";
import { useColor, useDirection } from "./theme-context.tsx";

/** A tile of fractal noise, as a data URI. Small on purpose: it is repeated. */
function grainTile(seed: number): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'>` +
    `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='${seed}'/></filter>` +
    `<rect width='140' height='140' filter='url(#n)'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export const Backdrop: React.FC<{
  /** Beats per bar of drift: the glows breathe with the music, not against it. */
  barFrames: number;
  /** 0 = still, 1 = full life. Shots that must not compete turn it down. */
  intensity?: number;
  /*
    The music, this frame (recipes/pulse.ts): the lights breathe with the loudness and
    flare on the beat. Without it the glows are exactly what they were, which is what a
    piece without a track still gets.
  */
  pulse?: { beat: number; energy: number };
}> = ({ barFrames, intensity = 1, pulse }) => {
  const color = useColor();
  const { furniture, signal } = useDirection();
  /* The grid and the glows are the product's ink and accent, and a monochrome or
     editorial direction turns the coloured glow off rather than tinting it grey. */
  const rule = alphaOf(color.ink, 0.035);
  /*
    With a pulse, the two lights are the loudness: at half energy they sit where they
    always sat, a quiet passage dims them by a quarter, a loud one lifts them by the same,
    and a beat flares the accent for a few frames. Never past 1 — the alpha is clamped.
  */
  const breath = pulse ? 0.75 + 0.5 * Math.min(1, Math.max(0, pulse.energy)) : 1;
  const flare = pulse ? 1 + 0.9 * Math.min(1, Math.max(0, pulse.beat)) : 1;
  const halo = alphaOf(color.ink, Math.min(1, 0.1 * intensity * breath));
  const lit = furniture.glow && signal === "chromatic" ? alphaOf(color.accent, Math.min(1, 0.07 * intensity * breath * flare)) : "transparent";
  const { frame } = useFrame();

  /* Two glows on slow, coprime cycles, so the pattern never visibly repeats. */
  const slow = (frame / (barFrames * 8)) * Math.PI * 2;
  const slower = (frame / (barFrames * 13)) * Math.PI * 2;
  const gx = 50 + Math.sin(slow) * 16;
  const gy = 38 + Math.cos(slow * 0.7) * 12;
  const hx = 50 - Math.cos(slower) * 22;
  const hy = 66 + Math.sin(slower * 0.8) * 14;

  /* The grid drifts a whole cell per eight bars: motion you feel, not watch. */
  const drift = ((frame / (barFrames * 8)) % 1) * 120;

  return (
    <AbsoluteFill style={{ background: color.paper, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          backgroundImage:
            `repeating-linear-gradient(0deg, ${rule} 0 1px, transparent 1px 120px),` +
            `repeating-linear-gradient(90deg, ${rule} 0 1px, transparent 1px 120px)`,
          backgroundPosition: `${drift}px ${drift * 0.6}px`,
          opacity: 0.55 * intensity,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            `radial-gradient(closest-side circle at ${gx}% ${gy}%, ${halo}, transparent 70%),` +
            `radial-gradient(closest-side circle at ${hx}% ${hy}%, ${lit}, transparent 72%)`,
          filter: "blur(2px)",
        }}
      />
      {/* There is no vignette. A ring of dark closing on the frame is a shadow, and
          no film this engine makes casts one (tests/house-style.test.ts): the two lights
          above already put the eye where the product is, by lighting it. */}
      <AbsoluteFill
        style={{
          backgroundImage: grainTile(frame % 6),
          opacity: 0.05 * intensity,
          mixBlendMode: "overlay",
        }}
      />
    </AbsoluteFill>
  );
};
