/*
  From the product's font to one of the four faces panoma video ships. The engine renders only
  its bundled OFL fonts (Geist, Geist Mono, Fraunces, Anybody — packages/engine/assets/
  fonts/CREDITS.json); a product's own webfont is detected and recorded, never fetched.
  Downloading would reopen the licence question for every render (Typekit and Monotype
  faces are licensed to a website, not to a video), and the OFL FAQ makes the bundled
  path clean: rendering an OFL face into frames is design use, not distribution
  (https://openfontlicense.org/ofl-faq/, Q1.1 and Q1.12).

  So the only decision here is the CATEGORY of what was found — sans, serif, mono,
  display — and the category picks the face. The family name is the strongest signal
  (a name carrying "Mono" is a mono), the generic keyword at the end of a stack is the
  fallback, and a display face is a heading-only idea: body text never maps to Anybody.
*/
import type { FontPick } from "./types.ts";

export type FontCategory = FontPick["category"];
export type FontRole = "heading" | "body" | "mono";

/** The bundled faces, by the CSS family names the engine's page shell declares. */
export const BUNDLED = {
  sans: "Geist",
  serif: "Fraunces",
  mono: "Geist Mono",
  display: "Anybody",
} as const;

/** The full stacks recipes use, so a theme can hand them straight to CSS. */
export const STACKS: Record<string, string> = {
  Geist: `"Geist", ui-sans-serif, system-ui, sans-serif`,
  "Geist Mono": `"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace`,
  Fraunces: `"Fraunces", Georgia, "Times New Roman", serif`,
  Anybody: `"Anybody", "Geist", ui-sans-serif, system-ui, sans-serif`,
};

const MONO_NAMES =
  /\b(mono|monospace|code|courier|consolas|menlo|monaco|sf mono|fira code|jetbrains|source code|inconsolata|ibm plex mono|roboto mono|ubuntu mono|hack|iosevka|cascadia|berkeley|commit|dank)\b/i;
const SERIF_NAMES =
  /\b(serif|georgia|times|garamond|playfair|merriweather|lora|fraunces|baskerville|cambria|didot|bodoni|crimson|caslon|newsreader|spectral|literata|charter|tiempos|freight|domine|cormorant|noto serif|source serif|dm serif|instrument serif|libre|vollkorn|bitter|zilla|alegreya|cardo|eczar|pt serif|roboto serif|ibm plex serif|palatino|book antiqua|minion|sabon|chronicle|mercury|century)\b/i;
const DISPLAY_NAMES =
  /\b(display|anybody|bebas|oswald|anton|righteous|lobster|pacifico|abril|fredoka|bungee|monoton|syne|unbounded|clash|cabinet|archivo black|black ops|impact|league gothic|big shoulders|bricolage|instrument sans|space grotesk|dela gothic|rubik mono|climate crisis|monument|druk|knockout|obviously|roc grotesk|tusker|bayard|humane|migra)\b/i;

/** The first family of a CSS stack, unquoted and trimmed. */
export function firstFamily(stack: string | undefined | null): string {
  if (!stack) return "";
  return stack.split(",")[0].replace(/['"]/g, "").trim();
}

/** The generic keyword that closes a stack, if any. */
function genericOf(stack: string): "sans" | "serif" | "mono" | null {
  const last = stack.split(",").map((f) => f.replace(/['"]/g, "").trim().toLowerCase());
  for (const f of last.reverse()) {
    if (f === "monospace" || f === "ui-monospace") return "mono";
    if (f === "serif" || f === "ui-serif") return "serif";
    if (f === "sans-serif" || f === "ui-sans-serif" || f === "system-ui") return "sans";
  }
  return null;
}

/**
 * The category of a family or stack. `role` matters once: a display name in body copy
 * is still body copy, so it falls to sans or serif by its other traits.
 */
export function fontCategory(stack: string | undefined | null, role: FontRole = "body"): FontCategory {
  const s = (stack ?? "").trim();
  const first = firstFamily(s);
  if (!s) return role === "mono" ? "mono" : "sans";
  /* "Sans" in a name beats a serif word in it: "Source Sans", "Noto Sans Display". */
  const saysSans = /\bsans\b/i.test(first);
  if (MONO_NAMES.test(first)) return "mono";
  if (role === "heading" && DISPLAY_NAMES.test(first)) return "display";
  if (!saysSans && SERIF_NAMES.test(first)) return "serif";
  if (saysSans) return "sans";
  const generic = genericOf(s);
  if (generic === "mono") return "mono";
  if (generic === "serif") return "serif";
  if (role === "mono") return "mono";
  return "sans";
}

/** Whether a display family reads as a serif (→ Fraunces) or a sans (→ Anybody). */
function displayIsSerif(first: string): boolean {
  return !/\bsans\b/i.test(first) && (SERIF_NAMES.test(first) || /\b(abril|didot|bodoni|migra|chronicle|mercury)\b/i.test(first));
}

/** Map a detected stack to a bundled face. */
export function pickFont(stack: string | undefined | null, role: FontRole, source?: string): FontPick {
  const first = firstFamily(stack);
  const category = fontCategory(stack, role);
  let family: string;
  if (category === "mono") family = BUNDLED.mono;
  else if (category === "serif") family = BUNDLED.serif;
  else if (category === "display") family = displayIsSerif(first) ? BUNDLED.serif : BUNDLED.display;
  else family = BUNDLED.sans;
  const pick: FontPick = { category, family };
  if (first && !/^(sans-serif|serif|monospace|system-ui|ui-sans-serif|ui-serif|ui-monospace|-apple-system|blinkmacsystemfont)$/i.test(first)) {
    pick.detected = first;
  }
  if (source) pick.source = source;
  return pick;
}

/** The three defaults the engine renders with when nothing was detected. */
export function defaultType(): { heading: FontPick; body: FontPick; mono: FontPick } {
  return {
    heading: { category: "sans", family: BUNDLED.sans },
    body: { category: "sans", family: BUNDLED.sans },
    mono: { category: "mono", family: BUNDLED.mono },
  };
}

/** Families named by a Google Fonts CSS URL: `family=Fraunces:opsz,wght@9..144,300..900&family=Inter`. */
export function googleFamilies(href: string): string[] {
  const out: string[] = [];
  for (const m of href.matchAll(/family=([^&:]+)/g)) {
    let name = m[1];
    try {
      name = decodeURIComponent(name);
    } catch {
      /* keep the raw token */
    }
    name = name.replace(/\+/g, " ").trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** The CSS stack for a bundled face; unknown names fall back to Geist's stack. */
export function stackFor(family: string): string {
  return STACKS[family] ?? STACKS.Geist;
}
