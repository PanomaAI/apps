/*
  The board, as a board.

  A storyboard is looked at. Every other artefact in this repository is a file somebody
  reads or a film somebody watches, and this is the third thing: a sheet of panels in
  order, each with its picture, its number, its duration and an arrow saying what the
  camera does. It is the artefact advertising has taken into a room to get a yes since
  before any of this was possible, and it is the reason a board is worth writing at all —
  you can see the film before it exists, and disagree with it for the price of a sentence.

  It is rasterized rather than drawn as SVG because the panels are photographs and the
  labels are type, and Chromium already sets type better than anything that could be
  hand-rolled here. Nothing in this page moves, nothing loads from a network, and every
  picture is inlined as a data URI — so the sheet is one file that survives being emailed,
  which is the entire point of a pitch board.
*/
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { Board, Shot } from "@panoma/video-gen";
import { secondsOf, billedSeconds, commissioned } from "@panoma/video-gen";
import { lightThemeCss } from "@panoma/video-core/theme";

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

const tc = (frames: number, fps: number) =>
  `${String(Math.floor(frames / fps)).padStart(2, "0")}:${String(frames % fps).padStart(2, "0")}`;

/*
  The arrow. It is the notation layer, and on a real board it is drawn over the panel.

  A storyboard says what the camera does with a mark on the drawing, not with a word in a
  margin — the reader's eye is already on the picture. So each move gets the glyph the
  craft uses for it: brackets closing in for a push, an arrow for a pan or a dolly, a
  double chevron for a whip.
*/
const ARROW: Record<string, string> = {
  "push-in": "▛ ▟",
  "pull-out": "▙ ▜",
  dolly: "⟵⟶",
  pan: "⟶",
  tilt: "↓",
  "whip-pan": "≫",
  "crash-zoom": "»»",
  "snap-zoom-out": "««",
  static: "▪",
  handheld: "≈",
  orbit: "↻",
  crane: "↑",
  "speed-ramp": "⇢",
  roll: "⟳",
  flythrough: "⇉",
};

async function dataUri(file: string): Promise<string | null> {
  try {
    const bytes = await readFile(file);
    return `data:${MIME[extname(file).toLowerCase()] ?? "image/png"};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function panelCell(shot: Shot, board: Board, lang: string): Promise<string> {
  const cells = await Promise.all(
    shot.panels.map(async (p) => {
      const uri = p.still ? await dataUri(p.still.file) : null;
      const inner = uri
        ? `<img src="${uri}" alt="">`
        : shot.text
          ? `<div class="card"><span>${esc(Object.values(shot.text)[0] ?? "")}</span></div>`
          : `<div class="empty">no picture</div>`;
      /* Crosshair where the subject actually is, from the control the take clicked. */
      const mark = p.still ? `<i class="eye" style="left:${(p.screen.x * 100).toFixed(1)}%;top:${(p.screen.y * 100).toFixed(1)}%"></i>` : "";
      return `<figure class="panel"><div class="shot">${inner}${mark}<b class="pid">${esc(p.id)}</b></div></figure>`;
    }),
  );
  const say = shot.say?.[lang] ?? (shot.say ? Object.values(shot.say)[0] : "");
  const badge =
    shot.origin === "generated"
      ? `<em class="b gen">${esc(shot.gen?.mode ?? "generated")}</em>`
      : shot.origin === "card"
        ? `<em class="b card">card</em>`
        : `<em class="b cap">recording</em>`;
  const bought = shot.gen
    ? `<span class="buy">buys ${shot.gen.seconds}s · the cut enters ${(shot.gen.inPoint / board.fps).toFixed(1)}s in</span>`
    : "";
  return `<section class="row">
  <header><span class="n">${shot.n}</span>${badge}<span class="t">${tc(shot.duration, board.fps)}</span></header>
  <div class="panels">${cells.join("")}</div>
  <div class="notation">
    <p class="move"><span class="arrow">${ARROW[shot.move] ?? "▪"}</span> ${esc(shot.move)} · ${esc(shot.framing)} · out on ${esc(shot.out)}</p>
    <p class="subject">${esc(shot.subject)}</p>
    ${say ? `<p class="say">“${esc(say)}”</p>` : ""}
    ${shot.gen ? `<p class="motion">camera: ${esc(shot.gen.motion)}</p>` : ""}
    <p class="note">${esc(shot.note)}</p>
    ${bought}
  </div>
</section>`;
}

/**
 * Write the board as one self-contained HTML sheet, and rasterize it.
 *
 * Returns both paths. The HTML is the artefact that survives — it holds every panel at
 * full resolution — and the PNG is the one that goes in a message.
 */
export async function contactSheet(
  board: Board,
  opts: { html: string; png?: string; lang?: string },
): Promise<{ html: string; png?: string }> {
  const lang = opts.lang ?? "en";
  const rows = await Promise.all(board.shots.map((s) => panelCell(s, board, lang)));
  const buys = commissioned(board);
  const page = `<!doctype html><meta charset="utf-8"><title>${esc(board.id)}</title>
<style>
  ${lightThemeCss()}
  :root { --ink:var(--color-ink); --paper:var(--color-paper); --line:var(--color-line); --dim:var(--color-muted); --accent:var(--color-accent); }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--paper); color:var(--ink);
         font:14px/1.5 ui-sans-serif,-apple-system,"Helvetica Neue",Arial,sans-serif; }
  .sheet { width:1600px; margin:0 auto; padding:48px 56px 64px; }
  h1 { font-size:30px; letter-spacing:-.02em; margin:0 0 4px; font-weight:650; }
  .sub { color:var(--dim); margin:0 0 6px; font-size:15px; }
  .meta { display:flex; gap:22px; flex-wrap:wrap; color:var(--dim); font-size:12.5px;
          font-family:ui-monospace,"SF Mono",Menlo,monospace; padding-bottom:22px;
          border-bottom:2px solid var(--ink); margin-bottom:8px; }
  .meta b { color:var(--ink); font-weight:600; }
  .row { display:grid; grid-template-columns:76px 1fr 340px; gap:22px; align-items:start;
         padding:22px 0; border-bottom:1px solid var(--line); }
  header { display:flex; flex-direction:column; gap:7px; align-items:flex-start; padding-top:2px; }
  .n { font:600 22px/1 ui-monospace,"SF Mono",Menlo,monospace; }
  .t { font:12px/1 ui-monospace,"SF Mono",Menlo,monospace; color:var(--dim); }
  .b { font-style:normal; font-size:10.5px; letter-spacing:.07em; text-transform:uppercase;
       padding:2.5px 6px; border-radius:3px; font-weight:600; }
  .b.gen { background:var(--accent); color:var(--color-on-accent); }
  .b.cap { background:var(--ink); color:var(--paper); }
  .b.card { background:none; border:1px solid var(--line); color:var(--dim); }
  /*
    Two panels share the row; one panel takes half of it and leaves the other half empty.
    A card is a single panel and it is not more important than a shot with a move in it —
    letting it stretch to the full width made the board read as if it were.
  */
  .panels { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .panel { margin:0; min-width:0; }
  .shot { position:relative; aspect-ratio:16/9; background:var(--color-surface); border:1px solid var(--line);
          overflow:hidden; display:flex; align-items:center; justify-content:center; }
  .shot img { width:100%; height:100%; object-fit:cover; display:block; }
  .pid { position:absolute; left:0; bottom:0; background:var(--ink); color:var(--paper);
         font:600 11px/1 ui-monospace,Menlo,monospace; padding:4px 7px; letter-spacing:.04em; }
  .eye { position:absolute; width:26px; height:26px; margin:-13px 0 0 -13px; border-radius:50%;
         border:2px solid var(--accent); outline:1px solid var(--color-on-accent); }
  .eye:after { content:""; position:absolute; inset:10px; background:var(--accent); border-radius:50%; }
  .card { color:var(--ink); padding:18px; text-align:center; font-size:19px; font-weight:600; line-height:1.3; }
  .empty { color:var(--dim); font:11px ui-monospace,Menlo,monospace; letter-spacing:.08em; text-transform:uppercase; }
  .notation p { margin:0 0 6px; }
  .move { font:12px/1.45 ui-monospace,"SF Mono",Menlo,monospace; text-transform:uppercase;
          letter-spacing:.05em; color:var(--ink); }
  .arrow { color:var(--accent); font-size:15px; letter-spacing:0; }
  .subject { font-weight:600; font-size:15.5px; }
  .say { color:var(--ink); font-style:italic; }
  .motion { color:var(--accent); font-size:12.5px; font-family:ui-monospace,Menlo,monospace; }
  .note, .buy { color:var(--dim); font-size:12.5px; }
  .buy { display:block; font-family:ui-monospace,Menlo,monospace; padding-top:2px; }
  footer { padding-top:26px; color:var(--dim); font-size:12.5px; font-family:ui-monospace,Menlo,monospace; }
  footer b { color:var(--ink); }
</style>
<div class="sheet">
  <h1>${esc(board.project)} — ${esc(board.mode)} board</h1>
  <p class="sub">${esc(board.premise)}</p>
  <div class="meta">
    <span><b>${board.shots.length}</b> shots</span>
    <span><b>${secondsOf(board).toFixed(1)}s</b> at ${board.fps}fps</span>
    <span><b>${buys.length}</b> commissioned</span>
    <span><b>${billedSeconds(board)}s</b> billed</span>
    <span>${esc(board.format === "v" ? "9:16" : board.format === "s" ? "1:1" : "16:9")}</span>
  </div>
  ${rows.join("\n")}
  <footer>
    <b>${esc(board.bible.photography)}.</b> ${esc(board.bible.mood)}. Palette ${board.bible.palette.map(esc).join(" · ")}.<br>
    Every panel marked <b>recording</b> or <b>card</b> is the product's own pixels or panoma video's own type. A panel marked
    <b>interpolate</b> begins and ends on a real frame of the recording and the model moves the camera between them.
    ${board.open?.length ? `<br><br>Not decided: ${board.open.map(esc).join(" · ")}` : ""}
  </footer>
</div>`;
  await writeFile(opts.html, page, "utf8");
  if (!opts.png) return { html: opts.html };

  /*
    Rasterized with the determinism flags the rest of the repository uses, so a sheet looks
    the same on the machine that made it and the machine it is opened on.
  */
  const { pageShot } = await import("@panoma/video-capture");
  await pageShot(opts.html, opts.png, { width: 1600 });
  return { html: opts.html, png: opts.png };
}

export const sheetName = (board: Board) => `${basename(board.id)}.board`;
