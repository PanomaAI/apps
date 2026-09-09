/*
  An element, composited in front of the product.

  The whole design is in the blend mode. `screen` takes the maximum of the two layers, so a
  black field contributes nothing and only the light adds; `multiply` takes the product of
  them, so a white field contributes nothing and only the dark matter shows. Neither one
  REPLACES a pixel of the interface — every letter underneath stays where it was and stays
  readable, which is what separates this from every previous attempt to put generated footage
  near a product.

  Which of the two is not a choice. It is the opposite of the film's own stage, decided in
  @panoma/video-gen's `groundFor`, because getting it wrong is not a matter of degree: screen-blending
  a black element over a near-white interface produces nothing at all, and that is exactly
  what the first composite attempted here did.

  It is short on purpose. This is punctuation — the physical fact of a press — and an element
  that outstays a few frames stops being an impact and becomes a video playing over a video.
*/
import { asset } from "@panoma/video-engine";

export const ElementBurst: React.FC<{
  /** The crushed element, relative to the assets mount. */
  file: string;
  blend: "screen" | "multiply";
  /** Where in the composition it is centred, as fractions of the frame. */
  at: { x: number; y: number };
  /** Its width in composition pixels; it keeps the clip's own 16:9. */
  size: number;
  /** Which second of the element to paint. */
  second: number;
  /** 0..1, so it arrives and leaves rather than blinking. */
  opacity: number;
}> = ({ file, blend, at, size, second, opacity }) => {
  if (opacity <= 0.01) return null;
  const height = size * (9 / 16);
  return (
    <div
      style={{
        position: "absolute",
        left: `${(at.x * 100).toFixed(3)}%`,
        top: `${(at.y * 100).toFixed(3)}%`,
        width: size,
        height,
        marginLeft: -size / 2,
        marginTop: -height / 2,
        /*
          The blend is on the element itself rather than on a wrapper: a wrapper would
          establish a stacking context and the mode would apply to the composited group,
          which on a page with a background of its own means blending against that
          background instead of against the product.
        */
        mixBlendMode: blend,
        opacity,
        pointerEvents: "none",
      }}
    >
      <canvas
        data-video={asset(file)}
        data-seek={second.toFixed(4)}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
    </div>
  );
};
