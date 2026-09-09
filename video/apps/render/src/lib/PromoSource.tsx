/* Sourced text is the content; the frame only supplies hierarchy and a stable reading grid. */
import { stage, type EditorialTheme, type Format } from "@panoma/video-core";
import { contrastRatio } from "@panoma/video-brand/contrast";
import { mix } from "@panoma/video-brand/direction";
import { promoThemeTokens } from "../recipes/editorial.ts";
import { display, mono } from "./fonts.ts";
import { Stage } from "./layout.tsx";
import { useColor } from "./theme-context.tsx";
import { BlockPlate } from "./BlockPlate.tsx";

type Inks = { paper: string; ink: string; muted: string };
type Token = { text: string; role: "plain" | "comment" | "string" | "keyword" | "number" };
type SourceLine = { tokens: Token[]; text: string; from: number; newline: boolean };

function sourceTokens(text: string, terminal: boolean): Token[] {
  if (terminal) return (text.match(/\S+|\s+/g) ?? []).map((text) => ({ text, role: "plain" }));
  const tokens: Token[] = [];
  const pattern = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|async|await|import|from|export|default|if|else|class|new|def|True|False|None|true|false|null|type|interface|extends|implements|try|catch|throw)\b|\b\d+(?:\.\d+)?\b)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) tokens.push({ text: text.slice(cursor, match.index), role: "plain" });
    const token = match[0];
    tokens.push({ text: token, role: /^(\/\/|\/\*|#)/.test(token) ? "comment" : /^["'`]/.test(token) ? "string" : /^\d/.test(token) ? "number" : "keyword" });
    cursor = match.index + token.length;
  }
  if (cursor < text.length) tokens.push({ text: text.slice(cursor), role: "plain" });
  return tokens;
}

/** Split the already-tokenized excerpt so a multiline comment keeps its syntax role. */
function linesOf(text: string, terminal: boolean): SourceLine[] {
  const lines: SourceLine[] = [{ tokens: [], text: "", from: 0, newline: false }];
  for (const token of sourceTokens(text, terminal)) {
    const pieces = token.text.split("\n");
    for (const [i, part] of pieces.entries()) {
      const line = lines.at(-1)!;
      if (part) { line.tokens.push({ ...token, text: part }); line.text += part; }
      if (i < pieces.length - 1) {
        line.newline = true;
        lines.push({ tokens: [], text: "", from: line.from + [...line.text].length + 1, newline: false });
      }
    }
  }
  return lines;
}

/** The font is monospaced; emoji and CJK need two cells, tabs use the displayed two-cell stop. */
function cells(text: string): number {
  let count = 0;
  for (const char of text) count += char === "\t" ? 2 - count % 2 : /[\p{Extended_Pictographic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char) ? 2 : /[\p{Mark}\u200d\ufe0f]/u.test(char) ? 0 : 1;
  return count;
}

/** CSS preserves source whitespace and prefers whole words before breaking a long token. */
function wrappedLines(text: string, columns: number): number {
  let lines = 1;
  let used = 0;
  for (const token of text.match(/\S+|\s+/g) ?? []) {
    const length = cells(token);
    if (/\S/.test(token) && used && used + length > columns) { lines++; used = 0; }
    used += length;
    while (used > columns) { lines++; used -= columns; }
  }
  return lines;
}

/** A documented command or repository excerpt, never an invented execution or its output. */
export const PromoSource: React.FC<{
  format: Format;
  kind: "terminal" | "code";
  text: string;
  source?: string;
  visibleCount: number;
  caret: boolean;
  colors: Inks;
  theme?: EditorialTheme;
  /** A caller-provided arrival before typing starts; source glyphs never scale. */
  entrance?: number;
  caretOpacity?: number;
}> = ({ format, kind, text, source, visibleCount, caret, colors, theme, entrance = 1, caretOpacity = 1 }) => {
  const safe = stage(format);
  const color = useColor();
  const terminal = kind === "terminal";
  const lines = linesOf(text, terminal);
  const unit = Math.min(format.width, format.height);
  const pad = unit * 0.041;
  const maximumWidth = safe.width * 0.94;
  const desired = unit * (terminal ? 0.066 : 0.043);
  const gutter = terminal ? desired * 1.12 : desired * (String(lines.length).length * 0.62 + 1.22);
  /* Short commands get a deliberate compact stage; long excerpts earn more of the canvas. */
  const naturalWidth = Math.max(...lines.map((line) => cells(line.text)), 1) * desired * 0.62 + gutter + pad * 2;
  const width = Math.min(maximumWidth, Math.max(Math.min(safe.width * 0.72, unit * 1.16), naturalWidth));
  const textWidth = width - pad * 2 - gutter;
  const longestToken = Math.max(1, ...(text.match(/\S+/g) ?? []).map(cells));
  let fontSize = terminal ? Math.min(desired, Math.max(unit * 0.03, textWidth / (longestToken * 0.62))) : desired;
  const headerHeight = unit * 0.074;
  for (let pass = 0; pass < 48; pass++) {
    const columns = Math.max(1, Math.floor(textWidth / (fontSize * 0.62)));
    const rowCount = lines.reduce((sum, line) => sum + wrappedLines(line.text, columns), 0);
    if (rowCount * fontSize * 1.58 + pad * 2 + headerHeight <= safe.height * 0.88) break;
    fontSize *= 0.96;
  }
  const columns = Math.max(1, Math.floor(textWidth / (fontSize * 0.62)));
  const rowHeights = lines.map((line) => wrappedLines(line.text, columns) * fontSize * 1.58);
  const contentHeight = Math.max(fontSize * (terminal ? 2.15 : 2.8), rowHeights.reduce((sum, height) => sum + height, 0));
  const height = headerHeight + contentHeight + pad * 2;
  const label = source ?? (terminal ? "Terminal" : "Code");
  const tokens = promoThemeTokens(theme, colors, color.accent);
  const block = tokens.id === "block";
  const labelSize = Math.min(unit * 0.026, (width - pad * 2 - unit * (block ? 0.087 : 0.055)) / Math.max(1, [...label].length * 0.59));
  const depth = tokens.depth * unit;
  /* A source panel may arrive only while its excerpt is still hidden. */
  const arrival = visibleCount > 0 ? 1 : Math.max(0, Math.min(1, entrance));
  const travel = block ? depth * (1 - arrival) : 0;
  const { surface, activeSurface, textInk, mutedInk } = tokens;
  const lineInk = tokens.rule;
  const readable = (candidate: string) => contrastRatio(candidate, surface) >= 4.5 && contrastRatio(candidate, activeSurface) >= 4.5 ? candidate : textInk;
  const syntaxInk = readable(tokens.accent);
  const stringInk = readable(syntaxInk === textInk ? mix(textInk, surface, 0.24) : mix(textInk, syntaxInk, 0.45));
  const lastVisible = Math.max(0, Math.min([...text].length - 1, visibleCount - 1));
  const activeLine = lines.reduce((active, line, i) => line.from <= lastVisible ? i : active, 0);
  const cursor = (at: number, newline = false) => caret && at === Math.max(0, visibleCount - 1) ? <span data-source-caret="true" aria-hidden="true" style={{ position: "absolute", right: visibleCount && !newline ? "-0.12em" : undefined, left: !visibleCount || newline ? 0 : undefined, top: "0.08em", height: "1.12em", width: terminal ? "0.09em" : "0.065em", background: syntaxInk, opacity: Math.max(0, Math.min(1, caretOpacity)), visibility: "visible" }} /> : null;
  return <Stage format={format}>
    <div data-promo-source={kind} data-source-panel="true" data-editorial-theme={tokens.id} data-theme-accent-origin={tokens.accentOrigin} data-source-surface={surface} style={{ position: "absolute", left: (safe.width - width) / 2, top: (safe.height - height) / 2, width, height, color: textInk, fontFamily: mono, background: block ? undefined : surface, borderRadius: unit * tokens.corner, boxShadow: block ? undefined : `inset 0 0 0 ${tokens.border * unit / 1080}px ${lineInk}`, overflow: block ? "visible" : "hidden", transform: tokens.id === "vibrant" ? `translateY(${((1 - arrival) * unit * 0.012).toFixed(3)}px)` : undefined }}>
      {block && <BlockPlate width={width + depth} height={height + depth} depth={depth} radius={unit * tokens.corner} stroke={tokens.border * unit / 1080} fill={surface} outline={tokens.outline} press={1 - arrival} />}
      <div data-source-face-content="true" style={{ position: "relative", width, height, transform: block ? `translate(${travel.toFixed(3)}px, ${travel.toFixed(3)}px)` : undefined }}>
      <div data-source-label="true" style={{ height: headerHeight, padding: `0 ${pad}px`, display: "flex", alignItems: "center", gap: unit * 0.013, fontFamily: display, fontSize: labelSize, fontWeight: tokens.id !== "flat" ? 650 : 500, letterSpacing: "0.004em", lineHeight: 1.2, color: tokens.headerInk, background: block ? undefined : tokens.header, boxShadow: `inset 0 -${block ? tokens.border * unit / 1080 : 1}px ${lineInk}`, whiteSpace: "nowrap" }}>
        {terminal ? <svg data-terminal-chrome="true" width={unit * 0.027} height={unit * 0.027} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}><path d="m5 6 6 6-6 6m9 0h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          : <svg data-code-chrome="true" width={unit * 0.027} height={unit * 0.027} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}><path d="m7 6-5 6 5 6m10-12 5 6-5 6m-4-15-2 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        <span data-source-label-chip={block ? "true" : undefined} style={block ? { padding: `${unit * 0.008}px ${unit * 0.016}px`, borderRadius: unit * 0.025, background: tokens.secondary, color: tokens.onSecondary, boxShadow: `inset 0 0 0 ${unit * 0.0025}px ${tokens.outline}` } : undefined}>{label}</span>
      </div>
      <div data-source-body="true" style={{ position: "absolute", left: pad, right: pad, top: headerHeight + pad, height: contentHeight, fontSize, lineHeight: 1.58 }}>
        {lines.map((line, row) => {
          let index = line.from;
          const active = !terminal && caret && row === activeLine;
          return <div key={row} data-source-line={row + 1} data-source-line-active={active} style={{ position: "relative", display: "flex", width: "100%", height: rowHeights[row], background: active ? activeSurface : undefined, borderRadius: unit * 0.004 }}>
            {terminal ? <span data-terminal-prompt={row === 0 ? "true" : undefined} aria-hidden="true" style={{ width: gutter, flexShrink: 0, fontWeight: 500, color: syntaxInk }}>{row === 0 ? "$" : ""}</span>
              : <span data-source-line-number={row + 1} aria-hidden="true" style={{ width: gutter - fontSize * 0.5, marginRight: fontSize * 0.5, paddingRight: fontSize * 0.5, textAlign: "right", boxSizing: "border-box", flexShrink: 0, fontSize: fontSize * 0.66, lineHeight: `${fontSize * 1.58}px`, color: active ? syntaxInk : mutedInk, opacity: active ? 1 : 0.66, fontVariantNumeric: "tabular-nums", boxShadow: `inset -1px 0 ${lineInk}` }}>{row + 1}</span>}
            <pre data-source-text="true" style={{ margin: 0, width: textWidth, fontFamily: mono, fontSize, lineHeight: 1.58, whiteSpace: "pre-wrap", overflowWrap: "anywhere", tabSize: 2 }}>
              {line.tokens.map((token, tokenIndex) => <span key={tokenIndex} data-source-token={terminal && /\S/.test(token.text) ? token.text : undefined} style={terminal && /\S/.test(token.text) && cells(token.text) <= columns ? { whiteSpace: "pre", display: "inline-block" } : undefined}>{[...token.text].map((char) => {
                const at = index++;
                const visible = at < visibleCount;
                return <span key={at} data-source-char={at} data-revealed={visible} style={{ visibility: visible ? "visible" : "hidden", color: token.role === "comment" ? mutedInk : token.role === "string" ? stringInk : token.role === "keyword" || token.role === "number" ? syntaxInk : textInk, fontWeight: token.role === "keyword" ? 600 : 450, position: "relative" }}>{char}{cursor(at)}</span>;
              })}</span>)}
              {line.newline && <span data-source-char={index} data-revealed={index < visibleCount} style={{ position: "absolute", width: 0, height: 0, visibility: "hidden" }}>{"\n"}{cursor(index, true)}</span>}
              {!text && row === 0 && caret && <span data-source-caret="true" style={{ display: "inline-block", width: "0.09em", height: "1.12em", background: syntaxInk, opacity: caretOpacity }} />}
            </pre>
          </div>;
        })}
      </div>
      </div>
    </div>
  </Stage>;
};
