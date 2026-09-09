/*
  The diagram of how the product works, drawn from the walk that filmed it.

  "Here is the app: make a diagram of how it works" is the owner's ask, and the honest
  version of it is narrow: this draws the states the walker actually reached and the
  controls it actually pressed. It infers no route, follows no link it did not click, and
  merges nothing it did not measure to be the same state. A product's real map is larger
  than this one; a map that guessed the difference would be a drawing of a product nobody
  filmed.

  Three rules it is written to keep:

  - **No edge the tour did not walk.** Every edge comes from a click that happened and a
    page that answered. A control refused for any other reason lives in `candidates` with
    its reason and is not here.
  - **A back edge is real.** "Leads to a state the tour has already shown" is a working
    control the film never shows; it is drawn dashed rather than dropped, because the
    product has it.
  - **Nothing volatile is drawn.** Paths are origin-relative — the dev server binds a free
    port that changes every run — and every label was masked by `redact` when the walker
    recorded it.

  It is one SVG built by hand: BFS layering, no graph library, byte-identical for the same
  tour so the file only changes when the product does.
*/
import type { Direction } from "@panoma/video-brand/direction";
import type { ScreenEdge, ScreenNode, TourScript } from "@panoma/video-tour";

export type MapOptions = {
  /** The product's name, for the caption. Drawn only when it is a name (see `isName`). */
  title?: string;
  width?: number;
};

const NODE_W = 230;
const NODE_H = 84;
const GAP_X = 120;
const GAP_Y = 46;
const PAD = 40;

const esc = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** At most this many characters on a line of a node, so a long heading never overruns its box. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Which column each state sits in: its distance from the page the tour started on,
 * following only the edges that were filmed. A state nothing reaches (the walk arrived by
 * a route the graph did not record) is placed in the first column that has room.
 */
export function layerOf(pages: ScreenNode[], edges: ScreenEdge[]): Map<string, number> {
  const depth = new Map<string, number>();
  const start = pages.find((p) => p.order === 0);
  if (!start) return depth;
  depth.set(start.id, 0);
  const queue = [start.id];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const here = depth.get(id)!;
    for (const e of edges) {
      if (e.from !== id || e.to === undefined || e.seen) continue;
      if (depth.has(e.to)) continue;
      depth.set(e.to, here + 1);
      queue.push(e.to);
    }
  }
  for (const p of pages) if (!depth.has(p.id)) depth.set(p.id, 0);
  return depth;
}

export function mapSvg(tour: TourScript, direction: Direction, opts: MapOptions = {}): string {
  const pages = tour.pages ?? [];
  const edges = (tour.edges ?? []).filter((e) => e.to === undefined || pages.some((p) => p.id === e.to));
  if (pages.length === 0) return "";

  const depth = layerOf(pages, edges);
  const columns: ScreenNode[][] = [];
  for (const p of [...pages].sort((a, b) => a.order - b.order)) {
    const d = depth.get(p.id) ?? 0;
    (columns[d] ??= []).push(p);
  }

  const rows = Math.max(...columns.map((c) => c.length), 1);
  const width = PAD * 2 + columns.length * NODE_W + (columns.length - 1) * GAP_X;
  /* Room above the top row for a self-loop, and below for the caption. */
  const loops = edges.some((e) => e.to !== undefined && e.to === e.from) ? 66 : 0;
  const height = PAD * 2 + loops + rows * NODE_H + (rows - 1) * GAP_Y + 44;

  const at = new Map<string, { x: number; y: number }>();
  columns.forEach((column, c) => {
    const span = column.length * NODE_H + (column.length - 1) * GAP_Y;
    const top = PAD + loops + (rows * NODE_H + (rows - 1) * GAP_Y - span) / 2;
    column.forEach((p, r) => at.set(p.id, { x: PAD + c * (NODE_W + GAP_X), y: top + r * (NODE_H + GAP_Y) }));
  });

  const d = direction;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${opts.width ?? width}" role="img" aria-label="How ${esc(opts.title ?? tour.name)} works">`);
  out.push(`<rect width="${width}" height="${height}" fill="${d.stage.hex}"/>`);
  out.push(`<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-end"><path d="M0,0 L10,5 L0,10 z" fill="${d.muted.hex}"/></marker></defs>`);

  /*
    Edges first, so a node always sits on top of the line that reaches it. Two things
    the first drawing got wrong, both visible the moment it ran on a real product:

    - A label longer than the gap between two columns slid under the destination box and
      was read as a clipped word. It is cut to what the gap holds and sits on a plate of
      the stage, because it crosses the line it names.
    - Two controls that lead to the SAME state drew one line on top of another: the
      caption said two and the picture showed one. Parallel edges are fanned.
  */
  const parallel = new Map<string, number>();
  for (const e of edges) {
    const from = at.get(e.from);
    const to = e.to ? at.get(e.to) : undefined;
    if (!from) continue;
    const lane = parallel.get(`${e.from}|${e.to ?? ""}`) ?? 0;
    parallel.set(`${e.from}|${e.to ?? ""}`, lane + 1);
    const bend = lane * 26 - (lane > 0 ? 13 : 0);

    /*
      A control whose use leaves the product in the state it was already in — panoma's
      site has one: the copy button, pressed twice. Drawn as a straight line from a box to
      itself it is a degenerate stroke pointing backwards, so it gets a loop over the node
      instead. It is a real edge and it stays on the drawing.
    */
    if (e.to === e.from) {
      const lx = from.x + NODE_W / 2;
      const top = from.y;
      out.push(`<path d="M${lx - 34} ${top} C${lx - 34} ${top - 46} ${lx + 34} ${top - 46} ${lx + 34} ${top}" fill="none" stroke="${e.seen ? d.faint.hex : d.accent.hex}" stroke-width="2" marker-end="url(#a)"/>`);
      const self = clip(e.label, 24);
      out.push(`<rect x="${lx - self.length * 3.9 - 6}" y="${top - 62}" width="${self.length * 7.8 + 12}" height="18" rx="4" fill="${d.stage.hex}"/>`);
      out.push(`<text x="${lx}" y="${top - 49}" text-anchor="middle" font-family="${esc(d.fonts.body)}" font-size="14" fill="${d.ink.hex}">${esc(self)}</text>`);
      continue;
    }

    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to ? to.x : from.x + NODE_W + GAP_X * 0.6;
    const y2 = to ? to.y + NODE_H / 2 : y1;
    const mid = (x1 + x2) / 2;
    const stroke = e.seen ? d.faint.hex : d.accent.hex;
    const dash = e.seen ? ` stroke-dasharray="6 5"` : e.desktopOnly ? ` stroke-dasharray="2 4"` : "";
    out.push(`<path d="M${x1} ${y1} C${mid} ${y1 + bend} ${mid} ${y2 + bend} ${x2} ${y2}" fill="none" stroke="${stroke}" stroke-width="2"${dash} marker-end="url(#a)"/>`);
    /* 14px in the body face runs about 7.6px a character; the gap is what there is. */
    const label = clip(e.label, Math.max(8, Math.floor((x2 - x1) / 7.6)));
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2 + bend - 10;
    out.push(`<rect x="${cx - label.length * 3.9 - 6}" y="${cy - 13}" width="${label.length * 7.8 + 12}" height="18" rx="4" fill="${d.stage.hex}"/>`);
    out.push(`<text x="${cx}" y="${cy}" text-anchor="middle" font-family="${esc(d.fonts.body)}" font-size="14" fill="${e.seen ? d.muted.hex : d.ink.hex}">${esc(label)}</text>`);
    if (e.desktopOnly) {
      out.push(`<text x="${cx}" y="${cy + 18}" text-anchor="middle" font-family="${esc(d.fonts.mono)}" font-size="11" fill="${d.muted.hex}">desktop only</text>`);
    }
  }

  /*
    Two states of one page carry the same heading and the same path — a menu opened, a
    sound turned off — and drawn from those alone they are two identical boxes. What
    distinguishes them is the control that produced the second, which the edge already
    knows. Nothing is invented: the subtitle is the label of the click that led in.
  */
  const twin = (p: ScreenNode) => pages.some((o) => o !== p && o.path === p.path && (o.heading ?? "") === (p.heading ?? ""));
  for (const p of pages) {
    const pos = at.get(p.id);
    if (!pos) continue;
    const via = twin(p) ? edges.find((e) => e.to === p.id && !e.seen)?.label : undefined;
    out.push(`<rect x="${pos.x}" y="${pos.y}" width="${NODE_W}" height="${NODE_H}" rx="10" fill="${d.plate.hex}" stroke="${p.order === 0 ? d.accent.hex : d.line.hex}" stroke-width="${p.order === 0 ? 2 : 1}"/>`);
    out.push(`<text x="${pos.x + 16}" y="${pos.y + 32}" font-family="${esc(d.fonts.display)}" font-size="18" fill="${d.ink.hex}">${esc(clip(p.heading ?? p.path, 22))}</text>`);
    out.push(`<text x="${pos.x + 16}" y="${pos.y + 58}" font-family="${esc(d.fonts.mono)}" font-size="13" fill="${d.muted.hex}">${esc(via ? clip(`after ${via}`, 26) : clip(p.path, 26))}</text>`);
  }

  /* Counted from what was DRAWN. A caption that counts edges the picture could not place
     says "2 filmed" over a drawing with no line in it, which is how the from-hash defect
     stayed invisible. */
  const drawn = edges.filter((e) => at.has(e.from));
  const caption = `${pages.length} ${pages.length === 1 ? "screen" : "screens"} · ${drawn.filter((e) => !e.seen).length} filmed, ${drawn.filter((e) => e.seen).length} not`;
  out.push(`<text x="${PAD}" y="${height - 16}" font-family="${esc(d.fonts.mono)}" font-size="13" fill="${d.muted.hex}">${esc(caption)}</text>`);
  out.push(`</svg>`);
  return out.join("\n");
}
