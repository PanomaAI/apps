/*
  Design tokens out of stylesheet text, with no browser. A project that declares
  `--primary` in globals.css has told you its brand in source, and it has already
  separated light from dark: shadcn writes `:root { … } .dark { … }`, Tailwind v4 writes
  `@theme { --color-* }`, others gate on `[data-theme="dark"]` or a
  `prefers-color-scheme` media block. Reading that is faster and more faithful than a
  computed-style census, and it works for a project whose dev server is not up.

  What makes it non-trivial is the same thing in every framework: values reference
  each other. shadcn v3 stores `--primary: 222.2 47.4% 11.2%` and uses
  `hsl(var(--primary))`; v4 stores `--primary: var(--color-brand)`. So a block's
  declarations are resolved against their own block first and the light block second
  (a dark theme overrides a few tokens and inherits the rest), then normalised to hex.
  The scanner is a brace walker rather than a CSS parser: it only needs to know which
  selector chain a `--name: value` sits under.
*/
import { normalizeHex } from "./color.ts";

export type TokenSets = {
  /** Resolved, colours as #rrggbb, other values verbatim. */
  light: Record<string, string>;
  dark: Record<string, string>;
  /** `color-scheme: dark` declared on :root/html — a dark-first product. */
  rootColorScheme?: string;
};

type Block = { chain: string[]; body: string };

/** Strip comments, keeping string literals intact enough for our purposes. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Walk braces and yield every innermost block with its selector chain. */
export function blocksOf(css: string): Block[] {
  const src = stripComments(css);
  const out: Block[] = [];
  const chain: string[] = [];
  let i = 0;
  let start = 0;
  const bodies: number[] = [];
  while (i < src.length) {
    const ch = src[i];
    if (ch === "{") {
      const selector = src.slice(start, i).trim().split(/;|}/).pop()?.trim() ?? "";
      chain.push(selector);
      bodies.push(i + 1);
      start = i + 1;
    } else if (ch === "}") {
      const bodyStart = bodies.pop() ?? i;
      const body = src.slice(bodyStart, i);
      if (body.includes("--")) out.push({ chain: [...chain], body });
      chain.pop();
      start = i + 1;
    }
    i++;
  }
  return out;
}

const DARK_SELECTOR = /(\.dark\b|\[data-theme\s*=\s*["']?dark|\[data-mode\s*=\s*["']?dark|\[data-color-mode\s*=\s*["']?dark|prefers-color-scheme\s*:\s*dark|\.theme-dark\b|\[class\s*~?=\s*["']?dark)/i;
const LIGHT_ROOT = /^(:root|html|body|:host|@theme(\s+inline)?|:root:not\(\.dark\)|html:not\(\.dark\)|\.light\b|\[data-theme\s*=\s*["']?light)/i;

function classify(chain: string[]): "light" | "dark" | null {
  const joined = chain.join(" ");
  if (DARK_SELECTOR.test(joined)) return "dark";
  const last = chain[chain.length - 1] ?? "";
  if (LIGHT_ROOT.test(last) || /prefers-color-scheme\s*:\s*light/i.test(joined)) return "light";
  /* A `@layer base { :root {…} }` chain: the :root sits last, handled above. A bare
     `@media (max-width)` wrapper around :root is still light. */
  if (chain.some((s) => LIGHT_ROOT.test(s)) && !chain.some((s) => /^\./.test(s))) return "light";
  return null;
}

/** Declarations `--name: value` of a block body, last write wins. */
function declarationsOf(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

/** Substitute var() references from `scope`, then `fallback`, up to five hops. */
export function resolveVars(value: string, scope: Record<string, string>, fallback: Record<string, string> = {}): string {
  let v = value;
  for (let hop = 0; hop < 5 && v.includes("var("); hop++) {
    v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_m, name: string, def?: string) => {
      return scope[name] ?? fallback[name] ?? def?.trim() ?? "";
    });
  }
  return v.trim();
}

const COLOR_LIKE = /^(#|rgb|hsl|oklch|oklab|color\(|[\d.]+\s+[\d.]+%\s+[\d.]+%$)|^(white|black|transparent|[a-z]+)$/i;

/** Normalise a resolved token value: a colour becomes hex; anything else stays as written. */
function normalizeToken(name: string, value: string): string {
  const v = value.trim();
  if (!v) return v;
  const looksColor = /(color|bg|background|foreground|border|ring|accent|primary|secondary|muted|brand|surface|text|ink|paper|card|popover|destructive|chart|sidebar)/i.test(name) || COLOR_LIKE.test(v);
  if (!looksColor) return v;
  /* `hsl(var(--x))` after substitution becomes `hsl(222.2 47.4% 11.2%)`; a leftover
     `hsl(222.2 47.4% 11.2% / 0.5)` still parses. */
  const hex = normalizeHex(v);
  return hex ?? v;
}

/** Tokens of one stylesheet, split into light and dark sets and resolved. */
export function tokensFromCss(css: string): TokenSets {
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  let rootColorScheme: string | undefined;
  for (const block of blocksOf(css)) {
    const kind = classify(block.chain);
    if (!kind) continue;
    const decls = declarationsOf(block.body);
    Object.assign(kind === "light" ? light : dark, decls);
    if (kind === "light") {
      const scheme = block.body.match(/(?:^|;|\s)color-scheme\s*:\s*([^;]+)/);
      if (scheme) rootColorScheme = scheme[1].trim();
    }
  }
  const resolved = (set: Record<string, string>, fallback: Record<string, string>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(set)) {
      out[name] = normalizeToken(name, resolveVars(value, set, fallback));
    }
    return out;
  };
  const lightResolved = resolved(light, {});
  /* `.dark` overrides a few tokens and inherits the rest, and an `@theme` alias such as
     `--color-background: var(--background)` re-resolves under it — so the dark set is
     the light declarations with the dark ones on top, resolved as one cascade. */
  const darkResolved = Object.keys(dark).length ? resolved({ ...light, ...dark }, {}) : {};
  const sets: TokenSets = { light: lightResolved, dark: darkResolved };
  if (rootColorScheme) sets.rootColorScheme = rootColorScheme;
  return sets;
}

/**
 * Tokens of a tailwind.config.{js,ts,cjs,mjs}, read as text: `colors: { primary: '#…' }`
 * and nested `primary: { DEFAULT: '#…', 500: '#…' }` become `--color-<key>`, so the
 * same role lookup applies as for Tailwind v4's `@theme`. `fontFamily: { sans: [...] }`
 * becomes `--font-<key>`. A config that computes its palette in code yields nothing,
 * which is correct: nothing was declared in a form a reader can trust.
 */
export function tokensFromTailwindConfig(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  const src = stripComments(source);
  const colorsAt = src.search(/\bcolors\s*:\s*\{/);
  if (colorsAt >= 0) {
    const body = balanced(src, src.indexOf("{", colorsAt));
    for (const m of body.matchAll(/([\w-]+|"[\w-]+"|'[\w-]+')\s*:\s*(\{[^}]*\}|["'][^"']+["'])/g)) {
      const key = m[1].replace(/["']/g, "");
      const value = m[2];
      if (value.startsWith("{")) {
        const pick = value.match(/\b(?:DEFAULT|500)\s*:\s*["']([^"']+)["']/);
        if (pick) setColor(out, key, pick[1]);
        continue;
      }
      setColor(out, key, value.replace(/["']/g, ""));
    }
  }
  const fontsAt = src.search(/\bfontFamily\s*:\s*\{/);
  if (fontsAt >= 0) {
    const body = balanced(src, src.indexOf("{", fontsAt));
    for (const m of body.matchAll(/([\w-]+)\s*:\s*\[([^\]]*)\]/g)) {
      const families = m[2].split(",").map((f) => f.replace(/["'\s]+/g, " ").trim()).filter(Boolean);
      if (families.length) out[`--font-${m[1]}`] = families.join(", ");
    }
  }
  return out;
}

function setColor(out: Record<string, string>, key: string, raw: string): void {
  const hex = normalizeHex(raw);
  if (hex) out[`--color-${key.toLowerCase()}`] = hex;
}

/** The text between the brace at `open` and its match. */
function balanced(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

/*
  Role lookups over a token set. Names cover shadcn (v3 and v4), Tailwind v4 `@theme`,
  and the plain `--brand`/`--primary-color` idiom; the first name found wins. `--accent`
  is deliberately checked for chroma by the caller: in shadcn it is a hover grey, not a
  brand accent.
*/
export const ROLE_TOKEN_NAMES: Record<string, string[]> = {
  primary: ["--primary", "--color-primary", "--brand", "--color-brand", "--primary-color", "--brand-color", "--color-brand-500", "--primary-500", "--color-primary-500"],
  accent: ["--accent", "--color-accent", "--accent-color", "--color-accent-500"],
  background: ["--background", "--color-background", "--bg", "--color-bg", "--paper", "--color-paper", "--background-color"],
  surface: ["--card", "--color-card", "--surface", "--color-surface", "--popover", "--color-popover", "--secondary", "--color-secondary"],
  text: ["--foreground", "--color-foreground", "--text", "--color-text", "--ink", "--color-ink", "--text-color", "--fg", "--color-fg"],
  muted: ["--muted-foreground", "--color-muted-foreground", "--text-muted", "--color-text-muted", "--muted", "--color-muted"],
  onPrimary: ["--primary-foreground", "--color-primary-foreground", "--on-primary", "--color-on-primary"],
  fontSans: ["--font-sans", "--font-body", "--font-family", "--font-family-sans", "--font-inter", "--font-geist-sans"],
  fontHeading: ["--font-heading", "--font-display", "--font-serif", "--font-title", "--font-family-heading"],
  fontMono: ["--font-mono", "--font-code", "--font-family-mono", "--font-geist-mono"],
};

/** The first declared token of a role, as `{ name, value }`, or null. */
export function roleToken(tokens: Record<string, string>, role: keyof typeof ROLE_TOKEN_NAMES): { name: string; value: string } | null {
  for (const name of ROLE_TOKEN_NAMES[role]) {
    const value = tokens[name];
    if (value) return { name, value };
  }
  return null;
}

/** Only the colour-valued tokens of a set: what `BrandProfile.tokens` records. */
export function colorTokens(tokens: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens)) {
    if (/^#[0-9a-f]{6}$/.test(value)) out[name] = value;
  }
  return out;
}
