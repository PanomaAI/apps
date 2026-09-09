/*
  Family names only. The engine's page shell declares the @font-face rules from the
  vendored Geist files (SIL OFL 1.1) and the rasterizer waits for them before the
  first frame — a scene never loads a font, it just names one.
*/
export const display = `"Geist", ui-sans-serif, system-ui, sans-serif`;
export const mono = `"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;

/*
  The two voices that exist to be animated rather than set. Reach for these when a
  word should *do* something: `editorial` has an optical-size axis wide enough to
  restyle a headline mid-shot and a binary WONK that lands like a cut, `wide` has a
  width axis that stretches half to one-and-a-half.
*/
export const editorial = `"Fraunces", Georgia, "Times New Roman", serif`;
export const wide = `"Anybody", "Geist", ui-sans-serif, system-ui, sans-serif`;

/** `font-variation-settings`, written from a plain object. */
export function axes(settings: Record<string, number>): string {
  return Object.entries(settings)
    .map(([tag, value]) => `"${tag}" ${Number(value.toFixed(3))}`)
    .join(", ");
}
