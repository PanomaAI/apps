/*
  The brand contract, exactly as the architecture fixes it (section 2). Kept in its own
  file so every other module in this package — and the recipes that take a theme from
  props — import one shape and never a private variant of it. A field added here is a
  field every consumer sees; a field added anywhere else is a fork.

  Two rules the shape encodes on purpose:

  - Every colour carries an `origin` and a `confidence`. The worst unattended failure is
    a video rendered in a colour nobody chose — a status red that happened to be the
    most saturated thing on the page — so a swatch says where it came from, and a
    "low" primary means the renderer keeps the engine's own theme (see `brandTheme`).
  - A `FontPick.family` is always one of the BUNDLED faces. The product's font is
    detected and recorded in `detected`, never downloaded: that keeps the licence
    question out of the render entirely.
*/

export type Swatch = {
  /** #rrggbb, lowercase, opaque. */
  hex: string;
  confidence: "high" | "medium" | "low";
  /** Where it was read: "css-token:--primary" · "theme-color" · "manifest" · "cta" · "census" · "logo" · "derived" · "default". */
  origin: string;
};

export type FontPick = {
  /** The product's own family name, when one was found. Recorded, never loaded. */
  detected?: string;
  category: "sans" | "serif" | "mono" | "display";
  /** A BUNDLED face: "Geist" · "Geist Mono" · "Fraunces" · "Anybody". */
  family: string;
  /** "google" · "self-hosted" · "system" · "css-token:--font-sans" · "rendered". */
  source?: string;
};

export type BrandLogo = {
  /** Absolute path of the saved bytes (svg/png/ico as served), or the URL / data URI when nothing was saved. */
  file: string;
  kind: "wordmark" | "logomark" | "combination" | "icon";
  width: number;
  height: number;
  /** True when the mark sits on a dark background — it is the light-on-dark variant. */
  reversed: boolean;
  origin: string;
  score: number;
};

export type BrandProfile = {
  source: { url?: string; repoPath?: string; extractedAt: string };
  name: string;
  /** Exact live metadata witness. Absent for a domain or package-name fallback. */
  nameEvidence?: { value: string; source: string };
  colors: {
    primary: Swatch;
    accent: Swatch;
    background: Swatch;
    surface: Swatch;
    text: Swatch;
    muted: Swatch;
    onPrimary: Swatch;
  };
  /** :root custom properties found, name → value (colours normalised to hex). */
  tokens: Record<string, string>;
  scheme: { supports: ("light" | "dark")[]; default: "light" | "dark" };
  logo?: BrandLogo;
  type: { heading: FontPick; body: FontPick; mono: FontPick };
  tone: {
    register: "playful" | "friendly" | "neutral" | "formal" | "technical";
    metrics: Record<string, number>;
  };
};

export type Scheme = BrandProfile["scheme"];
export type BrandColors = BrandProfile["colors"];
export type Register = BrandProfile["tone"]["register"];
