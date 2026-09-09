/* Titles are a finite editorial gesture followed by a reading hold, never footage overlays. */
import { makeGrid, stage, type EditorialTheme, type Format } from "@panoma/video-core";
import type { PromoTitleRole } from "../recipes/timing.ts";
import { promoAssemblyParts, promoAssemblyMotion, promoTitleMotion } from "../recipes/timing.ts";
import type { PromoThemeTokens } from "../recipes/editorial.ts";
import { display, wide } from "./fonts.ts";
import { Stage, cardSize } from "./layout.tsx";
import { BlockPlate } from "./BlockPlate.tsx";

const wordWidth = (word: string) => [...word].reduce((sum, char) => sum + (/[MWmw@#%]/.test(char) ? 0.98 : /[iljI.,!;:'|]/.test(char) ? 0.34 : 0.69), 0);

/** A conservative word budget also reserves the Block border, base and breathing room. */
function titleLayout(format: Format, text: string, block: boolean, assembly: boolean) {
  const safe = stage(format);
  const unit = Math.min(format.width, format.height);
  const width = safe.width * (assembly ? 0.86 : block ? 0.9 : 0.94);
  const inset = block ? unit * 0.065 : 0;
  const room = width - inset * 2;
  const words = text.trim().split(/\s+/).filter(Boolean);
  let size = Math.min(cardSize(format, text), room / Math.max(1, ...words.map(wordWidth))) * (block ? 0.90 : 1);
  const linesAt = (size: number) => {
    let lines = 1; let used = 0;
    for (const word of words) {
      const next = wordWidth(word) * size;
      if (used && used + size * 0.34 + next > room) { lines++; used = next; }
      else used += (used ? size * 0.34 : 0) + next;
    }
    return lines;
  };
  while (size > 12 && (linesAt(size) > 3 || linesAt(size) * size * 1.12 + inset * 2 > safe.height * 0.7)) size *= 0.96;
  return { width, inset, size: Math.floor(size), height: linesAt(size) * size * 1.12 + inset * 2 };
}

const Arrow: React.FC<{ size: number }> = ({ size }) => <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M5 12h14m-6-6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" /></svg>;

export const PromoTitle: React.FC<{
  format: Format;
  text: string;
  role: PromoTitleRole;
  from: number;
  to: number;
  frame: number;
  fps: number;
  beatFrames?: number;
  theme?: EditorialTheme;
  design: PromoThemeTokens;
  ink: string;
}> = ({ format, text, role, from, to, frame, fps, beatFrames = 15, theme, design, ink }) => {
  const safe = stage(format);
  const unit = Math.min(format.width, format.height);
  const block = design.id === "block";
  const vibrant = design.id === "vibrant";
  const motion = promoTitleMotion(theme, role, from, to, frame, fps, beatFrames);
  const close = role === "end";
  const [brand, ...address] = text.split("\n");
  const destination = address.join(" ");
  const layout = titleLayout(format, close ? brand : text, block, design.id === "grid");
  const depth = unit * design.depth;
  const stroke = design.border * unit / 1080;
  const travel = depth * motion.press;
  const textStyle = { fontFamily: block ? wide : display, fontWeight: block ? 780 : vibrant ? 850 : 800, fontSize: layout.size, lineHeight: 1.08, letterSpacing: block ? "-0.025em" : "-0.035em", fontVariationSettings: block ? '"wdth" 100' : undefined, color: block ? design.textInk : ink, textWrap: "balance" as const, whiteSpace: "pre-line" as const, overflowWrap: "normal" as const, wordBreak: "normal" as const, hyphens: "none" as const };
  const title = close ? brand : text;
  const fragments = design.id === "grid" ? promoAssemblyParts(title, from, to, makeGrid({ fps, bpm: fps * 60 / beatFrames })) : [];
  const headline = <div data-title-copy="true" style={textStyle}>{design.id === "grid" ? fragments.map((part, index) => {
    const state = promoAssemblyMotion(part, index, frame);
    /* Words may wrap between stable slots, including in a narrow format. A long
       phrase fragment is never made into an unbreakable inline box. */
    return <span key={index} data-assembly-part={index} data-assembly-from={part.from} data-assembly-settle={part.settledAt}>{part.text.split(/(\s+)/u).map((word, i) => /^\s*$/u.test(word) ? word : <span key={i} data-assembly-word="true" style={{ display: "inline-block", opacity: state.opacity, transform: `translate(${(state.x * unit).toFixed(3)}px, ${(state.y * unit).toFixed(3)}px) rotate(${state.rotate.toFixed(3)}deg) scale(${state.scale.toFixed(5)})`, transformOrigin: "center" }}>{word}</span>)}</span>;
  }) : title}</div>;
  /* A destination is quoted, not relabelled as an invented offer such as "Try free".
     Its button shape expresses the close; no fabricated pointer press or result follows. */
  const buttonWidth = Math.min(safe.width * 0.84, unit * 1.10);
  const buttonInset = unit * 0.035;
  const arrowSize = unit * 0.044;
  const urlSize = Math.max(1, Math.min(unit * 0.047, (buttonWidth - depth - buttonInset * 2 - arrowSize * 1.6) / Math.max(1, [...destination].length * 0.67)));
  const buttonHeight = urlSize * 1.35 + buttonInset * 2 + depth;
  return <Stage format={format}>
    <div data-promo-title={role} data-title-style={motion.style} data-title-settle={motion.settleFrame} data-editorial-theme={design.id} style={{ color: ink, position: "absolute", inset: 0, display: "flex", justifyContent: "center", alignItems: "center" }}>
      <div style={{ width: layout.width, textAlign: vibrant ? "left" : "center", transform: `translateY(${(unit * motion.translateY).toFixed(3)}px) scale(${motion.scale.toFixed(5)})`, transformOrigin: "center" }}>
        {block && !close ? <div style={{ position: "relative", width: layout.width, height: layout.height + depth }}>
          <BlockPlate width={layout.width} height={layout.height + depth} radius={unit * design.corner} depth={depth} stroke={stroke} fill={design.face} outline={design.outline} press={motion.press} />
          <div style={{ position: "absolute", inset: `0 ${depth}px ${depth}px 0`, display: "flex", alignItems: "center", justifyContent: "center", padding: layout.inset, boxSizing: "border-box", transform: `translate(${travel.toFixed(3)}px, ${travel.toFixed(3)}px)` }}>{headline}</div>
          <div aria-hidden="true" style={{ position: "absolute", right: layout.inset, bottom: layout.inset * 0.32, width: unit * 0.11, height: unit * 0.012, background: design.accent, borderRadius: unit * 0.006, transform: `translate(${travel.toFixed(3)}px, ${travel.toFixed(3)}px)` }} />
        </div> : headline}
        {vibrant && <div data-title-accent="true" aria-hidden="true" style={{ marginTop: unit * 0.045, width: Math.min(layout.width * 0.36, unit * 0.5), height: unit * 0.018, background: design.accent, borderRadius: unit * 0.006, transform: `scaleX(${motion.accentProgress.toFixed(5)})`, transformOrigin: "left" }} />}
        {close && destination && (block || vibrant ? <div data-promo-cta="true" data-cta-press={motion.press.toFixed(5)} style={{ position: "relative", width: buttonWidth, height: buttonHeight, marginTop: unit * 0.062, marginLeft: vibrant ? 0 : "auto", marginRight: "auto" }}>
          {block ? <BlockPlate width={buttonWidth} height={buttonHeight} radius={unit * design.corner} depth={depth} stroke={stroke} fill={design.accent} outline={design.outline} press={motion.press} /> : <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: design.accent, borderRadius: unit * design.corner }} />}
          <div style={{ position: "absolute", inset: `0 ${depth}px ${depth}px 0`, display: "flex", gap: arrowSize * 0.6, alignItems: "center", justifyContent: "space-between", padding: `0 ${buttonInset}px`, color: design.onAccent, boxSizing: "border-box", transform: `translate(${travel.toFixed(3)}px, ${travel.toFixed(3)}px)` }}>
            <span data-cta-destination="true" style={{ fontFamily: display, fontWeight: 650, fontSize: urlSize, lineHeight: 1.2, whiteSpace: "nowrap" }}>{destination}</span><Arrow size={arrowSize} />
          </div>
        </div> : <div data-cta-destination="true" style={{ marginTop: layout.size * 0.2, fontFamily: display, fontWeight: 500, fontSize: Math.min(layout.size * 0.42, safe.width * 0.88 / Math.max(1, [...destination].length * 0.65)), lineHeight: 1.2, color: ink, whiteSpace: "nowrap" }}>{destination}</div>)}
      </div>
    </div>
  </Stage>;
};
