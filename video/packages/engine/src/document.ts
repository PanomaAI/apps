/*
  The page the rasterizer paints on. It is loaded once per worker page and then only
  its <body> is swapped per frame, so fonts parse once and stay warm. Every font is
  vendored into the engine and served from the local asset server: a render must not
  depend on the network, and a CDN glyph update must not change yesterday's pixels.

  All four are SIL OFL 1.1, recorded in assets/fonts/CREDITS.json and enforced by
  tests/licenses.test.ts. Two of them are here for their AXES, not their shapes:
  Fraunces carries opsz 9-144, wght 100-900, SOFT 0-100 and a binary WONK, and
  Anybody carries wdth 50-150. Animating an axis is a motion technique no static
  face can imitate — a word that thickens and widens as it lands is doing something
  a scale transform cannot fake.

  They are served as raw TTF on purpose. The Google Fonts CSS API answers a
  non-browser agent with per-weight STATIC slices, and Fontsource ships per-axis
  subsets whose default import silently drops every axis but weight — in both cases
  `font-variation-settings` then does nothing at all, with no error.
*/
import { lightThemeCss } from "@panoma/video-core/theme";

export function shellHtml(width: number, height: number): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  ${lightThemeCss()}
  @font-face {
    font-family: "Geist";
    src: url("/__fonts__/Geist-var-latin.woff2") format("woff2");
    font-weight: 100 900;
    font-style: normal;
    font-display: block;
  }
  @font-face {
    font-family: "Geist Mono";
    src: url("/__fonts__/GeistMono-var-latin.woff2") format("woff2");
    font-weight: 100 900;
    font-style: normal;
    font-display: block;
  }
  @font-face {
    font-family: "Fraunces";
    src: url("/__fonts__/Fraunces.ttf") format("truetype-variations");
    font-weight: 100 900;
    font-style: normal;
    font-display: block;
  }
  @font-face {
    font-family: "Anybody";
    src: url("/__fonts__/Anybody.ttf") format("truetype-variations");
    font-weight: 100 900;
    font-stretch: 50% 150%;
    font-style: normal;
    font-display: block;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    position: relative;
    background: var(--color-paper);
    color: var(--color-ink);
  }
</style>
</head>
<body></body>
</html>`;
}
