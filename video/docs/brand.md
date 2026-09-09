# Brand

> A video in a colour nobody chose is the worst thing an unattended pipeline can ship.

Panoma Video's only house theme is Panoma's light catalog palette: near-white paper,
white surfaces, dark ink and a black accent. `packages/core/src/theme.ts` owns its
literal colours and semantic roles, adapted from Panoma's `styles/theme.css` and
`styles/tokens.css` as read on 2026-09-07. Renderer defaults, brand fallbacks and HTML
reports consume that module; reports and the rasterizer shell share its generated
CSS variables and explicitly declare `color-scheme: light`. There is no house dark
mode or system-preference switch. Status text uses Panoma's readable semantic ink
variants. Faint ink is reserved for decoration, not body copy.

The browser studio was removed during integration into Panoma; this colour change
does not recreate it. The terminal illustration now follows the frame's palette.
Inverse title cards, physical device materials and explicitly selected editorial
colours remain named composition roles; they are not application themes. Their
literal values are also centralized in the core theme module.
Saved, unbranded Vira directions adopt the light palette when opened, retaining
their motion, music and seed. This does not rewrite the historical direction file.

A product's measured identity still belongs to its film. `@panoma/video-brand` reads a
product's design system — from its repository and from its live page — and hands the
recipes a theme in the product's colours, type category and tone, with a confidence
attached to every value so the renderer can refuse to guess.

## Two passes, one merge

| Pass | Reads | Needs |
| --- | --- | --- |
| `brandFromRepo(root)` | `package.json` name · tokens in `globals/tokens/theme/app.css` and `tailwind.config.*` · `manifest.json` / `site.webmanifest` · logo files by name · the README (tone, and which image it shows) | a checkout |
| `brandFromPage(url)` | `theme-color` (both media variants) · `color-scheme` · the manifest · `mask-icon` and its colour · `apple-touch-icon` · `rel=icon` · `og:site_name` · an area-weighted colour census and a text-weighted font census from one CDP call · the fonts that actually rendered · the scheme, by rendering twice · the logo on the page | Chromium |
| `mergeBrand(repo, live)` | both, swatch by swatch | — |

The repository pass exists because the live one has two failure modes it does not:
the dev server may not start, and what it serves may be an older build than the code
about to be filmed. Source is what the video is about, so a `--primary` in
`globals.css` outranks a colour measured from pixels.

The precedence, fixed by the architecture and applied per swatch in `mergeBrand`:

```
css-token / manifest / theme-color  >  CTA background  >  area-weighted census  >  logo palette  >  default
```

A tie goes to the repository. Scheme and type come from the live pass when it ran
(they are measured there); the logo goes to the higher score; tone comes from the
README, since a landing page has no prose worth measuring.

The live name carries `nameEvidence`: its exact value and the metadata field that
supplied it (`og:site_name`, manifest name, application-name, or the title's name
before its separator). The automatic path promotes that witness to `brand.name`
for planning and keeps it in the external workspace for offline edits. A hostname,
package fallback or renamed screen cannot inherit that witness. A user brand patch
still wins and cites the patch. This prevents a starter package id from becoming a
product's closing title while keeping the name traceable.

When the director requests live exploration context, `brandFromPage` also reads
the accessibility tree of that already-open page's body. Its optional
`onPageContext` callback receives the URL and at most 6,000 characters, redacted
before truncation. It does not visit another page or click a control. The director
uses this observation and the sourced live identity to refine its existing thesis
before the tour; it is exploration context, never a new product fact or proof of
a completed action.

## What a swatch is

```ts
{ hex: "#2456e6", confidence: "high", origin: "theme-color" }
```

`origin` says where the colour was read — `css-token:--primary`, `manifest`,
`theme-color`, `cta`, `census`, `body`, `logo`, `derived`, `default` — and
`confidence` says how much the evidence supports it. The two together are what
`brandTheme` acts on: **a primary with `confidence: "low"` keeps panoma video's theme.**
Surfaces and inks come from the brand only when background *and* text are trusted;
the accent only when the primary is. `good` uses the house success ink when it is
readable on the current surface, and the film's readable ink otherwise; a status
colour is not a brand accent. An isolated measured text colour that cannot be read
on an unknown background uses the house pair for rendering, with the reason kept
in the direction and the original brand evidence unchanged.

`ProductPromo` can separately select one editorial theme for its added titles,
lists, source panels and framing accents. Flat retains this measured palette;
Vibrant uses the chromatic brand accent when available, or its explicitly authored
lime accent when the identity is neutral. Block adds rounded outlines and solid
offset planes, using the brand accent or an editorial yellow/lavender pair for a
neutral identity. Those colours belong to the editorial
theme, not to the extracted brand profile. It never enters `ThemeProvider` or the
recorded product's pixels, camera, cursor or playback clock. The theme is fixed in
the brief across every hook, language and format; [social.md](social.md) records
selection, manual overrides and persistence.

## The role selection

Ported from dembrandt (`lib/extractors/colors.ts`, MIT, Copyright (c) 2025
thevangelist), which worked these rules out over a labelled set of sites. The obvious
answers are wrong in known ways — the most-used colour is the page background, the
most saturated one is a status red — so:

- **primary**: a declared token (`--primary`, `--color-primary`, `--brand`, …) > a
  *chromatic* `theme-color` / manifest `theme_color` > a `mask-icon` colour > the
  opaque CTA background seen **at least twice** > the most chromatic recurring colour
  > the most saturated fill of the logo > Panoma Video's light-theme accent at `low`.
- **near-neutral override**: when the chosen primary is a grey, a declared colour or a
  CTA that *is* chromatic replaces it. dembrandt tests this in HSL, where Tailwind's
  gray-900 `#111827` reads as 39% saturated; here OKLab chroma settles it (below).
- **accent**: the most saturated colour more than 30° of hue away from the primary;
  `--accent` only when it is chromatic (in shadcn it is a hover grey). With nothing
  found, the accent is the primary.
- **background / surface / text / muted**: tokens first, then the rendered body, then
  the census: the largest near-neutral fill, the next fill on the same side of dark,
  the ink with the most characters at ≥ 4.5:1, the next ink between 3:1 and 7:1.
- **onPrimary**: `--primary-foreground`, else the better of white and black by WCAG 2.

A neutral `theme-color` is the page chrome, not the brand: it informs the background
and never the primary. The browser's own link colours (`#0000ee`, `#551a8b`) are never
candidates — an unstyled `<a>` paints them on every page.

## The census

One `DOMSnapshot.captureSnapshot` through `context.newCDPSession(page)` returns every
node's computed styles, layout bounds and text in a single round trip — the same
primitive Chromium's own CSS Overview panel uses. A background colour is weighted by
the pixels it paints and an ink by the characters set in it, so a page of five hundred
grey `<span>`s and one hero in the brand colour does not report grey. Each element
also carries dembrandt's context score (logo 5, brand 5, primary 4, cta 4, hero 3,
button 3, card 2 …, lifted through up to four ancestors, and an opaque CTA background
scores 25), which is what separates a brand colour used three times from a decoration
used three times.

Borders are not counted: a computed `border-top-color` exists on every element whether
or not a border is drawn, and counting it multiplies the text colour by the element
count.

## Fonts: detected, never downloaded

panoma video renders with four bundled OFL faces. The product's font is recorded in
`detected` and mapped by **category** to one of them:

| Detected | Bundled |
| --- | --- |
| sans | Geist |
| serif, display-serif | Fraunces |
| mono | Geist Mono |
| display-sans | Anybody |

The category comes from the family name first (a name with "Mono" in it is a mono,
"Playfair Display" is a display serif), the generic keyword at the end of the stack
second; a display face is a heading-only idea, so body copy in Bebas Neue maps to sans.
`CSS.getPlatformFontsForNode` on the `h1` and the longest paragraph gives the family
Chromium actually drew, which is how a stack that names Inter and rendered Arial still
lands on sans, and `source` says whether it came from Google Fonts, a `@font-face`, or
the system.

The OFL FAQ makes the bundled path clean — rendering an OFL face into frames is design
use, not distribution (Q1.1, Q1.12) — and never fetching a webfont removes the licence
question for everything else.

## Tone

Five numbers from the README's first 400 words after the title, and one label:

| Register | Rule (research recommendation 7) |
| --- | --- |
| playful | emoji per word > 0.02, or sentences ending in "!" > 15% |
| technical | Flesch reading ease < 45 **and** code fences > 25% of the README |
| formal | passive sentences > 20% and second-person sentences < 10% |
| friendly | second-person sentences > 30% |
| neutral | everything else |

Checked in that order, so a playful README that is also technical is playful. The
passive test is a heuristic (a be-verb followed by a participle), the emoji regex is
the pictographic blocks, and the syllable count is vowel groups — none of it is a
parser, all of it is deterministic, and the four fixture READMEs pin it.

## The numbers

| Constant | Value | Source |
| --- | --- | --- |
| Contrast ratio | (L1 + 0.05) / (L2 + 0.05); 4.5:1 text, 3:1 large | WCAG 2.1, SC 1.4.3 and the relative-luminance definition. APCA is non-free (apca-w3's "Limited W3 License") and is not used. |
| Large text | ≥ 24px, or ≥ 18.66px bold | 18pt / 14pt bold at CSS's 1pt = 1.333px |
| Dark surface | luminance ≤ 0.179 | where white and black contrast equally against it |
| Logo scores | header +50, own name +40, "logo" class +30, SVG aria-label home +40, home link +30, top-left +10/+10, below fold −50, > 800×500 −80, alt > 50 chars −40 | dembrandt `lib/extractors/logo.ts` |
| Logo floor | longer edge ≥ 24px | dembrandt: no confirmed logo in the labelled set is smaller; UI glyphs are 16–20px |
| Confidence cap | high needs 3 sightings, medium needs 2 | dembrandt `capConfidenceByUsage` |
| Palette threshold | max(3, 1% of elements); ΔE < 15 merges shades | dembrandt `colors.ts` |
| Near-neutral | HSL saturation < 0.12 or OKLab chroma < 0.05 | Tailwind slate/gray 900s sit at 0.032–0.040 |
| Accent hue distance | > 30° from the primary | dembrandt |
| Tone sample | 400 words after the title | brand research, recommendation 7 |
| Viewport | 1280×800 | a laptop, wide enough that desktop headers lay out as designed |

## Making one

```ts
import { extractBrand, brandTheme } from "@panoma/video-brand";

const profile = await extractBrand({ root: "/path/to/repo", url: "http://127.0.0.1:4173/", outDir: "/path/to/out" });
const theme = brandTheme(profile);   // the shape of apps/render/src/lib/theme.ts
```

The logo's bytes are written to `outDir/logo.svg|png|ico` as served; nothing is written
inside the project. `profile.logo.reversed` says whether the mark was found on a dark
background, so a scene can pick the right variant.

## Known limits

- **A single page, above and below the fold, at one viewport.** The census reads the
  page as loaded; a brand colour that appears only after a click or on a second route
  is not seen. The director will run the pass on the page the tour starts from.
- **`lab()` / `lch()` tokens are not parsed**, and an out-of-gamut `oklch()` is
  clamped per channel rather than gamut-mapped. Neither occurs in shadcn or Tailwind
  output; a token in those notations stays as written and is not a colour role.
- **CSS `background-image` logos are not candidates.** dembrandt reads them; here only
  `<img>`, inline `<svg>` and the head icons are, so a header logo painted as a
  background image falls through to the manifest icon.
- **Dark tokens are read but not reported.** `tokens` carries the `:root` set; the dark
  block only informs `scheme.supports`. A dark-first product still gets its dark
  background from the live pass, which measures what the body paints.
- **The tone thresholds are the research's, not a model's.** A technical README with
  short sentences (Flesch ≥ 45) reads as neutral; a friendly one with many code fences
  but few "you"s does too. The metrics are recorded so a caller can disagree with the
  label.
- **Determinism is per page load.** The same page yields a byte-identical profile
  twice (the test proves it), but a page that randomises its hero or loads a font on the
  second visit only will differ between visits, and `extractedAt` always does.
