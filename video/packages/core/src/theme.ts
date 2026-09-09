/**
 * Panoma Video's only house theme: Panoma's light catalog palette.
 *
 * Reference: panoma/apps/web/app/styles/{theme,tokens}.css, read 2026-09-07.
 * Keep literal house colours here. Consumers use semantic roles, including the
 * CSS variables generated below; no runtime dependency on the Panoma checkout.
 * Product recordings and measured brand palettes remain source material.
 */
export const PANOMA_LIGHT = {
  paper: "#fcfcfd",
  surface: "#ffffff",
  wash: "#f6f6f7",
  selected: "#f0f0f2",
  inset: "#f4f4f5",
  ink: "#0e0f11",
  muted: "#5c6169",
  faint: "#90959d",
  line: "#ebecee",
  lineStrong: "#dbdde0",
  lineHover: "#c6c9ce",
  accent: "#0b0b0d",
  success: "#147a49",
  successSoft: "#edf9f3",
  warning: "#92600a",
  warningSoft: "#fffaf0",
  danger: "#c11919",
  dangerSoft: "#fff2f2",
} as const;

/** Inverse title cards are a composition role, not a selectable dark theme. */
export const LIGHT_PALETTE = {
  paper: PANOMA_LIGHT.paper,
  card: PANOMA_LIGHT.surface,
  ink: PANOMA_LIGHT.ink,
  muted: PANOMA_LIGHT.muted,
  faint: PANOMA_LIGHT.faint,
  line: PANOMA_LIGHT.line,
  accent: PANOMA_LIGHT.accent,
  onAccent: PANOMA_LIGHT.surface,
  good: PANOMA_LIGHT.success,
  inverted: {
    paper: PANOMA_LIGHT.ink,
    ink: PANOMA_LIGHT.paper,
    muted: PANOMA_LIGHT.lineStrong,
  },
} as const;

/** Shared by the rasterizer shell and the self-contained HTML reports. */
export function lightThemeCss(): string {
  const variables = Object.entries(PANOMA_LIGHT).map(([name, value]) =>
    `--color-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}: ${value};`);
  return `:root { color-scheme: light; ${variables.join(" ")} --color-on-accent: var(--color-surface); }`;
}

/** Absolute contrast endpoints and opaque video mattes are materials, not house themes. */
export const COLOR_EXTREMES = { black: "#000000", white: "#ffffff" } as const;

/** Drawn objects retain their material colours beside any measured product palette. */
export const SCENE_MATERIALS = {
  deviceBody: COLOR_EXTREMES.black,
  deviceBezel: "#2c2c2c",
  deviceSpeaker: "#1a1a1a",
  windowControls: ["#696969", "#a2a2a2", "#d8d8d8"],
  pointerFill: "#111111",
  pointerEdge: COLOR_EXTREMES.white,
  recordingMatte: COLOR_EXTREMES.white,
  generatedMatte: COLOR_EXTREMES.black,
  neutralFallback: "#c8c8c8",
} as const;

/** Explicit editorial treatments affect added graphics, never recorded product pixels. */
export const EDITORIAL_COLORS = {
  vibrantAccent: "#c6f566",
  blockAccent: "#f3cc55",
  blockSecondary: "#c9b7ed",
  grid: {
    dark: { paper: "#101010", ink: "#f5f5f5", muted: "#ababab" },
    light: { paper: "#f5f5f5", ink: "#151515", muted: "#626262" },
  },
} as const;
