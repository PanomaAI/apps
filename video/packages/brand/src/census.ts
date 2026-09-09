/*
  One CDP call instead of a querySelectorAll('*') loop. `DOMSnapshot.captureSnapshot`
  returns every node's requested computed styles, its layout bounds and its text in
  one round trip — the same primitive Chromium's own CSS Overview panel uses
  (devtools-frontend, front_end/panels/css_overview/CSSOverviewModel.ts) — so a colour
  can be weighted by the pixels it actually paints rather than by how many elements
  mention it. That distinction is the whole reason this file exists: a page of five
  hundred grey <span>s and one hero in the brand colour must not report grey.

  The scoring that turns occurrences into brand evidence is dembrandt's, applied to
  the snapshot rows instead of live elements: a context score per element from its
  class/id/tag words (logo 5, brand 5, primary 4, cta 4, hero 3, button 3, …), lifted
  through up to four ancestors, and an opaque CTA background counted separately
  because it is the strongest primary signal a page gives. Copyright (c) 2025
  thevangelist, MIT License.

  Borders are deliberately not counted. A computed border-top-color exists on every
  element whether or not a border is drawn (it is currentColor by default), so
  counting it multiplies the text colour by the element count and says nothing.
*/
import { parseColor, toHex } from "./color.ts";
import { firstFamily } from "./fonts.ts";
import type { Census, ColorUse } from "./roles.ts";

/** The styles requested from the snapshot, in this order. */
export const SNAPSHOT_STYLES = ["background-color", "color", "font-family", "font-size", "font-weight", "visibility", "opacity"] as const;

/* The slice of the protocol response this file reads (https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/). */
export type DomSnapshot = {
  documents: {
    contentWidth?: number;
    contentHeight?: number;
    nodes: {
      parentIndex: number[];
      nodeType: number[];
      nodeName: number[];
      nodeValue: number[];
      attributes: number[][];
    };
    layout: {
      nodeIndex: number[];
      styles: number[][];
      bounds: number[][];
      text: number[];
    };
  }[];
  strings: string[];
};

export type FontCensus = {
  /** family → characters, for all visible text. */
  all: Record<string, number>;
  headings: Record<string, number>;
  /** Reading copy, 11–24px, outside headings and code. */
  body: Record<string, number>;
  mono: Record<string, number>;
  /** The family of the first h1 with text. */
  h1?: string;
};

export type SnapshotCensus = {
  census: Census;
  fonts: FontCensus;
  body: { background: string; text?: string };
};

/* dembrandt's CONTEXT_SCORES and the ancestor-lift cap. */
const CONTEXT_SCORES: Record<string, number> = {
  logo: 5, brand: 5, primary: 4, cta: 4, hero: 3, button: 3,
  card: 2, section: 2, feature: 2, panel: 2, input: 2, badge: 2, chip: 2,
  footer: 2, link: 2, header: 2, nav: 1,
};
const ANCESTOR_LIFT_MAX = 2;

/* Status/feedback and warm-utility classes: not brand identity unless declared or a CTA. */
const STATUS_CONTEXT =
  /\b(error|danger|destructive|invalid|warning|success|alert|notice|sale|discount|toast|notification)\b|(?:text|bg|border|ring|fill|stroke|from|to|via|divide|outline|decoration|accent|caret)-(?:red|rose|orange|amber|yellow)-\d/;

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "HEAD", "META", "LINK", "TITLE", "NOSCRIPT", "TEMPLATE"]);
const HEADING = /^H[1-6]$/;
const CODE_TAGS = new Set(["PRE", "CODE", "KBD", "SAMP"]);

type Row = { name: string; type: number; attrs: Record<string, string>; style: Record<string, string>; bounds: number[]; text: string; parent: number };

/** Everything the census needs about one snapshot row, or null when it paints nothing. */
function rowOf(doc: DomSnapshot["documents"][number], strings: string[], i: number): Row | null {
  const ni = doc.layout.nodeIndex[i];
  const bounds = doc.layout.bounds[i] ?? [0, 0, 0, 0];
  if (!(bounds[2] > 0) || !(bounds[3] > 0)) return null;
  const style: Record<string, string> = {};
  const styleIdx = doc.layout.styles[i] ?? [];
  SNAPSHOT_STYLES.forEach((name, k) => {
    const s = styleIdx[k];
    style[name] = s !== undefined && s >= 0 ? strings[s] : "";
  });
  if (style.visibility === "hidden" || style.opacity === "0") return null;
  const attrs: Record<string, string> = {};
  const flat = doc.nodes.attributes[ni] ?? [];
  for (let k = 0; k + 1 < flat.length; k += 2) attrs[strings[flat[k]]] = strings[flat[k + 1]];
  const textIdx = doc.layout.text[i];
  const valueIdx = doc.nodes.nodeValue[ni];
  const text = textIdx >= 0 ? strings[textIdx] : valueIdx >= 0 ? strings[valueIdx] : "";
  return { name: strings[doc.nodes.nodeName[ni]], type: doc.nodes.nodeType[ni], attrs, style, bounds, text, parent: doc.nodes.parentIndex[ni] };
}

/** Class, id and data hooks of a node, lowercased, for the context score. */
function contextOf(name: string, attrs: Record<string, string>): string {
  return [attrs.class ?? "", attrs.id ?? "", attrs["data-cta"] ?? "", attrs["data-component"] ?? "", attrs.role ?? "", name].join(" ").toLowerCase();
}

export function censusFromSnapshot(snapshot: DomSnapshot): SnapshotCensus {
  const doc = snapshot.documents[0];
  const strings = snapshot.strings;
  const docArea = Math.max(1, (doc.contentWidth ?? 1280) * (doc.contentHeight ?? 800));
  const colors = new Map<string, ColorUse>();
  const fonts: FontCensus = { all: {}, headings: {}, body: {}, mono: {} };
  const body: SnapshotCensus["body"] = { background: "#ffffff" };
  let totalElements = 0;

  /* Attributes by node index for the ancestor lift and for text-node parents. */
  const attrsAt = (ni: number): Record<string, string> => {
    const out: Record<string, string> = {};
    const flat = doc.nodes.attributes[ni] ?? [];
    for (let k = 0; k + 1 < flat.length; k += 2) out[strings[flat[k]]] = strings[flat[k + 1]];
    return out;
  };
  const nameAt = (ni: number): string => strings[doc.nodes.nodeName[ni]] ?? "";

  const use = (hex: string): ColorUse => {
    let u = colors.get(hex);
    if (!u) {
      u = { hex, count: 0, area: 0, chars: 0, bgCount: 0, score: 0, ctaCount: 0, isToken: false, statusCount: 0, nonStatusCount: 0, sources: [] };
      colors.set(hex, u);
    }
    return u;
  };

  let htmlBackground: string | null = null;
  let bodyBackground: string | null = null;

  for (let i = 0; i < doc.layout.nodeIndex.length; i++) {
    const row = rowOf(doc, strings, i);
    if (!row) continue;

    if (row.type === 3) {
      const len = row.text.trim().length;
      if (!len) continue;
      const family = firstFamily(row.style["font-family"]);
      const size = parseFloat(row.style["font-size"]) || 16;
      if (family) {
        fonts.all[family] = (fonts.all[family] ?? 0) + len;
        let heading = false;
        let code = false;
        let hop = row.parent;
        for (let d = 0; d < 4 && hop >= 0; d++, hop = doc.nodes.parentIndex[hop]) {
          const n = nameAt(hop);
          if (HEADING.test(n)) {
            heading = true;
            if (n === "H1" && !fonts.h1) fonts.h1 = family;
          }
          if (CODE_TAGS.has(n)) code = true;
        }
        if (heading) fonts.headings[family] = (fonts.headings[family] ?? 0) + len;
        else if (code) fonts.mono[family] = (fonts.mono[family] ?? 0) + len;
        else if (size >= 11 && size <= 24) fonts.body[family] = (fonts.body[family] ?? 0) + len;
      }
      const ink = parseColor(row.style.color);
      if (ink && ink.a >= 0.3) use(toHex(ink)).chars += len;
      continue;
    }

    if (row.type !== 1 || SKIP_TAGS.has(row.name)) continue;
    totalElements++;

    const context = contextOf(row.name, row.attrs);
    let score = 1;
    for (const [keyword, weight] of Object.entries(CONTEXT_SCORES)) if (context.includes(keyword)) score = Math.max(score, weight);
    if (row.name === "A") score = Math.max(score, CONTEXT_SCORES.link);
    if (row.name === "BUTTON" || row.attrs.role === "button") score = Math.max(score, CONTEXT_SCORES.button);
    if (score <= ANCESTOR_LIFT_MAX) {
      let lift = 0;
      let hop = row.parent;
      for (let d = 0; d < 4 && hop >= 0 && lift < ANCESTOR_LIFT_MAX; d++, hop = doc.nodes.parentIndex[hop]) {
        const a = attrsAt(hop);
        const actx = `${a.class ?? ""} ${a.id ?? ""}`.toLowerCase();
        for (const [keyword, weight] of Object.entries(CONTEXT_SCORES)) {
          if (weight > ANCESTOR_LIFT_MAX) continue;
          if (actx.includes(keyword)) lift = Math.max(lift, Math.min(weight, ANCESTOR_LIFT_MAX));
        }
      }
      if (lift > score) score = lift;
    }
    const isStatus = STATUS_CONTEXT.test(context);
    const source = context.split(" ")[0].slice(0, 30);

    const bg = parseColor(row.style["background-color"]);
    const bgHex = bg && bg.a >= 0.3 ? toHex(bg) : null;
    const isCta =
      (context.includes("button") || context.includes("btn") || context.includes("cta")) &&
      bg !== null && bg.a >= 0.7 && bgHex !== null && !["#ffffff", "#000000", "#efefef"].includes(bgHex);
    if (isCta) score = Math.max(score, 25);

    if (row.name === "BODY" && bg && bg.a >= 0.9) bodyBackground = toHex(bg);
    if (row.name === "HTML" && bg && bg.a >= 0.9) htmlBackground = toHex(bg);
    if (row.name === "BODY") {
      const ink = parseColor(row.style.color);
      if (ink && ink.a >= 0.5) body.text = toHex(ink);
    }

    if (bgHex) {
      const u = use(bgHex);
      u.count++;
      u.bgCount++;
      u.score += score;
      if (bg && bg.a >= 0.7) u.area += Math.min(docArea, row.bounds[2] * row.bounds[3]);
      if (isCta) u.ctaCount++;
      if (isStatus) u.statusCount++;
      else u.nonStatusCount++;
      if (score > 1 && source && !source.includes("__") && !u.sources.includes(source) && u.sources.length < 5) u.sources.push(source);
    }
    const ink = parseColor(row.style.color);
    if (ink && ink.a >= 0.3) {
      const hex = toHex(ink);
      if (hex !== bgHex) {
        const u = use(hex);
        u.count++;
        u.score += score;
        if (isStatus) u.statusCount++;
        else u.nonStatusCount++;
        if (score > 1 && source && !source.includes("__") && !u.sources.includes(source) && u.sources.length < 5) u.sources.push(source);
      }
    }
  }

  /* Body and html often paint nothing, leaving the default white canvas the viewer sees. */
  body.background = bodyBackground ?? htmlBackground ?? "#ffffff";

  return {
    census: { colors: [...colors.values()].sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex)), totalElements },
    fonts,
    body,
  };
}

/** Mark the declared tokens in a census so the palette keeps the author's exact hex. */
export function markTokens(census: Census, tokens: Record<string, string>): void {
  const hexes = new Set(Object.values(tokens).filter((v) => /^#[0-9a-f]{6}$/.test(v)));
  for (const use of census.colors) if (hexes.has(use.hex)) use.isToken = true;
  for (const hex of hexes) {
    if (!census.colors.some((u) => u.hex === hex)) {
      census.colors.push({ hex, count: 0, area: 0, chars: 0, bgCount: 0, score: 0, ctaCount: 0, isToken: true, statusCount: 0, nonStatusCount: 0, sources: [] });
    }
  }
}

/** The family with the most characters in a census bucket, or undefined. */
export function topFamily(bucket: Record<string, number>): string | undefined {
  let best: string | undefined;
  let max = 0;
  for (const [family, chars] of Object.entries(bucket)) {
    if (chars > max) {
      max = chars;
      best = family;
    }
  }
  return best;
}
