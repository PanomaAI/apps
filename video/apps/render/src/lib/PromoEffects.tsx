/* Promotional treatments keep their source pixels and text intact. Their clocks live in presentation.ts. */
import type { CSSProperties } from "react";
import { stage, type EditorialTheme, type Format } from "@panoma/video-core";
import { contrastRatio } from "@panoma/video-brand/contrast";
import type { CastBox } from "../recipes/timing.ts";
import { promoThemeTokens } from "../recipes/editorial.ts";
import { display } from "./fonts.ts";
import { Stage } from "./layout.tsx";
import { useColor, useDirection } from "./theme-context.tsx";
import { BlockPlate } from "./BlockPlate.tsx";

type Rect = { x: number; y: number; width: number; height: number };
type Inks = { paper: string; ink: string; muted: string };
const wordsStyle: CSSProperties = { overflowWrap: "normal", wordBreak: "normal", hyphens: "none" };

/* A conservative Geist advance estimate keeps fitting independent of the browser
   while preserving the narrow letters that the old fixed-width estimate ignored. */
const wordUnits = (word: string) => [...word].reduce((width, char) => width +
  (/[MWmw@#%]/.test(char) ? 0.94 : /[iljI.,!;:'|]/.test(char) ? 0.32 : /[frt()[\]]/.test(char) ? 0.44 : /[A-Z]/.test(char) ? 0.74 : 0.61), 0);

function wrappedLines(text: string, width: number, size: number): number {
  let lines = 1;
  let occupied = 0;
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const next = wordUnits(word) * size;
    if (occupied && occupied + size * 0.34 + next > width) { lines++; occupied = next; }
    else occupied += (occupied ? size * 0.34 : 0) + next;
  }
  return lines;
}

/** Fit whole words before rendering; nothing changes size while a line or row is being read. */
function fitWords(text: string, width: number, height: number, desired: number, maxLines = Infinity): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const longest = Math.max(1, ...words.map(wordUnits));
  let size = Math.min(desired, width / longest);
  for (let pass = 0; pass < 40; pass++) {
    const lines = wrappedLines(text, width, size);
    if (lines <= maxLines && lines * size * 1.17 <= height) break;
    size *= 0.96;
  }
  return Math.floor(size);
}

/** One transparent hole over the current decoded frame, never a second image of an earlier result. */
export const PromoFocus: React.FC<{
  box: CastBox;
  viewport: { width: number; height: number };
  content: { width: number; height: number };
  zoom: { scale: number; dx: number; dy: number };
  opacity: number;
}> = ({ box, viewport, content, zoom, opacity }) => {
  const color = useColor();
  const direction = useDirection();
  if (opacity <= 0) return null;
  /* A measured component needs only a raster edge allowance, not a second card
     around it. Wider holes expose unrelated neighboring labels. */
  const pad = Math.min(2, Math.min(viewport.width, viewport.height) * 0.002);
  const transformX = (value: number) => content.width * (0.5 + zoom.dx + (value / viewport.width - 0.5) * zoom.scale);
  const transformY = (value: number) => content.height * (0.5 + zoom.dy + (value / viewport.height - 0.5) * zoom.scale);
  const x = Math.max(0, transformX(box.x - pad));
  const y = Math.max(0, transformY(box.y - pad));
  const right = Math.min(content.width, transformX(box.x + box.width + pad));
  const bottom = Math.min(content.height, transformY(box.y + box.height + pad));
  const width = right - x;
  const height = bottom - y;
  /* A stale or off-camera region cannot become a full-frame wash. */
  if (width <= 2 || height <= 2 || width * height >= content.width * content.height * 0.9) return null;
  const r = Math.min(width / 12, height / 12, 5 * content.width / viewport.width * zoom.scale);
  const path = `M0 0H${content.width}V${content.height}H0Z M${x + r} ${y}H${right - r}Q${right} ${y} ${right} ${y + r}V${bottom - r}Q${right} ${bottom} ${right - r} ${bottom}H${x + r}Q${x} ${bottom} ${x} ${bottom - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
  return <svg data-promo-focus="true" data-focus-box={`${x},${y},${width},${height}`} viewBox={`0 0 ${content.width} ${content.height}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", opacity }}>
    <path d={path} fill={direction.scheme === "light" ? color.ink : color.paper} fillOpacity={0.76} fillRule="evenodd" />
  </svg>;
};

/** The caption is a separate safe panel; the recording beside it owns its own camera. */
export const PromoSideText: React.FC<{ format: Format; rect: Rect; text: string; ink: string; colors?: Inks; theme?: EditorialTheme }> = ({ format, rect, text, ink, colors, theme }) => {
  const color = useColor();
  const design = promoThemeTokens(theme, colors ?? { ...color, ink }, color.accent);
  const blocked = design.id !== "flat";
  const block = design.id === "block";
  const grid = design.id === "grid";
  const safe = stage(format);
  const unit = Math.min(format.width, format.height);
  const depth = unit * design.depth;
  const inset = blocked ? Math.min(unit * 0.036, rect.height * 0.08) : 0;
  const width = blocked ? rect.width - inset * 2 - depth : rect.width * 0.98;
  const count = text.trim().split(/\s+/).length;
  const maxLines = count >= 4 ? Math.min(3, Math.floor(count / 2)) : 2;
  const size = fitWords(text, width, blocked ? rect.height - inset * 2 : rect.height * 0.9, unit * 0.085, maxLines);
  const height = blocked ? Math.min(rect.height, wrappedLines(text, width, size) * size * 1.12 + inset * 2 + depth) : rect.height;
  const copy = <div data-promo-copy="true" style={{ position: "relative", width, fontFamily: display, fontWeight: grid ? 680 : blocked ? 760 : 680, fontSize: size, lineHeight: 1.12, letterSpacing: "-0.035em", color: grid ? design.textInk : blocked ? design.onAccent : ink, textWrap: "balance", ...wordsStyle }}>{text}</div>;
  return <Stage format={format}>
    <div data-promo-side-text="true" data-editorial-theme={design.id} style={{ color: grid ? design.textInk : ink, position: "absolute", left: rect.x - safe.x, top: rect.y - safe.y, width: rect.width, height: rect.height, display: "flex", alignItems: "center" }}>
      {blocked ? <div data-promo-side-face={grid ? "true" : undefined} style={{ position: "relative", width: rect.width, height, display: "flex", alignItems: "center", padding: inset, paddingRight: inset + depth, paddingBottom: inset + depth, boxSizing: "border-box", background: grid ? design.face : !block ? design.accent : undefined, borderRadius: unit * design.corner, boxShadow: grid ? `inset 0 0 0 ${design.border * unit / 1080}px ${design.rule}` : undefined }}>
        {block && <BlockPlate width={rect.width} height={height} radius={unit * design.corner} depth={depth} stroke={design.border * unit / 1080} fill={design.accent} outline={design.outline} />}
        {copy}
      </div> : copy}
    </div>
  </Stage>;
};

export const PromoRecap: React.FC<{
  format: Format;
  title?: string;
  rows: { id: string; text: string; visible: boolean; active: boolean; progress: number; checked?: number }[];
  colors: Inks;
  theme?: EditorialTheme;
}> = ({ format, title, rows, colors, theme }) => {
  const color = useColor();
  const design = promoThemeTokens(theme, colors, color.accent);
  const blocked = design.id !== "flat";
  const block = design.id === "block";
  const grid = design.id === "grid";
  const safe = stage(format);
  const unit = Math.min(format.width, format.height);
  const width = Math.min(safe.width * 0.9, unit * 1.22);
  const icon = unit * 0.039;
  const gap = unit * 0.025;
  const inset = blocked ? unit * 0.023 : 0;
  const depth = unit * design.depth;
  const textWidth = width - icon - gap - inset * 2 - depth;
  const rowBudget = Math.min(unit * 0.18, safe.height * 0.72 / Math.max(1, rows.length));
  const size = Math.min(unit * 0.055, ...rows.map((row) => fitWords(row.text, textWidth, rowBudget * 0.72, unit * 0.055)));
  const lines = Math.max(1, ...rows.map((row) => wrappedLines(row.text, textWidth, size)));
  const slot = Math.max(unit * 0.105, lines * size * 1.17 + unit * 0.045);
  const titleWidth = width - (block ? unit * 0.055 : 0);
  const titleSize = title ? fitWords(title, titleWidth, unit * 0.1, unit * 0.034) : 0;
  const titleHeight = title ? wrappedLines(title, titleWidth, titleSize) * titleSize * 1.2 + unit * 0.049 : 0;
  const settledInk = grid ? design.mutedInk : contrastRatio(colors.muted, blocked ? design.surface : colors.paper) >= 4.5 ? colors.muted : colors.ink;
  return <Stage format={format}>
    <div data-promo-recap="true" data-editorial-theme={design.id} style={{ position: "absolute", left: (safe.width - width) / 2, top: (safe.height - slot * rows.length - titleHeight) / 2, width, fontFamily: display, color: grid ? design.textInk : colors.ink }}>
      {title && <div data-recap-title="true" style={{ height: titleHeight, fontSize: titleSize, lineHeight: 1.2, fontWeight: block ? 650 : 520, letterSpacing: "-0.018em", color: block ? design.onSecondary : settledInk, ...wordsStyle }}>{block ? <span style={{ display: "inline-block", maxWidth: "100%", boxSizing: "border-box", padding: `${unit * 0.008}px ${unit * 0.021}px`, background: design.secondary, borderRadius: unit * 0.04, boxShadow: `inset 0 0 0 ${unit * 0.0025}px ${design.outline}` }}>{title}</span> : title}</div>}
      {rows.map((row, index) => {
        const checked = Math.max(0, Math.min(1, row.checked ?? (row.active ? 0 : 1)));
        const press = block && row.active ? (1 - row.progress) * 0.5 : 0;
        const travel = press * depth;
        return <div key={row.id} data-promo-row={row.id} data-row-active={row.active} data-row-visible={row.visible} style={{ position: "relative", height: slot, display: "flex", gap, alignItems: "center", padding: `0 ${inset + depth}px 0 ${inset}px`, paddingBottom: depth, boxSizing: "border-box", color: block || grid ? design.textInk : row.active ? colors.ink : settledInk, opacity: row.visible ? 1 : 0 }}>
          {block ? <span aria-hidden="true" style={{ position: "absolute", left: 0, top: unit * 0.008 }}><BlockPlate width={width} height={slot - unit * 0.016} radius={unit * design.corner} depth={depth} stroke={design.border * unit / 1080} fill={design.surface} outline={design.outline} press={press} /></span> : blocked && <span aria-hidden="true" style={{ position: "absolute", inset: `${unit * 0.008}px 0`, background: design.surface, boxShadow: `inset 0 0 0 ${design.border * unit / 1080}px ${design.rule}`, borderRadius: unit * design.corner }} />}
          {!blocked && index < rows.length - 1 && <svg data-recap-rail="true" width={icon} height={slot - icon} viewBox={`0 0 ${icon} ${slot - icon}`} aria-hidden="true" style={{ position: "absolute", left: 0, top: (slot + icon) / 2, color: colors.ink, opacity: 0.15 }}><path d={`M${icon / 2} 0V${slot - icon}`} fill="none" stroke="currentColor" strokeWidth={Math.max(1, unit * 0.0012)} /></svg>}
          <svg width={icon} height={icon} viewBox="0 0 32 32" aria-hidden="true" style={{ position: "relative", flexShrink: 0, color: blocked ? design.onAccent : colors.ink, transform: block ? `translate(${travel.toFixed(3)}px, ${travel.toFixed(3)}px)` : undefined }}>
            {blocked ? <rect x="1.5" y="1.5" width="29" height="29" rx={block ? 8 : 3} fill={design.accent} stroke={block ? design.outline : undefined} strokeWidth={block ? 2.3 : undefined} /> : <circle cx="16" cy="16" r="12.5" stroke="currentColor" strokeWidth="1.65" fill="none" opacity={0.45 + checked * 0.55} />}
            <circle cx="16" cy="16" r="3" fill="currentColor" opacity={row.active ? 1 - checked : 0} />
            <path data-recap-check="true" data-checked={checked} d="m10 16 4 4 8-9" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - checked} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity={checked > 0 ? 1 : 0} />
          </svg>
          <div data-recap-copy="true" style={{ position: "relative", width: textWidth, fontWeight: block ? 700 : blocked ? 650 : 610, fontSize: size, lineHeight: 1.17, letterSpacing: "-0.024em", textWrap: "balance", transform: block ? `translate(${travel.toFixed(3)}px, ${travel.toFixed(3)}px)` : `translateY(${((1 - row.progress) * unit * (blocked ? 0.004 : 0.008)).toFixed(3)}px)`, ...wordsStyle }}>{row.text}</div>
        </div>;
      })}
    </div>
  </Stage>;
};


export { PromoSource } from "./PromoSource.tsx";
