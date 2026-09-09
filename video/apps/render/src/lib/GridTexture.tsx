/* A static optical lattice is a film treatment, never a re-rendered or warped product. */
import { useId } from "react";
import type { Format } from "@panoma/video-core";

export const GridTexture: React.FC<{ format: Format; ink: string; overProduct: boolean }> = ({ format, ink, overProduct }) => {
  const id = `film-grid-${useId().replaceAll(":", "")}`;
  const unit = Math.min(format.width, format.height);
  /* Integer physical pixels avoid crawling lines after video encoding. No animated
     offset, grain seed, blur or luminance pulse can compete with a recorded action. */
  const pitch = Math.max(6, Math.round(unit / 90));
  const macro = pitch * 8;
  return <svg data-film-grid="true" data-grid-over-product={overProduct} data-grid-pitch={pitch} width={format.width} height={format.height} viewBox={`0 0 ${format.width} ${format.height}`} aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", color: ink }}>
    <defs>
      <pattern id={`${id}-fine`} width={pitch} height={pitch} patternUnits="userSpaceOnUse"><path d={`M${pitch} 0H0V${pitch}`} fill="none" stroke="currentColor" strokeWidth="1" opacity={overProduct ? 0.045 : 0.075} /></pattern>
      <pattern id={`${id}-macro`} width={macro} height={macro} patternUnits="userSpaceOnUse"><path d={`M${macro} 0H0V${macro}`} fill="none" stroke="currentColor" strokeWidth="1" opacity={overProduct ? 0.025 : 0.055} /></pattern>
    </defs>
    <rect width="100%" height="100%" fill={`url(#${id}-fine)`} />
    <rect width="100%" height="100%" fill={`url(#${id}-macro)`} />
  </svg>;
};
