/* Exact sourced benefits land as a compact stack of folded, monochrome paper. */
import { stage, type Format } from "@panoma/video-core";
import type { PromoThemeTokens } from "../recipes/editorial.ts";
import { display } from "./fonts.ts";
import { Stage } from "./layout.tsx";

type Row = { id: string; text: string; visible: boolean; progress: number; active: boolean; checked?: number };
type Inks = { paper: string; ink: string; muted: string };
const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
/* This conservative measure reserves the entrance before Chromium gives each card
   its natural text height. A short benefit never inherits a longer card's padding. */
const units = (text: string) => [...text].reduce((sum, char) => sum + (/[MWmw@#%]/.test(char) ? 0.94 : /[iljI.,!;:'|]/.test(char) ? 0.32 : /[frt()[\]]/.test(char) ? 0.44 : /[A-Z]/.test(char) ? 0.74 : 0.61), 0);
function linesOf(text: string, width: number, size: number): number {
  return text.split("\n").reduce((total, paragraph) => {
    let lines = 1; let occupied = 0;
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      const next = units(word) * size;
      if (occupied && occupied + size * 0.34 + next > width) { lines++; occupied = next; }
      else occupied += (occupied ? size * 0.34 : 0) + next;
    }
    return total + lines;
  }, 0);
}

/** A bent silhouette surrounds rigid type. At rest the curves become straight edges. */
function surfacePath(width: number, height: number, radius: number, bend: number, stroke: number): string {
  const x = stroke / 2; const y = stroke / 2;
  const right = width - stroke / 2; const bottom = height - stroke / 2;
  const r = Math.min(radius, width / 4, height / 4);
  return `M${x + r} ${y} C${width * 0.24} ${y - bend} ${width * 0.76} ${y + bend} ${right - r} ${y}` +
    ` Q${right} ${y} ${right} ${y + r} C${right + bend * 0.15} ${height * 0.3} ${right - bend * 0.1} ${height * 0.7} ${right} ${bottom - r}` +
    ` Q${right} ${bottom} ${right - r} ${bottom} C${width * 0.72} ${bottom + bend * 0.8} ${width * 0.25} ${bottom - bend * 0.65} ${x + r} ${bottom}` +
    ` Q${x} ${bottom} ${x} ${bottom - r} C${x - bend * 0.12} ${height * 0.66} ${x + bend * 0.12} ${height * 0.3} ${x} ${y + r} Q${x} ${y} ${x + r} ${y} Z`;
}

export const GridRecap: React.FC<{
  format: Format;
  title?: string;
  rows: Row[];
  colors: Inks;
  design: PromoThemeTokens;
}> = ({ format, title, rows, design }) => {
  if (!rows.length) return null;
  const safe = stage(format);
  const unit = Math.min(format.width, format.height);
  const width = Math.min(safe.width * 0.99, unit * 1.5);
  const side = unit * 0.085;
  const stagger = unit * 0.022;
  const cardWidth = width - side * 2 - stagger * Math.max(0, rows.length - 1);
  const overlap = unit * 0.018;
  const pad = unit * 0.033;
  const lowerMargin = overlap + unit * 0.033;
  const rail = unit * 0.023;
  const textWidth = cardWidth - pad * 2 - rail;
  const titleWidth = cardWidth;
  const titleSize = title ? Math.min(unit * 0.032, titleWidth / Math.max(1, ...title.split(/\s+/).map(units))) : 0;
  const titleHeight = title ? linesOf(title, titleWidth, titleSize) * titleSize * 1.2 : 0;
  /* The envelope includes the full fly-in, bowed edges and visible rear sheets.
     Only empty paper margins overlap; finished words never move for the next card. */
  const headroom = unit * 0.075;
  const footroom = unit * 0.17;
  const available = safe.height - titleHeight - headroom - footroom;
  let size = Math.min(unit * 0.059, textWidth / Math.max(1, ...rows.flatMap((row) => row.text.split(/\s+/).map(units))));
  const heightAt = (font: number, text: string) => linesOf(text, textWidth, font) * font * 1.12 + pad + lowerMargin;
  const deckHeightAt = (font: number) => rows.reduce((height, row) => height + heightAt(font, row.text), 0) - Math.max(0, rows.length - 1) * overlap;
  for (let pass = 0; pass < 60 && deckHeightAt(size) > available; pass++) size *= 0.96;
  size = Math.max(1, Math.floor(size));
  const stroke = Math.max(1.3, unit * 0.0015);
  const ply = unit * 0.0035;
  const fold = unit * 0.027;
  return <Stage format={format}>
    <div data-promo-recap="true" data-grid-recap="true" data-editorial-theme={design.id} style={{ position: "absolute", left: (safe.width - width) / 2, top: "50%", width, paddingBottom: footroom, transform: "translateY(-50%)", fontFamily: display, color: design.textInk }}>
      {title && <div data-recap-title="true" style={{ position: "relative", marginLeft: side, width: titleWidth, fontSize: titleSize, lineHeight: 1.2, fontWeight: 560, color: design.textInk, letterSpacing: "-0.02em", whiteSpace: "pre-line", overflowWrap: "normal", wordBreak: "normal" }}>{title}</div>}
      <div style={{ height: headroom }} />
      {rows.map((row, index) => {
        const progress = clamp(row.progress);
        const remaining = 1 - progress;
        const direction = index % 2 === 0 ? -1 : 1;
        const bend = progress === 1 ? 0 : Math.sin(Math.PI * progress) * unit * 0.1 * direction;
        const translateX = direction * remaining * unit * 0.055;
        const translateY = remaining * unit * 0.11;
        const rotate = direction * remaining * 5.5;
        const height = heightAt(size, row.text);
        const path = surfacePath(cardWidth, height, unit * 0.01, bend, stroke);
        return <div key={row.id} data-promo-row={row.id} data-grid-card="true" data-grid-bend={bend.toFixed(3)} data-row-active={row.active} data-row-visible={row.visible} style={{ position: "relative", marginLeft: side + index * stagger, marginTop: index ? -overlap : 0, width: cardWidth, zIndex: index + 1, opacity: row.visible ? 1 : 0, pointerEvents: row.visible ? "auto" : "none", transform: `translate(${translateX.toFixed(3)}px, ${translateY.toFixed(3)}px) rotate(${rotate.toFixed(4)}deg)`, transformOrigin: "center", color: design.textInk }}>
          <svg data-grid-surface="true" width={cardWidth} height="100%" viewBox={`0 0 ${cardWidth} ${height}`} preserveAspectRatio="none" aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}>
            {[2, 1].map((layer) => <path key={layer} data-grid-ply={layer} d={path} transform={`translate(${ply * layer},${ply * layer})`} fill={design.surface} stroke={design.textInk} strokeWidth={stroke} strokeOpacity={0.55} />)}
            <path data-grid-face="true" d={path} fill={design.surface} stroke={design.textInk} strokeWidth={stroke} strokeOpacity={0.8} />
            <path data-grid-fold="true" d={`M${cardWidth - fold - stroke} ${stroke}v${fold}h${fold}M${cardWidth - fold - stroke} ${stroke}l${fold} ${fold + bend * 0.18}`} fill="none" stroke={design.textInk} strokeWidth={stroke} strokeOpacity={0.45} />
          </svg>
          <div data-grid-margin="true" aria-hidden="true" style={{ position: "absolute", left: pad * 0.56, top: pad + size * 0.12, width: unit * 0.006, height: size * 0.7, background: design.textInk }} />
          <div style={{ position: "relative", marginLeft: pad + rail, paddingTop: pad, paddingBottom: lowerMargin }}>
            <div data-recap-copy="true" data-grid-copy-plane="true" style={{ width: textWidth, fontSize: size, lineHeight: 1.12, fontWeight: 680, letterSpacing: "-0.03em", textWrap: "balance", whiteSpace: "pre-line", overflowWrap: "normal", wordBreak: "normal", hyphens: "none" }}>{row.text}</div>
          </div>
        </div>;
      })}
    </div>
  </Stage>;
};
