/*
  The studio: everything a film could be made of, assembled before anything is planned.

  "The app should first create every asset and element it will use" is the owner's ask,
  and the reason it is a stage rather than a report is that panoma video has been
  planning films against material it never looked at. Measured on this disk on
  2026-09-03: of five workspaces, three carry zero frames, zero component crops and zero
  macro clips in both takes — they were filmed before the element capture existed — and
  nothing said so. Every piece that needs a control at macro scale was silently
  unavailable there, and the plan went on offering one.
  Two rules make this stage cheap and safe:

  - **It reads disk and writes disk.** No browser, no dev server, no model. The fix pass
    re-enters with `camera: false` and no URL, and this stage runs there unchanged; a run
    with `--brain=none` produces the same study, byte for byte.
  - **It indexes what exists and derives only what does not.** The frames, crops and macro
    clips stay where the recorder put them — the engine already serves them and universend
    alone carries 43 MB of them — and what is written here is the index, the material
    matrix, the map, the palette card, the gaps and one page a person opens.
*/
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { Direction } from "@panoma/video-brand/direction";
import type { BrandProfile } from "@panoma/video-brand";
import type { SessionLog } from "@panoma/video-capture";
import type { FactSheet } from "@panoma/video-core";
import { lightThemeCss } from "@panoma/video-core/theme";
import type { TourScript } from "@panoma/video-tour";
import { inside } from "./workspace.ts";
import { mapSvg } from "./map.ts";
import type { Workspace } from "./workspace.ts";

export const STUDY_VERSION = 1;

/** A shot a piece can ask for, and the material it needs to exist. */
export type ShotKind = "page" | "press" | "unfold" | "reveal" | "logo" | "map";

/**
 * Who closes a gap. Deliberately NOT `ReviewFix["by"]`: that union has no member meaning
 * "a person must act", its `none` is documented as "there is nothing to do" and asserted
 * as the pass marker (packages/core/src/review-types.ts:22, tests/review.test.ts:126),
 * and widening it would touch every consumer and the published skill table.
 */
export type GapBy = "person" | "record" | "tour" | "brand" | "engine";

export type Gap = {
  id: string;
  summary: string;
  hint: string;
  by: GapBy;
  /** The command or tool that closes it, when one does. */
  tool?: string;
};

export type MarkMaterial = {
  mark: string;
  label?: string;
  /** Takes that captured a frame at this mark. */
  takes: string[];
  frame: boolean;
  element: boolean;
  macro: boolean;
  /** The control re-rendered in its own box after the click. */
  afterControl: boolean;
  /** A local clip of what opened. */
  after: boolean;
  /** Share of the viewport the click changed, as the capture measured it. */
  changeShare?: number;
  outcome?: { heading?: string; route?: string };
  shots: ShotKind[];
  /** Per shot this mark cannot support, the material that is missing. */
  missing: Record<string, string>;
};

export type StudyIndex = {
  version: number;
  product: { id: string; name: string; kind: string };
  direction: { name: string; scheme: string; signal: string; stage: string; accent: string; branded: Direction["branded"] };
  takes: { name: string; take: string; frames: number; elements: number; macros: number; durationMs: number }[];
  screens: { take: string; mark: string; file: string; url: string }[];
  components: { take: string; mark: string; file: string; name?: string; kind?: string }[];
  macro: { take: string; mark: string; file: string; pixelRatio: number; at?: "mark" | "press"; afterControl?: string; after?: string }[];
  /** Mark to mark, the footage a piece would cut, past the recorder's blank head. */
  clips: { take: string; mark: string; fromMs: number; toMs: number }[];
  identity: { logo?: string; logoKind?: string; logoWidth?: number; logoHeight?: number; wordmark?: string; palette: string };
  map?: { file: string; screens: number; filmed: number; unfilmed: number };
  facts: number;
  material: MarkMaterial[];
  gaps: Gap[];
};

/** The recorder writes 2.6 s of blank page before it navigates; a clip starts after that. */
function clipsOf(log: SessionLog): { take: string; mark: string; fromMs: number; toMs: number }[] {
  const marks = [...log.marks].sort((a, b) => a.t - b.t);
  return marks.map((m, i) => ({
    take: log.take,
    mark: m.name,
    /*
      `?? 0` on a field the type declares required, and it stays. `SessionLog` describes what
      the recorder writes; this object was parsed out of a file on disk by `readJson`, which
      checks nothing, so "required" here is a claim about the writer and not about the bytes.
      Forty of forty session logs under the engine's home carry `readyMs` — it has been
      written since 1-Sep-2026, before the oldest take on this machine — so this is insurance
      against a truncated file, not against a shape the code produces.
    */
    fromMs: Math.max(m.t, log.readyMs ?? 0),
    toMs: Math.min(marks[i + 1]?.t ?? log.durationMs, log.durationMs),
  }));
}

/**
 * What each mark's material can honestly support. The rules are the recipes' own
 * requirements, restated as a question about files: a shot whose material is missing is
 * never planned, and the reason is written down beside it.
 */
export function materialOf(takes: SessionLog[], tour?: TourScript | null): MarkMaterial[] {
  const names = [...new Set(takes.flatMap((t) => t.marks.map((m) => m.name)))];
  return names.map((mark) => {
    const has = (pick: (log: SessionLog) => unknown[] | undefined) =>
      takes.filter((t) => (pick(t) ?? []).some((x) => (x as { mark?: string }).mark === mark));
    const framesIn = has((t) => t.frames);
    const macrosIn = has((t) => t.macros);
    const macro = macrosIn.flatMap((t) => (t.macros ?? []).filter((m) => m.mark === mark));
    const afterControl = macro.some((m) => m.afterControl !== undefined);
    const after = macro.some((m) => m.after !== undefined);
    const change = macro.map((m) => m.change?.share).find((s) => s !== undefined);
    const tourMark = tour?.marks.find((m) => m.name === mark);

    const shots: ShotKind[] = [];
    const missing: Record<string, string> = {};
    if (framesIn.length > 0) shots.push("page");
    else missing.page = "no 2x viewport was captured at this mark";
    if (macro.length > 0 && afterControl) shots.push("press");
    else missing.press = macro.length === 0 ? "no macro clip of the control" : "the control's after-state was not captured";
    if (after) shots.push("unfold");
    else missing.unfold = "nothing local opened that the capture could clip";
    /*
      A reveal shows the page before and the page after, so it needs BOTH the interface's
      answer and a frame to show it in. The tour's outcome alone is a sentence, not a shot:
      a take with no frames offered "reveal" on every mark until this said so.
    */
    const answered = Boolean(tourMark?.outcome?.heading || tourMark?.outcome?.route);
    if (answered && framesIn.length > 0) shots.push("reveal");
    else missing.reveal = answered ? "no 2x viewport to show the answer in" : "the click produced no heading and no route the tour could see";

    return {
      mark,
      ...(tourMark ? { label: tourMark.label } : {}),
      takes: framesIn.map((t) => t.take),
      frame: framesIn.length > 0,
      element: has((t) => t.elements).length > 0,
      macro: macro.length > 0,
      afterControl,
      after,
      ...(change !== undefined ? { changeShare: Math.round(change * 1000) / 1000 } : {}),
      ...(tourMark?.outcome ? { outcome: tourMark.outcome } : {}),
      shots,
      missing,
    };
  });
}

/** The swatch card: every surface with its origin and the contrast it was measured at. */
export function paletteSvg(d: Direction, name: string): string {
  const rows: [string, string, string][] = [
    ["stage", d.stage.hex, d.stage.why],
    ["plate", d.plate.hex, d.plate.why],
    ["ink", d.ink.hex, d.ink.why],
    ["muted", d.muted.hex, d.muted.why],
    ["accent", d.accent.hex, d.accent.why],
    ["onAccent", d.onAccent.hex, d.onAccent.why],
  ];
  /* The quote matters: a bundled font stack is `"Geist", system-ui, sans-serif`, and an
     unescaped quote inside an attribute ends it — the whole document then fails to parse
     and a browser shows "attributes construct error" instead of the card. */
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const W = 900;
  const H = 120 + rows.length * 64 + 70;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name)} palette">`];
  out.push(`<rect width="${W}" height="${H}" fill="${d.stage.hex}"/>`);
  out.push(`<text x="40" y="60" font-family="${esc(d.fonts.display)}" font-size="30" fill="${d.ink.hex}">${esc(name)}</text>`);
  out.push(`<text x="40" y="88" font-family="${esc(d.fonts.mono)}" font-size="14" fill="${d.muted.hex}">${esc(`${d.name} · ${d.scheme} · ${d.signal} · ${Number.isInteger(d.sound.bpm) ? d.sound.bpm : d.sound.bpm.toFixed(2)} BPM ${d.sound.key} ${d.sound.style}`)}</text>`);
  rows.forEach(([role, hex, why], i) => {
    const y = 120 + i * 64;
    out.push(`<rect x="40" y="${y}" width="72" height="48" rx="8" fill="${hex}" stroke="${d.line.hex}"/>`);
    out.push(`<text x="128" y="${y + 22}" font-family="${esc(d.fonts.mono)}" font-size="16" fill="${d.ink.hex}">${esc(`${role}  ${hex}`)}</text>`);
    out.push(`<text x="128" y="${y + 42}" font-family="${esc(d.fonts.body)}" font-size="13" fill="${d.muted.hex}">${esc(why.slice(0, 96))}</text>`);
  });
  const ratios = d.contrast.map((c) => `${c.pair} ${c.ratio.toFixed(2)}`).join("   ");
  out.push(`<text x="40" y="${H - 30}" font-family="${esc(d.fonts.mono)}" font-size="13" fill="${d.muted.hex}">${esc(ratios)}</text>`);
  out.push("</svg>");
  return out.join("\n");
}

/** The name set in the direction's own display face, on its own ground. */
export function wordmarkSvg(name: string, d: Direction): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const width = Math.max(320, name.length * 34 + 120);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 200" role="img" aria-label="${esc(name)}">`,
    `<rect width="${width}" height="200" fill="${d.stage.hex}"/>`,
    `<text x="${width / 2}" y="118" text-anchor="middle" font-family="${esc(d.fonts.display)}" font-size="58" font-weight="800" fill="${d.ink.hex}">${esc(name)}</text>`,
    "</svg>",
  ].join("\n");
}

function gapsOf(input: { takes: SessionLog[]; material: MarkMaterial[]; brand: BrandProfile; direction: Direction; tour?: TourScript | null; facts: number }): Gap[] {
  const gaps: Gap[] = [];
  const empty = input.takes.filter((t) => (t.frames?.length ?? 0) === 0);
  if (input.takes.length === 0) {
    gaps.push({ id: "study.takes.none", summary: "Nothing has been filmed for this product.", hint: "Run the tour and the camera before planning a piece.", by: "record", tool: "panoma_video_record" });
  } else if (empty.length > 0) {
    gaps.push({
      id: "study.takes.empty",
      summary: `${empty.length === 1 ? "A take carries" : `${empty.length} takes carry`} no frames, no component crops and no macro clips.`,
      hint: "These takes predate the element capture. Re-record: every piece that isolates a control is unavailable until you do.",
      by: "record",
      tool: "panoma_video_record",
    });
  }
  if (!input.direction.branded.stage) {
    gaps.push({ id: "study.brand.stage", summary: "No background colour could be measured, so the film keeps panoma video's own paper.", hint: "Set `background` in brand.patch.json, or check that the live pass reached the product.", by: "brand" });
  }
  if (input.direction.signal === "mono" && input.brand.colors.primary.confidence === "low") {
    gaps.push({ id: "study.brand.accent", summary: "No brand colour could be trusted, so the film is monochrome.", hint: "Set `primary` in brand.patch.json if the product has one.", by: "brand" });
  }
  const logo = input.brand.logo;
  if (!logo) gaps.push({ id: "study.identity.logo", summary: "No logo was found for this product.", hint: "Point `logo` at a file in brand.patch.json, or add one to the page's head.", by: "person" });
  else if (Math.max(logo.width, logo.height) < 120) {
    gaps.push({ id: "study.identity.logo.size", summary: `The only mark found is ${logo.width}x${logo.height}, which is an icon.`, hint: "A logo shot needs a mark whose longer edge clears 120px; supply one in brand.patch.json.", by: "person" });
  }
  if (input.material.length > 0 && !input.material.some((m) => m.shots.includes("press"))) {
    gaps.push({ id: "study.material.press", summary: "No mark can be shown as a press: no control was captured with its after-state.", hint: "The tour found nothing whose use changes the interface, or the takes predate the macro capture.", by: "tour", tool: "panoma_video_tour" });
  }
  if ((input.tour?.pages?.length ?? 0) < 2) {
    gaps.push({ id: "study.map.thin", summary: "The walk reached one screen, so the map has nothing to draw.", hint: "A map needs at least two states; the product may be a single page, which is an answer and not a fault.", by: "tour", tool: "panoma_video_tour" });
  }
  if (input.facts === 0) gaps.push({ id: "study.facts.none", summary: "No fact carries a source, so no sentence may state a number.", hint: "A README, a package.json or a tag is what a film quotes from.", by: "engine" });
  return gaps;
}

function bookHtml(index: StudyIndex, d: Direction): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const tile = (src: string, caption: string) =>
    `<figure><img src="${esc(src)}" loading="lazy"><figcaption>${esc(caption)}</figcaption></figure>`;
  const rows = index.material
    .map(
      (m) =>
        `<tr><td>${esc(m.mark)}</td><td>${esc(m.label ?? "")}</td><td>${m.takes.join(", ")}</td><td>${m.shots.join(" · ") || "—"}</td><td class="why">${esc(Object.values(m.missing).join("; "))}</td></tr>`,
    )
    .join("\n");
  const gaps = index.gaps.map((g) => `<li><b>${esc(g.summary)}</b><br><span class="who">${g.by}${g.tool ? ` · ${g.tool}` : ""}</span> — ${esc(g.hint)}</li>`).join("\n");
  return `<!doctype html>
<meta charset="utf-8">
<title>${esc(index.product.name)} — what the studio has</title>
<style>
  ${lightThemeCss()}
  body { margin: 0; padding: 40px; background: var(--color-paper); color: var(--color-ink); font-family: system-ui, sans-serif; }
  h1 { font-size: 34px; margin: 0 0 4px; }
  h2 { font-size: 20px; margin: 40px 0 12px; color: var(--color-muted); font-weight: 600; }
  .sub { color: var(--color-muted); font-family: ui-monospace, monospace; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
  figure { margin: 0; background: var(--color-surface); border: 1px solid var(--color-line); border-radius: 10px; overflow: hidden; }
  img { width: 100%; display: block; }
  figcaption { padding: 8px 10px; font-family: ui-monospace, monospace; font-size: 12px; color: var(--color-muted); }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--color-line); vertical-align: top; }
  th { color: var(--color-muted); font-weight: 600; }
  .why { color: var(--color-muted); font-size: 12px; }
  ul { line-height: 1.7; } .who { font-family: ui-monospace, monospace; font-size: 12px; color: var(--color-accent); }
  object { max-width: 100%; }
</style>
<h1>${esc(index.product.name)}</h1>
<div class="sub">${esc(`${index.product.kind} · direction ${d.name} · ${d.scheme} · ${d.signal} · stage ${d.stage.hex} · accent ${d.accent.hex}`)}</div>

<h2>The palette</h2>
<object data="palette.svg" type="image/svg+xml"></object>

${index.map ? `<h2>How it works</h2>\n<object data="map.svg" type="image/svg+xml"></object>\n<div class="sub">screens: ${index.map.screens} · edges filmed: ${index.map.filmed} · edges the film does not show: ${index.map.unfilmed}</div>` : ""}

<h2>Screens</h2>
<div class="grid">${index.screens.map((s) => tile(`../sessions/${s.file}`, `${s.take} · ${s.mark}`)).join("\n")}</div>

<h2>Components</h2>
<div class="grid">${index.components.map((c) => tile(`../sessions/${c.file}`, `${c.take} · ${c.mark}${c.name ? ` · ${c.name}` : ""}`)).join("\n")}</div>

<h2>Controls, at up to eight device pixels per CSS pixel</h2>
<div class="grid">${index.macro.map((m) => tile(`../sessions/${m.file}`, `${m.take} · ${m.mark} · ${m.pixelRatio}x`)).join("\n")}</div>

<h2>What each mark can be shown as</h2>
<table><tr><th>mark</th><th>label</th><th>takes</th><th>shots</th><th>what is missing</th></tr>${rows}</table>

<h2>What is missing${index.gaps.length === 0 ? " — nothing" : ""}</h2>
<ul>${gaps}</ul>
`;
}

export type StudyInput = {
  ws: Workspace;
  profile: { name: string; kind: string };
  brand: BrandProfile;
  direction: Direction;
  takes: SessionLog[];
  tour?: TourScript | null;
  facts?: FactSheet | null;
};

/** Builds the study and writes it under `study/`. Reads disk; starts nothing. */
export async function writeStudy(input: StudyInput): Promise<StudyIndex> {
  const { ws, brand, direction, takes, tour } = input;
  const dir = join(ws.dir, "study");
  await mkdir(dir, { recursive: true });

  const material = materialOf(takes, tour);
  const facts = input.facts?.facts.length ?? 0;

  const index: StudyIndex = {
    version: STUDY_VERSION,
    product: { id: ws.id, name: input.profile.name, kind: input.profile.kind },
    direction: { name: direction.name, scheme: direction.scheme, signal: direction.signal, stage: direction.stage.hex, accent: direction.accent.hex, branded: direction.branded },
    takes: takes.map((t) => ({ name: t.name, take: t.take, frames: t.frames?.length ?? 0, elements: t.elements?.length ?? 0, macros: t.macros?.length ?? 0, durationMs: t.durationMs })),
    screens: takes.flatMap((t) => (t.frames ?? []).map((f) => ({ take: t.take, mark: f.mark, file: f.file, url: f.url }))),
    components: takes.flatMap((t) => (t.elements ?? []).map((e) => ({ take: t.take, mark: e.mark, file: e.file, ...(e.name ? { name: e.name } : {}), ...(e.kind ? { kind: e.kind } : {}) }))),
    macro: takes.flatMap((t) =>
      (t.macros ?? []).map((m) => ({
        take: t.take,
        mark: m.mark,
        file: m.file,
        pixelRatio: m.pixelRatio,
        ...(m.at ? { at: m.at } : {}),
        ...(m.afterControl ? { afterControl: m.afterControl.file } : {}),
        ...(m.after ? { after: m.after.file } : {}),
      })),
    ),
    clips: takes.flatMap(clipsOf),
    identity: { palette: "palette.svg" },
    facts,
    material,
    gaps: [],
  };

  /* The identity assets: the logo is indexed where it already sits, the wordmark is made. */
  if (brand.logo?.file && existsSync(brand.logo.file)) {
    const name = `logo${brand.logo.file.slice(brand.logo.file.lastIndexOf("."))}`;
    /* A boundary, not a prefix: `startsWith(dir)` also said yes to a sibling whose name
       merely extends the study directory's, and then nothing was copied and the index
       named a file that is not there. */
    if (!inside(dir, brand.logo.file)) await copyFile(brand.logo.file, join(dir, name)).catch(() => undefined);
    index.identity.logo = existsSync(join(dir, name)) ? name : basename(brand.logo.file);
    index.identity.logoKind = brand.logo.kind;
    index.identity.logoWidth = brand.logo.width;
    index.identity.logoHeight = brand.logo.height;
  }
  await writeFile(join(dir, "palette.svg"), paletteSvg(direction, input.profile.name), "utf8");
  await writeFile(join(dir, "wordmark.svg"), wordmarkSvg(input.profile.name, direction), "utf8");
  index.identity.wordmark = "wordmark.svg";

  if (tour) {
    const svg = mapSvg(tour, direction, { title: input.profile.name });
    if (svg) {
      await writeFile(join(dir, "map.svg"), svg, "utf8");
      /* Only the edges the map actually draws: one that points at a state with no node
         of its own would be counted here and missing from the picture. */
      const edges = (tour.edges ?? []).filter((e) => e.to !== undefined && (tour.pages ?? []).some((p) => p.id === e.to));
      index.map = { file: "map.svg", screens: tour.pages?.length ?? 0, filmed: edges.filter((e) => !e.seen).length, unfilmed: edges.filter((e) => e.seen).length };
    }
  }

  index.gaps = gapsOf({ takes, material, brand, direction, tour, facts });
  await writeFile(join(dir, "index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  await writeFile(join(dir, "gaps.json"), `${JSON.stringify(index.gaps, null, 2)}\n`, "utf8");
  await writeFile(join(dir, "book.html"), bookHtml(index, direction), "utf8");
  return index;
}

/** Reads a study back without building one. */
export async function readStudy(ws: Workspace): Promise<StudyIndex | null> {
  try {
    return JSON.parse(await readFile(join(ws.dir, "study", "index.json"), "utf8")) as StudyIndex;
  } catch {
    return null;
  }
}
