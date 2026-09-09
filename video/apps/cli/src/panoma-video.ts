#!/usr/bin/env node
/*
  The command. Everything it does is a composition of the same three stages —
  assets -> render -> master — and every stage is skippable because its output is
  cached or already on disk. `panoma-video render` with no filters produces the full matrix:
  every hook, every language, every format, mastered to -14 LUFS.
*/
import "@panoma/video-engine/register";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { FORMATS, integerBpms, type Brief, type FactSheet } from "@panoma/video-core";
import { briefs } from "@panoma/video-briefs";
import { makeAssets } from "./assets.ts";
import { videoHome } from "@panoma/video-director";
import { loudness, master } from "./master.ts";

// Installed commands keep their outputs in the app home, never beside node_modules.
const ROOT = existsSync(fileURLToPath(new URL("./runtime.json", import.meta.url)))
  ? videoHome() : join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT = join(ROOT, "media", "render");

/*
  Scenes are .tsx and go through the engine's loader hook, which the import of
  @panoma/video-engine/register above installs. They must be imported dynamically: a static
  import would be resolved while the module graph links, before that hook exists.
*/
async function stage() {
  const [engine, render, timing] = await Promise.all([
    import("@panoma/video-engine"),
    import("@panoma/video-render/compositions"),
    import("@panoma/video-render/timing"),
  ]);
  /*
    Two matrices exist: the repository's own briefs, and a project's workspace under
    PANOMA_VIDEO_HOME written by `panoma-video auto`. `--project=<id>` (or PANOMA_VIDEO_PROJECT) swaps the
    second in for every command that reads the matrix — list, render, music, kit,
    launch and record; everything downstream is the same code, and the outputs
    land in that workspace.
  */
  const projectId = flag("project") ?? process.env.PANOMA_VIDEO_PROJECT;
  if (projectId) {
    const { studioWorkspace } = await import("@panoma/video-director");
    const { expandBrief } = await import("@panoma/video-core");
    const workspace = await studioWorkspace(projectId);
    return { ...engine, ...workspace.matrix, briefs: workspace.raw.map(brief => expandBrief(brief, workspace.facts)),
      assetsDir: workspace.dirs.assets, sessionsDir: workspace.dirs.sessions, sfxDir: workspace.dirs.sfx,
      timing, out: workspace.ws.paths.renders, kits: workspace.ws.paths.kits, workspace };
  }
  const matrix = render.buildCompositions(briefs as Brief[], render.REPO_DIRS);
  return { ...engine, ...matrix, briefs: briefs as Brief[], assetsDir: render.assetsDir, sessionsDir: render.sessionsDir, sfxDir: render.REPO_DIRS.sfx, timing, out: OUT, kits: join(ROOT, "media", "kits"), workspace: undefined };
}

/*
  The work list, derived from the compositions that EXIST rather than from a
  parallel enumeration of briefs. The two used to be computed separately, so a
  brief whose take was missing still printed in `panoma-video list` and then crashed the
  commands that tried to render it.
*/
function selected<T extends { id: string }>(compositions: readonly T[]): T[] {
  const formats = flag("format")?.split(",");
  const wantBrief = rest.find((a) => !a.startsWith("--"));
  const wantHook = flag("hook");
  const wantLang = flag("lang");
  return compositions.filter((c) => {
    const [brief, hook, lang, format] = c.id.split("--");
    return (
      (!wantBrief || brief === wantBrief) &&
      (!wantHook || hook === wantHook) &&
      (!wantLang || lang === wantLang) &&
      (!formats || formats.includes(format))
    );
  });
}

/** brief--hook--lang--format, resolved back into its parts. */
function entryOf(id: string, list: readonly Brief[] = briefs) {
  const [briefId, hookId, lang, formatId] = id.split("--");
  const brief = list.find((b) => b.id === briefId);
  const hook = brief?.hooks.find((h) => h.id === hookId);
  if (!brief || !hook) throw new Error(`"${id}" does not resolve to a brief and hook.`);
  return { id, brief, hook, lang, formatId: formatId as keyof typeof FORMATS };
}

const [, , command, ...rest] = process.argv;
const flag = (name: string) => rest.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
/* A music file, absolute or from where the command was typed: the score stage reads its bytes, so a relative path must be resolved here. */
const musicFlag = () => {
  const given = flag("music");
  return given ? resolve(given) : undefined;
};

async function cmdList() {
  const { compositions, mismatched } = await stage();
  const rows = selected(compositions);
  for (const c of rows) console.log(`${c.id}${mismatched.has(c.id) ? "   (fallback take — badly framed)" : ""}`);
  console.log(`\nrenders in the matrix: ${rows.length}`);
}

/** Every path that can encode prepares the same local audio, including older workspaces. */
async function stageWithSound() {
  let staged = await stage();
  /*
    A bed is mounted only when its file is ALREADY on disk when the matrix is built
    (compositions.tsx), and this command never wrote one — `panoma-video music` did, and
    `panoma-video auto` builds the matrix twice for exactly this reason. So a composition whose
    bed was missing rendered silent and then failed the gate for silence, with nothing
    anywhere saying the music had not been generated. It bit the moment a product's own
    tempo stopped being 120 for everyone, because a bed's file name is made of everything
    that shaped it.
  */
  const { writeBed, ensureSfx } = await import("@panoma/video-audio");
  let wrote = await ensureSfx(staged.sfxDir) ? 1 : 0;
  for (const comp of selected(staged.compositions)) {
    const bed = staged.beds.get(comp.id);
    if (!bed || existsSync(bed.path)) continue;
    await mkdir(join(bed.path, ".."), { recursive: true });
    writeBed(bed.opts, bed.path);
    console.log(`  bed: ${bed.path}`);
    wrote++;
  }
  /* Built once to learn which beds exist, and again to mount the ones just written. */
  if (wrote > 0) staged = await stage();
  return staged;
}

async function cmdRender() {
  const staged = await stageWithSound();
  if (selected(staged.compositions).length === 0) {
    console.error("Nothing matches. `panoma-video list` shows the matrix.");
    process.exit(1);
  }

  if (staged.workspace) {
    for (const comp of selected(staged.compositions)) {
      const result = await staged.workspace.render(comp.id, (done, total) => console.log(`  ${done}/${total}`), undefined, { force: rest.includes("--force") });
      console.log(`Reviewed export: ${result.out}`);
    }
    return;
  }
  const { renderComposition, assetsDir, sessionsDir, out: outDir } = staged;
  const jobs = selected(staged.compositions);
  await mkdir(outDir, { recursive: true });
  for (const comp of jobs) {
    const out = join(outDir, `${comp.id}.mp4`);
    console.log(`\n▸ ${comp.id} · ${comp.format.width}x${comp.format.height} · ${comp.durationInFrames}f @ ${comp.fps}`);
    const started = Date.now();
    await renderComposition(comp, {
      out,
      assetsDir,
      sessionsDir,
      onProgress: (done, total) => console.log(`  ${done}/${total}`),
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (comp.audio.length > 0) {
      await master(out);
      console.log(`  mastered: ${await loudness(out)} LUFS · ${seconds}s -> ${out}`);
    } else {
      console.log(`  silent · ${seconds}s -> ${out}`);
    }
  }
  console.log(`\nfiles written: ${jobs.length}`);
}

async function cmdStory() {
  const project = flag("project") ?? process.env.PANOMA_VIDEO_PROJECT;
  if (!project) throw new Error("Use --project=<id> to select a project workspace.");
  const { studioWorkspace } = await import("@panoma/video-director");
  const workspace = await studioWorkspace(project, undefined, { prepareAudio: false });
  const brief = rest.find(arg => !arg.startsWith("--")) ?? workspace.raw.find(brief => brief.recipe === "ProductPromo")?.id;
  if (!brief) throw new Error("This workspace has no promotion yet.");
  const document = await workspace.document(brief);
  if (command === "story") { console.log(JSON.stringify(document, null, 2)); return; }
  const expectedRevision = flag("revision");
  if (!expectedRevision) throw new Error("Use --revision=<revision> from panoma-video story to preserve concurrent edits.");
  let request: import("@panoma/video-director").PromoRevisionRequest;
  const instruction = flag("instruction"), restoreRevision = flag("restore"), patchFile = flag("edits");
  if ([instruction, restoreRevision, patchFile].filter(Boolean).length !== 1) throw new Error("Choose one of --instruction=<request>, --restore=<revision>, or --edits=<JSON file>.");
  if (patchFile) {
    const { readFile } = await import("node:fs/promises");
    request = { expectedRevision, edits: JSON.parse(await readFile(resolve(patchFile), "utf8")) };
  } else request = { expectedRevision, ...(instruction ? { instruction } : { restoreRevision }) };
  const result = await workspace.revise(brief, request, flag("brain") as import("@panoma/video-brain").BrainChoice | undefined);
  console.log(JSON.stringify(result, null, 2));
}

async function cmdKit() {
  const briefId = rest.find((a) => !a.startsWith("--"));
  if (!briefId) {
    console.error("panoma-video kit <brief> [--sheet] — kits are per brief; `panoma-video list` shows ids.");
    process.exit(1);
  }
  const { compositions, assetsDir, sessionsDir, renderStill, renderFrames, timing, chapters, briefs: list, kits } = await stage();
  const { writeKit } = await import("@panoma/video-director");
  const jobs = selected(compositions);
  if (jobs.length === 0) {
    console.error(`Nothing in the matrix starts with "${briefId}--".`);
    process.exit(1);
  }
  for (const comp of jobs) {
    const dir = await writeKit(entryOf(comp.id, list), {
      kitsDir: kits,
      assetsDir,
      sessionsDir,
      sheet: rest.includes("--sheet"),
      chapters: chapters.get(comp.id),
      comp,
      renderStill,
      renderFrames,
      heroFrame: timing.heroFrame,
    });
    console.log(`· ${dir}`);
  }
  console.log(`\nkits written: ${jobs.length}. Replace {{LINK}} before publishing.`);
}

async function cmdLaunch() {
  const briefId = rest.find((a) => !a.startsWith("--"));
  const started = Date.now();
  const { renderComposition, compositions, assetsDir, sessionsDir, mismatched, renderStill, renderFrames, timing, chapters, plans, briefs: list, out: outDir, kits, workspace } =
    await stageWithSound();
  if (!briefId || !list.some((b) => b.id === briefId)) {
    console.error(`panoma-video launch <brief> — briefs: ${list.map((b) => b.id).join(", ")}`);
    process.exit(1);
  }
  const { writeKit } = await import("@panoma/video-director");
  const { reviewVideo, reportText } = await import("@panoma/video-review");
  const jobs = selected(compositions);
  if (jobs.length === 0) {
    console.error(`Nothing to launch for "${briefId}". A ScreenCast brief needs its take first: panoma-video record <session>`);
    process.exit(1);
  }

  /*
    A launch set is a deliverable, not a preview. If any cut would be built on a
    substituted take — a phone recording stretched across a 16:9 frame — stop and
    say so, because the whole point of this command is that nobody inspects the
    files at 2am before posting them.
  */
  const bad = jobs.filter((c) => mismatched.has(c.id));
  if (bad.length > 0 && !rest.includes("--force")) {
    console.error(
      `Refusing to launch. Cuts built on a fallback take: ${bad.length}\n` +
        bad.map((c) => `  ${c.id}`).join("\n") +
        `\nRecord the missing take, or pass --force to ship them anyway.`,
    );
    process.exit(1);
  }

  if (workspace && jobs.every(comp => workspace.raw.find(brief => brief.id === comp.id.split("--")[0])?.recipe === "ProductPromo")) {
    for (const comp of jobs) {
      const output = await workspace.render(comp.id, (done, total) => { if (done === total) console.log(`  ${done}/${total}`); }, undefined, { force: rest.includes("--force") });
      await writeKit(entryOf(comp.id, list), { kitsDir: kits, assetsDir, sessionsDir, sheet: rest.includes("--sheet"), chapters: chapters.get(comp.id), comp, renderStill, renderFrames, heroFrame: timing.heroFrame });
      console.log(`Reviewed launch export: ${output.out}`);
    }
    return;
  }
  await mkdir(outDir, { recursive: true });
  const made: string[] = [];
  const failed: { id: string; message: string }[] = [];

  for (const comp of jobs) {
    const out = join(outDir, `${comp.id}.mp4`);
    console.log(`\n▸ ${comp.id} · ${comp.format.width}x${comp.format.height} · ${comp.durationInFrames}f`);
    try {
      await renderComposition(comp, {
        out,
        assetsDir,
        sessionsDir,
        onProgress: (done, total) => {
          if (done === total) console.log(`  ${done}/${total}`);
        },
      });
      let lufs = "silent";
      if (comp.audio.length > 0) {
        await master(out);
        lufs = `${await loudness(out)} LUFS`;
      }
      /*
        The gate. A launch set is a deliverable, and the review measures the file the
        way a platform will: a failing check stops the set unless --force says ship it.
        Warnings print and do not stop anything.
      */
      const plan = plans.get(comp.id);
      const fps = comp.fps;
      const report = await reviewVideo(out, {
        targets: comp.format.targets.filter((t) => ["youtube", "shorts", "tiktok", "reels", "x", "linkedin"].includes(t)),
        /* Every planned change of picture, whatever its kind — the same list `panoma-video auto` hands the review, so the two gates agree. */
        plannedCuts: plan?.cuts.map((c) => c.frame / fps),
        declaredHolds: [...(plan?.holds ?? []), ...(plan?.cards ?? [])].map((h) => ({ from: h.from / fps, to: h.to / fps })),
        recipe: comp.id.split("--")[0] ? list.find((b) => b.id === comp.id.split("--")[0])?.recipe : undefined,
        expectSilent: comp.audio.length === 0,
      });
      const { writeFile } = await import("node:fs/promises");
      await writeFile(out.replace(/\.mp4$/, ".review.json"), JSON.stringify(report, null, 2));
      if (report.status !== "pass") console.log(reportText(report, "concise").split("\n").map((l) => `  ${l}`).join("\n"));
      if (report.status === "fail" && !rest.includes("--force")) {
        throw new Error(`review failed (${report.checks.filter((c) => c.status === "fail").map((c) => c.id).join(", ")}); --force ships it anyway`);
      }
      const dir = await writeKit(entryOf(comp.id, list), {
        kitsDir: kits,
        assetsDir,
        sessionsDir,
        sheet: rest.includes("--sheet"),
        chapters: chapters.get(comp.id),
        comp,
        renderStill,
        renderFrames,
        heroFrame: timing.heroFrame,
      });
      console.log(`  ${lufs} · kit ${dir}`);
      made.push(comp.id);
    } catch (error) {
      /* A truncated mp4 named like a finished deliverable is the dangerous
         outcome — delete it, note the failure, and keep going. */
      await rm(out, { force: true }).catch(() => undefined);
      const message = (error as Error).message.split("\n")[0];
      console.error(`  failed: ${message}`);
      failed.push({ id: comp.id, message });
    }
  }

  const minutes = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`\nLaunch set for "${briefId}" — videos: ${made.length}, in minutes: ${minutes}.`);
  if (failed.length > 0) {
    console.error(`Cuts that failed and were deleted: ${failed.length}`);
    for (const f of failed) console.error(`  ${f.id} — ${f.message}`);
  }
  console.log(
    `Each finished cut has post.md and thumb.png beside it in its kits directory. Replace {{LINK}} before publishing,\n` +
      `and upload every file natively — never export one platform's copy into another.`,
  );
  if (failed.length > 0) process.exit(1);
}

/*
  The camera needs somewhere to point.

  A tour records absolute addresses, and when it was walked on a dev server those
  addresses name a port the operating system handed out for one run: by the time
  anyone replays the tour that socket is closed, so every take used to open
  `ERR_CONNECTION_REFUSED`, log zero marks, and be written to disk as if it were
  footage. So the address is resolved fresh, here, before a frame is shot — from
  `--url` if the caller has a server of their own, by starting the product's own dev
  server if the workspace remembers which project it is for, and not at all when the
  tour was walked on a deployed site, whose address is still the address.
*/
async function originForReplay(
  dir: string,
  tour: { url: string; steps: import("@panoma/video-capture").SessionStep[] },
  name: string,
): Promise<{ origin: string; forced: boolean; head?: string; server?: { url: string; stop(): Promise<void> } }> {
  const { isLoopback, readJson, videoHome } = await import("@panoma/video-director");
  const given = flag("url");
  /*
    An address the caller typed is an instruction, not a hint: every step goes there,
    including a tour walked on a deployed site. Left to the loopback rule, `--url` was
    printed as the address and then silently discarded for exactly those tours.
  */
  if (given) return { origin: new URL(/^https?:\/\//.test(given) ? given : `http://${given}`).origin, forced: true };
  const local = isLoopback(tour.url) || tour.steps.some((s) => "goto" in s && isLoopback(s.goto));
  if (!local) return { origin: new URL(tour.url).origin, forced: false };

  const { scoutProject, startServer } = await import("@panoma/video-scout");
  const saved = await readJson<{ root?: string }>(join(dir, "profile.json"));
  const advice = `Start it yourself and pass --url=<origin>, or re-run \`panoma-video auto\` on the project.`;
  if (!saved?.root) {
    throw new Error(`The tour "${name}" was walked on ${tour.url}, a port that closed when that run ended, and this workspace does not record which project it belongs to. ${advice}`);
  }
  /* A workspace outlives the folder it was made for; profile.json exists to make that recognisable, not to be trusted blindly. */
  const profile = await scoutProject(saved.root).catch(() => {
    throw new Error(`The tour "${name}" belongs to ${saved.root}, and there is nothing there any more. ${advice}`);
  });
  if (!profile.start) {
    if (profile.url) return { origin: new URL(profile.url).origin, forced: false };
    throw new Error(`The tour "${name}" was walked on ${tour.url}, a port that closed when that run ended, and ${profile.name} declares no start command. ${advice}`);
  }
  console.log(`· serving ${profile.start.command} ${profile.start.args.join(" ")} to replay the tour on`);
  const server = await startServer(profile, { timeoutMs: 90_000, runtimeBase: join(videoHome(), "runtimes") });
  return { origin: server.url, forced: false, head: profile.git?.head, server };
}

async function cmdRecord() {
  const name = rest.find((a) => !a.startsWith("--"));
  const { sessions } = await import("@panoma/video-briefs/sessions");
  const { recordTake, DESKTOP_TAKE, MOBILE_TAKE } = await import("@panoma/video-capture");
  const only = flag("take");
  let script = sessions.find((s) => s.name === name);
  let outDir = join(ROOT, "media", "source", "sessions");
  let head: string | undefined;
  let denySelectors: string[] | undefined;
  let server: { stop(): Promise<void> } | undefined;
  const projectId = flag("project") ?? process.env.PANOMA_VIDEO_PROJECT;
  /*
    The take names are checked before anything is started. `process.exit` does not run
    a `finally`, so a typo in `--take` used to leave the dev server this command had
    just launched holding its port with no parent.
  */
  const known = [DESKTOP_TAKE, MOBILE_TAKE, ...(script?.takes ?? [])].map((t) => t.id);
  if (only && !known.includes(only)) {
    console.error(`No take named "${only}". Takes: ${[...new Set(known)].join(", ")}`);
    process.exit(1);
  }
  /* A tour written by `panoma-video tour` or `panoma-video auto` is a session too, in its workspace. */
  if (!script && projectId && name) {
    const { videoHome, readJson, listFiles, stepsOnOrigin } = await import("@panoma/video-director");
    const dir = join(videoHome(), "projects", projectId);
    const tour = await readJson<{ url: string; steps: import("@panoma/video-capture").SessionStep[]; denySelectors?: string[] }>(join(dir, "tours", `${name}.json`));
    if (tour) {
      /* Direct replay replaces evidence too. The automatic path owns validation
         and archiving of an approved story; this shortcut must not bypass it. */
      if ((await listFiles(join(dir, "promo-revisions"), ".json")).length > 0) {
        throw new Error("This project has saved scene revisions. Recording would replace their evidence; use panoma-video auto <project-path> --new-story to capture a replacement and archive the old story, or --no-camera to keep editing the saved footage.");
      }
      denySelectors = tour.denySelectors;
      /* The same rules the automatic path applies: the live address, every click optional on tape, the product's own scheme. */
      const brand = await readJson<{ scheme?: { default?: "light" | "dark" } }>(join(dir, "brand.json"));
      const resolved = await originForReplay(dir, tour, name);
      server = resolved.server;
      head = resolved.head;
      const onOrigin = (raw: string) => new URL(new URL(raw).pathname + new URL(raw).search + new URL(raw).hash, resolved.origin).href;
      const moved = resolved.forced ? tour.steps.map((s) => ("goto" in s ? { ...s, goto: onOrigin(s.goto) } : s)) : stepsOnOrigin(tour.steps, resolved.origin);
      const steps = moved.map((s) => ("clickOn" in s || "scrollTo" in s ? { ...s, optional: true } : s));
      script = { name, takes: [DESKTOP_TAKE, MOBILE_TAKE], steps, colorScheme: brand?.scheme?.default ?? "dark" };
      outDir = join(dir, "sessions");
      /*
        These takes replace the ones `panoma-video auto` cached, and its key file vouches for
        the old bytes. Left in place, the next run reports the record stage "cached"
        over footage that key never described.
      */
      await rm(join(outDir, `${name}.key`), { force: true });
      console.log(`· replaying "${name}" on ${resolved.origin} · steps in the script: ${steps.length}`);
    }
  }
  if (!script) {
    console.error(`panoma-video record <session> — sessions: ${sessions.map((s) => s.name).join(", ") || "(none)"}; or a tour name with --project=<id> [--url=<origin>]`);
    process.exit(1);
  }
  const takes = script.takes.filter((t) => !only || t.id === only);
  try {
    for (const take of takes) {
      const log = await recordTake({
        name: script.name,
        take,
        steps: take.steps ?? script.steps,
        colorScheme: script.colorScheme,
        ...(denySelectors?.length ? { denySelectors } : {}),
        outDir,
        ...(head ? { head } : {}),
      });
      console.log(
        `· ${log.video} — ${log.viewport.width}x${log.viewport.height}${log.isMobile ? " mobile" : ""}` +
          ` · duration ${(log.durationMs / 1000).toFixed(1)}s · events logged: ${log.events.length}` +
          (log.marks.length > 0 ? ` · marks: ${log.marks.map((m) => m.name).join(", ")}` : ""),
      );
      /*
        Every click a tour replays is optional, because a control the desktop take has
        may be behind a menu on the phone — which also means a take against a page
        that is not the product at all skips every one of them and still writes a file.
        A script that asks for clicks and lands none is that case, and it is worth a
        line here rather than a puzzling render three stages later.
      */
      const asked = (take.steps ?? script.steps).filter((s) => "clickOn" in s || "click" in s).length;
      const landed = log.events.filter((e) => e.kind === "click").length;
      if (asked > 0 && landed === 0) {
        console.error(`  no click in the script found its control — check that this address is serving the product the tour was walked on; clicks the script asked for: ${asked}`);
      }
    }
  } finally {
    await server?.stop();
  }

  /*
    Takes may bring their own steps, so they may disagree about their marks — and a
    tutorial pinned to a mark that only the desktop take has renders in 16:9 and
    fails in 9:16, which is discovered at the end of a launch. Say it here, where
    the fix is one line of the script.
  */
  const { markMismatch, takesOf } = await import("./tutorial.ts");
  const mismatch = markMismatch(await takesOf(outDir, script.name));
  if (mismatch) {
    console.error(`\nThe takes of "${script.name}" do not carry the same marks:\n${mismatch}`);
    console.error(`A tutorial can only be pinned to marks every take has.`);
  }
}

/*
  The whole thing with nothing but a path: panoma video decides what to teach.

  It reads the product, scores every screen it reached on what it could measure, has the
  brain name the rows and pick one, and films that — so the first thing a person has to
  know about it is not how to ask it. `--slate` stops after the menu, which is the
  honest way to disagree with the pick.
*/
async function cmdTutorialAuto() {
  const root = rest.find((a) => !a.startsWith("--")) ?? process.cwd();
  const { auto } = await import("@panoma/video-director");
  const started = Date.now();
  const report = await auto({
    root,
    teach: true,
    goal: "tutorial",
    langs: flag("langs")?.split(",") as ("en" | "es")[] | undefined,
    until: rest.includes("--slate") ? "plan" : ((flag("until") as "study" | "plan" | "preview" | "final" | undefined) ?? "final"),
    force: rest.includes("--force"),
    voice: flag("voice"),
    url: flag("url"),
    projectId: flag("project"),
    previewFormat: flag("format") as "v" | "h" | "s" | undefined,
    brain: flag("brain") as import("@panoma/video-brain").BrainChoice | undefined,
    music: musicFlag(),
    dance: flag("dance") as "off" | "light" | "full" | undefined,
    ...(rest.includes("--no-camera") ? { camera: false } : {}),
    onProgress: (s, m, done, total) => console.log(`  ${s}: ${m}${total ? ` (${done}/${total})` : ""}`),
  });
  console.log(`\n${report.project.name} (${report.project.kind}) — ${report.project.dir}`);
  if (report.lesson) console.log(`\n${report.lesson.summary}\n`);
  for (const [name, s] of Object.entries(report.stages)) console.log(`  ${name.padEnd(7)} ${s.status.padEnd(8)} ${s.summary}`);
  if (report.brain) console.log(`  brain: ${report.brain.driver}${report.brain.model ? ` (${report.brain.model})` : ""} · from cache: ${report.brain.cached} · questions asked: ${report.brain.calls}`);
  for (const r of report.renders) console.log(`  ${r.id} · ${r.seconds.toFixed(1)} s${r.lufs !== undefined ? ` · ${r.lufs.toFixed(1)} LUFS` : ""} · review ${r.review.status}\n    ${r.file}${r.sheet ? `\n    ${r.sheet}` : ""}`);
  console.log(`\nreport: ${report.files.auto} · minutes: ${((Date.now() - started) / 60000).toFixed(1)}`);
  if (Object.values(report.stages).some((s) => s.status === "failed") || report.renders.some((r) => r.review.status === "fail")) process.exitCode = 1;
}

async function cmdScaffold() {
  const name = rest.find((a) => !a.startsWith("--"));
  const { sessions } = await import("@panoma/video-briefs/sessions");
  if (!name) {
    console.error(`panoma-video scaffold <session> — sessions: ${sessions.map((s) => s.name).join(", ") || "(none)"}`);
    process.exit(1);
  }
  const { scaffoldTutorial } = await import("./tutorial.ts");
  const langs = (flag("langs") ?? "en,es").split(",");
  const { path, marks } = await scaffoldTutorial({
    name,
    sessionsDir: join(ROOT, "media", "source", "sessions"),
    outDir: join(ROOT, "briefs", "drafts"),
    langs,
    today: new Date().toISOString().slice(0, 10),
  });
  console.log(`· ${path}`);
  console.log(`\nSteps scaffolded from the marks: ${marks.join(" → ")}`);
  console.log(`Write the sentences, then move the brief into briefs/index.ts.`);
}

async function cmdSfx() {
  const { makeSfx } = await import("@panoma/video-audio");
  const written = await makeSfx(join(ROOT, "media", "source", "sfx"));
  for (const path of written) console.log(`· ${path}`);
  console.log(`\neffects written: ${written.length}. Product interactions sound on their visible action frames.`);
}

async function cmdIdeate() {
  const { ideate } = await import("./ideate.ts");
  const repo = flag("repo") ?? process.cwd();
  const days = Number(flag("days") ?? 30);
  const result = await ideate({ repo, days, ai: rest.includes("--ai"), outDir: join(ROOT, "briefs", "drafts") });
  console.log(result);
}

async function cmdAssets() {
  const id = rest.find((a) => !a.startsWith("--"));
  const brief = briefs.find((b) => b.id === id);
  if (!brief) {
    console.error(`No brief named "${id}". Briefs: ${briefs.map((b) => b.id).join(", ")}`);
    process.exit(1);
  }
  await makeAssets(brief, join(ROOT, "media"));
}

async function cmdMaster() {
  const file = rest[0];
  if (!file) {
    console.error("panoma-video master <file.mp4>");
    process.exit(1);
  }
  console.log(`before: ${await loudness(file)} LUFS`);
  await master(file);
  console.log(`after:  ${await loudness(file)} LUFS`);
}

async function cmdBpms() {
  const fps = Number(rest[0] ?? 30);
  console.log(`Tempos with whole-frame beats at ${fps} fps: ${integerBpms(fps).join(", ")}`);
}


async function cmdScout() {
  const root = rest.find((a) => !a.startsWith("--")) ?? process.cwd();
  const { scoutProject } = await import("@panoma/video-scout");
  const { openWorkspace, videoHome, writeJson } = await import("@panoma/video-director");
  const profile = await scoutProject(root, { days: Number(flag("days") ?? 30) });
  const ws = await openWorkspace(profile.root, { id: profile.id });
  const { facts, ...rest_ } = profile;
  await writeJson(ws.paths.profile, rest_);
  await writeJson(ws.paths.facts, facts);
  if (rest.includes("--json")) {
    console.log(JSON.stringify(profile, null, 2));
    return;
  }
  console.log(`${profile.name} · ${profile.kind}${profile.framework ? ` · ${profile.framework.name}` : ""}${profile.start ? ` · ${profile.start.command} ${profile.start.args.join(" ")}` : ""}`);
  console.log(`routes: ${profile.routes.length} · facts: ${facts.facts.length} · not facts: ${facts.notFacts.length}`);
  for (const f of facts.facts.slice(0, 12)) console.log(`  ${f.id} = ${JSON.stringify(f.value)}  (${f.source})`);
  if (facts.facts.length > 12) console.log(`  … and more in facts.json: ${facts.facts.length - 12}`);
  console.log(`\n${ws.dir}`);
}

async function cmdTour() {
  const target = rest.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error("panoma-video tour <url|path> [--name=id] [--steps=12] [--ctas=2] [--pages=12] [--light]");
    process.exit(1);
  }
  const { writeTour, tourSummary } = await import("@panoma/video-tour");
  const { openWorkspace, videoHome, writeJson } = await import("@panoma/video-director");
  let url = target;
  let ws: Awaited<ReturnType<typeof openWorkspace>> | undefined;
  let server: { url: string; stop(): Promise<void>; log(): string } | undefined;
  if (!/^https?:\/\//.test(target)) {
    const { scoutProject, startServer } = await import("@panoma/video-scout");
    const profile = await scoutProject(target);
    ws = await openWorkspace(profile.root, { id: profile.id });
    /*
      The workspace records the project it was made for — `panoma-video auto` writes this and
      everything downstream reads it. A tour-only workspace that skipped it could not
      be replayed later: `panoma-video record` had no way to learn which product to serve.
    */
    await writeJson(ws.paths.profile, profile);
    if (profile.start) {
      server = await startServer(profile, { timeoutMs: 90_000, runtimeBase: join(videoHome(), "runtimes") });
      url = server.url;
    } else if (profile.url) {
      url = profile.url;
    } else {
      console.error(`${profile.name} has no start command and no deployed address; pass a URL.`);
      process.exit(1);
    }
  }
  try {
    const name = flag("name") ?? ws?.id ?? new URL(url).hostname.replace(/\W+/g, "-");
    const budget = { ...(flag("steps") ? { steps: Number(flag("steps")) } : {}), ...(flag("ctas") ? { ctas: Number(flag("ctas")) } : {}), ...(flag("pages") ? { pages: Number(flag("pages")) } : {}) };
    const script = await writeTour({ url, name, budget, colorScheme: rest.includes("--light") ? "light" : "dark" });
    const dir = ws ? ws.paths.tours : join(ROOT, "media", "source", "tours");
    await mkdir(dir, { recursive: true });
    await writeJson(join(dir, `${name}.json`), script);
    await writeJson(join(dir, `${name}.flow.json`), script.flow);
    console.log(tourSummary(script));
    console.log(`\ntour written: ${join(dir, `${name}.json`)}${ws ? `\nrecord it: panoma-video record ${name} --project=${ws.id}` : ""}`);
  } finally {
    await server?.stop();
  }
}

async function cmdBrand() {
  const root = rest.find((a) => !a.startsWith("--")) ?? process.cwd();
  const { extractBrand } = await import("@panoma/video-brand");
  const { scoutProject } = await import("@panoma/video-scout");
  const { openWorkspace, videoHome, writeJson } = await import("@panoma/video-director");
  const profile = await scoutProject(root);
  const ws = await openWorkspace(profile.root, { id: profile.id });
  const url = flag("url") ?? profile.url;
  const brand = await extractBrand({ root: profile.root, ...(url ? { url } : {}), outDir: ws.dir });
  await writeJson(ws.paths.brand, brand);
  console.log(`primary ${brand.colors.primary.hex} (${brand.colors.primary.confidence}, ${brand.colors.primary.origin}) · accent ${brand.colors.accent.hex} · scheme ${brand.scheme.default} · type ${brand.type.heading.family}/${brand.type.body.family} · tone ${brand.tone.register}${brand.logo ? ` · logo ${brand.logo.kind}` : ""}`);
  console.log(ws.paths.brand);
}

async function cmdReview() {
  const file = rest.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("panoma-video review <file.mp4> [--targets=youtube,x] [--cuts=1.0,2.5] [--holds=12.4-15.1] [--recipe=Tutorial] [--silent] [--detailed] [--json]");
    process.exit(1);
  }
  const { reviewVideo, reportText } = await import("@panoma/video-review");
  const { reviewExportFile, writeReviewReport } = await import("../../../packages/director/src/export-review.ts");
  const options = {
    targets: flag("targets")?.split(","),
    plannedCuts: flag("cuts")?.split(",").map(Number),
    declaredHolds: flag("holds")?.split(",").map((h) => {
      const [from, to] = h.split("-").map(Number);
      return { from, to };
    }),
    recipe: flag("recipe"),
    expectSilent: rest.includes("--silent") ? true : undefined,
  };
  const report = await reviewExportFile(file, options) ?? await reviewVideo(file, options);
  await writeReviewReport(file, report);
  console.log(rest.includes("--json") ? JSON.stringify(report) : reportText(report, rest.includes("--detailed") ? "detailed" : "concise"));
  process.exitCode = report.status === "fail" ? 1 : 0;
}

async function cmdFrame() {
  const [file, seconds] = rest.filter((a) => !a.startsWith("--"));
  if (!file || seconds === undefined) {
    console.error("panoma-video frame <file.mp4> <seconds> [--out=frame.jpg]");
    process.exit(1);
  }
  const { frameAt } = await import("@panoma/video-review");
  const pic = await frameAt(file, Number(seconds), { out: flag("out") ?? file.replace(/\.(mp4|mov|webm)$/, `.frame-${Number(seconds).toFixed(2)}.jpg`) });
  console.log(`${pic.file} · ${pic.width} px · bytes: ${pic.bytes}`);
}

async function cmdMusic() {
  const { writeBed } = await import("@panoma/video-audio");
  const { existsSync } = await import("node:fs");
  const { compositions, beds } = await stage();
  const only = rest.find((a) => !a.startsWith("--"));
  let written = 0;
  for (const comp of compositions) {
    const bed = beds.get(comp.id);
    if (!bed || (only && !comp.id.startsWith(`${only}--`))) continue;
    if (existsSync(bed.path)) continue;
    await mkdir(join(bed.path, ".."), { recursive: true });
    writeBed(bed.opts, bed.path);
    console.log(`· ${bed.path}`);
    written++;
  }
  console.log(`\nbeds written: ${written}. No key, no plan, no rights to clear.`);
}

/*
  Everything the studio holds for a product, and what it lacks — before a single piece is
  planned. It is `auto --until=study`: the same stages, stopping where the material has
  been assembled and nothing has been decided about it yet.
*/
async function cmdStudy() {
  const root = rest.find((a) => !a.startsWith("--")) ?? process.cwd();
  const { auto, readStudy, openWorkspace, videoHome } = await import("@panoma/video-director");
  const report = await auto({
    root,
    until: "study",
    force: rest.includes("--force"),
    url: flag("url"),
    projectId: flag("project"),
    brain: (flag("brain") as import("@panoma/video-brain").BrainChoice | undefined) ?? "none",
    onProgress: (s, m) => console.log(`  ${s}: ${m}`),
  });
  const ws = await openWorkspace(report.project.root, { id: report.project.id });
  const study = await readStudy(ws);
  console.log(`\n${report.project.name} (${report.project.kind}) — ${ws.dir}`);
  if (!study) {
    console.log("  nothing was assembled; the stages above say why.");
    return;
  }
  const d = study.direction;
  console.log(`  look     ${d.name} · ${d.scheme} · ${d.signal} · stage ${d.stage} · accent ${d.accent}`);
  for (const t of study.takes) console.log(`  take     ${t.take.padEnd(8)} screens: ${t.frames} · components: ${t.elements} · controls: ${t.macros}`);
  console.log(`  material ${study.material.filter((m) => m.shots.length > 0).length} of ${study.material.length} marks can carry a shot`);
  for (const m of study.material) console.log(`     ${m.mark.padEnd(12)} ${m.shots.join(" · ") || "nothing"}`);
  if (study.map) console.log(`  map      screens: ${study.map.screens} · filmed: ${study.map.filmed} · the film does not show: ${study.map.unfilmed}`);
  if (study.gaps.length === 0) console.log("  missing  nothing");
  for (const g of study.gaps) console.log(`  missing  [${g.by}] ${g.summary} ${g.hint}`);
  console.log(`\n  open it: ${join(ws.dir, "study", "book.html")}`);
  void videoHome;
}

async function cmdThemes() {
  const { PROMO_THEMES } = await import("@panoma/video-director");
  console.log("panoma video editorial themes — one theme per whole promotion. Themes style added graphics; Grid also adds a faint static film lattice.\n");
  for (const theme of PROMO_THEMES) console.log(`  ${theme.name} (${theme.id}${theme.id === "flat" ? "; alias: normal; default" : ""})\n    ${theme.purpose}\n    Motion: ${theme.motion}\n`);
  console.log("Choose with --theme=normal|flat|vibrant|block|grid. Named choices persist for that project; Normal / Flat is the default.\nUse --theme=auto to explicitly let the director choose for this run. Automatic choices do not enable expressive themes on later planning runs that omit the option.\nThe recording keeps the app's real appearance. Themes never mix between sections or follow music changes.");
}

async function cmdAuto() {
  const themeFlags = rest.filter((arg) => arg === "--theme" || arg.startsWith("--theme="));
  if (themeFlags.length > 1 || themeFlags[0] === "--theme") throw new Error("Use exactly one --theme=normal|flat|vibrant|block|grid|auto for the entire promotion.");
  const root = rest.find((a) => !a.startsWith("--")) ?? process.cwd();
  const { auto } = await import("@panoma/video-director");
  const started = Date.now();
  const only = flag("only");
  const report = await auto({
    root,
    goal: command === "promo" ? "promo" : (flag("goal") as import("@panoma/video-director").AutoGoal | undefined) ?? "all",
    langs: flag("langs")?.split(",") as ("en" | "es")[] | undefined,
    until: (flag("until") as "study" | "plan" | "preview" | "final" | undefined) ?? "preview",
    force: rest.includes("--force"),
    voice: flag("voice"),
    url: flag("url"),
    projectId: flag("project"),
    previewFormat: (flag("format") ?? (command === "promo" ? "v" : undefined)) as "v" | "h" | "s" | undefined,
    brain: flag("brain") as import("@panoma/video-brain").BrainChoice | undefined,
    music: musicFlag(),
    creative: flag("creative"),
    newStory: rest.includes("--new-story"),
    theme: themeFlags[0]?.slice("--theme=".length) as import("@panoma/video-director").PromoThemeRequest | undefined,
    dance: flag("dance") as "off" | "light" | "full" | undefined,
    /*
      Re-grade from the takes on disk without starting the product again. The colour, the
      cut and the words all changed several times a day while the studio was being built,
      and every one of those runs started someone else's dev server to shoot frames that
      were already recorded.
    */
    ...(rest.includes("--no-camera") ? { camera: false } : {}),
    ...(only ? { only: { brief: only, hook: flag("hook"), lang: flag("lang") } } : {}),
    onProgress: (s, m, done, total) => console.log(`  ${s}: ${m}${total ? ` (${done}/${total})` : ""}`),
  });
  console.log(`\n${report.project.name} (${report.project.kind}) — ${report.project.dir}`);
  for (const [name, s] of Object.entries(report.stages)) console.log(`  ${name.padEnd(7)} ${s.status.padEnd(8)} ${s.summary}${s.next ? `\n          next: ${s.next.tool} ${JSON.stringify(s.next.args)}` : ""}`);
  if (report.brain) {
    console.log(`  brain: ${report.brain.driver}${report.brain.model ? ` (${report.brain.model})` : ""} · from cache: ${report.brain.cached} · questions asked: ${report.brain.calls}`);
    for (const d of report.brain.decisions) console.log(`    · ${d}`);
  }
  if (report.skipped.length > 0) for (const s of report.skipped) console.log(`  skipped ${s.goal}: ${s.why}`);
  for (const r of report.renders) console.log(`  ${r.id} · ${r.seconds.toFixed(1)} s${r.lufs !== undefined ? ` · ${r.lufs.toFixed(1)} LUFS` : ""} · review ${r.review.status}${r.review.failing.length > 0 ? ` (${r.review.failing.map((c) => `${c.id} → ${c.fix?.by}`).join(", ")})` : ""}\n    ${r.file}${r.sheet ? `\n    ${r.sheet}` : ""}`);
  if (report.disclose.length > 0) console.log(`  disclose (synthetic voice or music): ${report.disclose.join(", ")}`);
  console.log(`\nreport: ${report.files.auto} · minutes: ${((Date.now() - started) / 60000).toFixed(1)}`);
  if (Object.values(report.stages).some((s) => s.status === "failed") || report.renders.some((r) => r.review.status === "fail")) process.exitCode = 1;
}

/*
  What the brain thinks this product is, on its own: the first question of `panoma-video auto`,
  answered and printed, so a person can see the angle before a frame is shot — and
  change the brain, the model or the facts if it read the product wrong.
*/
/*
  A tutorial about one thing, asked for in words.

  `panoma-video auto` films what a product IS. This films how to do something in it: the same
  pipeline, with the walk replaced by a reading and a route, and with only the tutorial
  planned. The request is the first argument and it may be written in any language — it
  is read by a brain that has just read the product, not matched against a lexicon.
*/
async function cmdTeach() {
  const args = rest.filter((a) => !a.startsWith("--"));
  const about = args[0];
  const root = args[1] ?? process.cwd();
  if (!about) {
    console.error('panoma-video teach "<what to teach>" <path> [--url=…] [--langs=en] [--brain=…] [--voice=none] [--until=plan] [--music=<file> --dance=off|light|full]');
    process.exit(1);
  }
  const { auto } = await import("@panoma/video-director");
  const started = Date.now();
  const report = await auto({
    root,
    about,
    goal: "tutorial",
    langs: flag("langs")?.split(",") as ("en" | "es")[] | undefined,
    until: (flag("until") as "study" | "plan" | "preview" | "final" | undefined) ?? "final",
    force: rest.includes("--force"),
    voice: flag("voice"),
    url: flag("url"),
    projectId: flag("project"),
    previewFormat: flag("format") as "v" | "h" | "s" | undefined,
    brain: flag("brain") as import("@panoma/video-brain").BrainChoice | undefined,
    music: musicFlag(),
    dance: flag("dance") as "off" | "light" | "full" | undefined,
    ...(rest.includes("--no-camera") ? { camera: false } : {}),
    onProgress: (s, m, done, total) => console.log(`  ${s}: ${m}${total ? ` (${done}/${total})` : ""}`),
  });
  console.log(`\n${report.project.name} (${report.project.kind}) — ${report.project.dir}`);
  if (report.lesson) console.log(`\n${report.lesson.summary}\n`);
  for (const [name, s] of Object.entries(report.stages)) console.log(`  ${name.padEnd(7)} ${s.status.padEnd(8)} ${s.summary}`);
  if (report.brain) console.log(`  brain: ${report.brain.driver}${report.brain.model ? ` (${report.brain.model})` : ""} · from cache: ${report.brain.cached} · questions asked: ${report.brain.calls}`);
  if (report.skipped.length > 0) for (const s of report.skipped) console.log(`  skipped ${s.goal}: ${s.why}`);
  for (const r of report.renders) console.log(`  ${r.id} · ${r.seconds.toFixed(1)} s${r.lufs !== undefined ? ` · ${r.lufs.toFixed(1)} LUFS` : ""} · review ${r.review.status}${r.review.failing.length > 0 ? ` (${r.review.failing.map((c) => `${c.id} → ${c.fix?.by}`).join(", ")})` : ""}\n    ${r.file}${r.sheet ? `\n    ${r.sheet}` : ""}`);
  console.log(`\nreport: ${report.files.auto} · minutes: ${((Date.now() - started) / 60000).toFixed(1)}`);
  if (Object.values(report.stages).some((s) => s.status === "failed") || report.renders.some((r) => r.review.status === "fail")) process.exitCode = 1;
}

/*
  The storyboard: a film drawn before any of it is bought.

  It runs in two halves on purpose. Without `--generate` it costs nothing at all — it reads
  the project, lays the take's own frames out as PANELS, prices what those panels would cost
  to animate, writes a CONTACT SHEET you can look at, and renders an ANIMATIC: the real
  shots, the real cards, the real narration, and every unbought move standing still on the
  exact frame the model would have been conditioned on. That is what an animatic has always
  been for, and it is the only honest way to find out a shot is wrong before it costs money.

  With `--generate` the held panels become clips and nothing else changes.
*/
/*
  The element library: matter, bought once, used by every film after it.

  This is the one thing generation sells that a product film should buy, and the reason it
  is a LIBRARY rather than a stage of a render is the whole economics of it. An element is
  text-to-video, so it escapes the eight seconds a conditioning frame forces — four seconds,
  forty cents. And it refers to no product, so a shattering bought for one film is the same
  shattering for the next. Four elements is under two dollars, once, for good.

  Buy → crush → measure → keep. The measure is not a formality: the first element bought here
  LOOKED black in every frame and was 12% true black, which composited would have lifted the
  whole interface. Crushing moved it to 67% and it passed. One that still does not pass is
  named and deleted rather than kept and used.
*/
async function cmdElements() {
  const { LIBRARY, elementPrompt, elementNegative, elementFile, groundFor, blendFor } = await import("@panoma/video-gen");
  const { generatorFor } = await import("@panoma/video-gen");
  const { groundOf, crushGround } = await import("@panoma/video-review");
  const { mkdir, writeFile, rm } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  const { videoHome } = await import("@panoma/video-director");

  const provider = (flag("provider") ?? "veo") as import("@panoma/video-gen").ProviderName;
  const scheme = (flag("scheme") ?? "light") as "light" | "dark";
  const ground = groundFor(scheme);
  const dir = join(videoHome(), "elements");
  await mkdir(dir, { recursive: true });
  const only = flag("only");
  const wanted = LIBRARY.filter((e) => !only || e.id === only);

  console.log(`\n  a ${scheme} film wants elements on ${ground}, blended with ${blendFor(ground)}`);
  console.log(`  ${dir}\n`);

  const generator = generatorFor(provider, flag("model"));
  let spent = 0;
  for (const base of wanted) {
    const el = { ...base, ground };
    const kept = join(dir, elementFile(el.id, ground));
    if (existsSync(kept)) {
      const check = await groundOf(kept, ground);
      console.log(`  ${el.id.padEnd(14)} on disk · ${check.say}`);
      continue;
    }
    const prompt = elementPrompt(el);
    console.log(`  ${el.id.padEnd(14)} buying ${el.seconds}s — ${el.why}`);
    let clip;
    try {
      clip = await generator.make({ prompt, seconds: el.seconds, aspect: "16:9", ...(generator.can.negative ? { negative: elementNegative(el) } : {}) });
    } catch (e) {
      console.log(`  ${" ".repeat(14)} not bought: ${(e as Error).message.replace(/\s+/g, " ").slice(0, 160)}`);
      continue;
    }
    spent += clip.cost;
    const raw = join(dir, `${el.id}-${ground}.raw.mp4`);
    await writeFile(raw, clip.bytes);
    const before = await groundOf(raw, ground);
    await crushGround(raw, kept, ground);
    const after = await groundOf(kept, ground);
    console.log(`  ${" ".repeat(14)} $${clip.cost.toFixed(2)} · ${(before.flat * 100).toFixed(0)}% → ${(after.flat * 100).toFixed(0)}% ${ground} after crushing`);
    if (!after.ok) {
      await rm(kept, { force: true });
      console.log(`  ${" ".repeat(14)} REFUSED: ${after.say}`);
    }
    await rm(raw, { force: true });
  }
  console.log(`\n  $${spent.toFixed(2)} committed. Every film from here uses these for nothing.\n`);
}

async function cmdStoryboard() {
  const root = rest.find((a) => !a.startsWith("--")) ?? process.cwd();
  const lang = flag("lang") ?? "en";
  const formatId = (flag("format") ?? "h") as "h" | "v" | "s";
  const provider = (flag("provider") ?? "veo") as import("@panoma/video-gen").ProviderName;
  /* How many product beats are bought as camera moves. Zero is a board that spends nothing. */
  /*
    Zero by default, because generative video is PARKED. See docs/storyboard.md: it was
    built, measured and set down, and a default that quietly buys eight seconds of clip is
    not a parked feature. Somebody has to type a number.
  */
  const moves = Number(flag("moves") ?? 0);

  const { scoutProject } = await import("@panoma/video-scout");
  const { openWorkspace, readJson, writeJson, listFiles, parseBrief, directionOf, boardOf, contactSheet, shootBoard, BUY_SECONDS } = await import("@panoma/video-director");
  const { renderBrand } = await import("@panoma/video-brand");
  const { expandBrief, FORMATS } = await import("@panoma/video-core");
  type FactSheet = import("@panoma/video-core").FactSheet;
  const { capabilityOf, generatorFor, priceOf, boardText, commissioned, PROVIDERS, PROVIDER_KEYS } = await import("@panoma/video-gen");

  const profile = await scoutProject(root);
  const ws = await openWorkspace(profile.root, { id: profile.id });
  const facts = await readJson<FactSheet>(ws.paths.facts);
  const brandProfile = await readJson<Parameters<typeof renderBrand>[0]>(ws.paths.brand);
  if (!facts || !brandProfile) {
    console.error(`No workspace for ${profile.name} yet. Run: panoma-video tutorial ${root} --url=…`);
    process.exit(1);
  }
  /*
    A workspace may still hold a brief an older run planned, whose sentences reference facts
    the current sheet no longer has. `panoma-video auto` prunes those now, but a workspace written
    before it did still carries them, and a board is not the place to discover it.
  */
  const candidates: { file: string; brief: import("@panoma/video-core").Brief }[] = [];
  const unusable: string[] = [];
  for (const file of await listFiles(join(ws.dir, "briefs"), ".json")) {
    if (file.endsWith(".patch.json") || file.endsWith(".brain.json")) continue;
    const raw = await readJson<Record<string, unknown>>(file);
    if (!raw) continue;
    const { origin: _o, goal: _g, ...restBrief } = raw;
    void _o;
    void _g;
    try {
      candidates.push({ file, brief: expandBrief(parseBrief(restBrief), facts) });
    } catch (e) {
      unusable.push(`${basename(file)}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  for (const why of unusable) console.log(`  skipped a brief an older run left behind — ${why}`);
  const picked = candidates.find((c) => c.brief.recipe === "Tutorial") ?? candidates[0];
  if (!picked) {
    console.error(`No usable brief in ${ws.dir}. Run: panoma-video tutorial ${root} --url=… first, so the board has a film to be about.`);
    process.exit(1);
  }
  const brief = picked.brief;

  /*
    The take whose frames ARE the panels. Without one there is nothing to board: a
    storyboard here is not drawn, it is the product photographed at every mark.
  */
  const takeFile = (await listFiles(ws.paths.sessions, ".session.json")).find((f) => f.includes(formatId === "v" ? ".mobile." : ".desktop."));
  const take = takeFile ? await readJson<import("@panoma/video-capture").SessionLog>(takeFile) : null;
  if (!take) {
    console.error(`No recording for ${formatId} in ${ws.paths.sessions}. Run: panoma-video tutorial ${root} --url=… first.`);
    process.exit(1);
  }

  const tourFile = (await listFiles(ws.paths.tours, ".json")).find((f) => !f.endsWith(".flow.json") && !f.endsWith(".lesson.json"));
  const tour = tourFile ? await readJson<Parameters<typeof directionOf>[1]>(join(ws.paths.tours, tourFile)) : null;
  const { withHouseTheme } = await import("@panoma/video-brand/direction");
  const chosenDirection = (await readJson<{ direction: ReturnType<typeof directionOf> }>(ws.paths.direction))?.direction;
  const direction = chosenDirection ? withHouseTheme(chosenDirection) : directionOf(brandProfile, tour);
  const premise = ((tour as { goal?: string } | null)?.goal ?? brief.hooks[0]?.text[lang] ?? profile.name) as string;

  const board = await boardOf({
    id: `${brief.id}-board`,
    project: profile.name,
    brief,
    lang,
    format: formatId,
    direction,
    take,
    takeDir: ws.paths.sessions,
    premise,
    ...(brandProfile.tone?.register ? { tone: brandProfile.tone.register } : {}),
    ...(flag("mode") ? { mode: flag("mode") as "pitch" | "shooting" } : {}),
    moves,
    ...(flag("look") ? { energy: flag("look") as "kinetic" | "calm" } : {}),
  }).catch((e: Error) => {
    console.error(`\n${e.message}\n`);
    process.exit(1);
  });

  const file = join(ws.dir, `${board.id}.json`);
  await writeJson(file, board);
  console.log(`\n${boardText(board)}\n`);

  const sheetHtml = join(ws.dir, `${board.id}.board.html`);
  const sheetPng = join(ws.dir, `${board.id}.board.png`);

  /* What it would cost, everywhere, before anybody says yes. */
  const buys = commissioned(board);
  const seconds = buys.map((s) => s.gen!.seconds);
  if (buys.length > 0) {
    console.log("");
    for (const name of PROVIDERS) {
      const can = capabilityOf(name);
      const { dollars } = priceOf(seconds, can, { conditioned: true });
      const has = process.env[PROVIDER_KEYS[name]] ? "" : ` · no ${PROVIDER_KEYS[name]} on this machine`;
      const aspect = formatId === "v" ? "9:16" : formatId === "s" ? "1:1" : "16:9";
      const fits = can.aspects.includes(aspect as never) ? "" : ` · CANNOT make ${aspect}`;
      const ends = can.lastFrame ? "" : " · no last frame, so only the opening of each move is true";
      console.log(`  ${name.padEnd(9)} $${dollars.toFixed(2)}${can.perSecond === 0 ? " (no published rate)" : ""}${fits}${ends}${has}`);
    }
  }

  let clips: Record<number, string> | undefined;
  if (rest.includes("--generate") && buys.length > 0) {
    const generator = generatorFor(provider, flag("model"));
    const result = await shootBoard(board, generator, join(ws.dir, "generated", board.id), {
      ...(flag("cap") ? { cap: Number(flag("cap")) } : {}),
      onProgress: (m, done, total) => console.log(`  shooting (${done + 1}/${total}) ${m}`),
    });
    console.log(`\n  ${result.status}: ${result.summary}`);
    for (const m of result.measured) console.log(`    ${m}`);
    for (const t of result.takes) {
      for (const i of t.ignored) console.log(`    shot ${t.n}: ${i}`);
      if (t.verdict !== "kept") console.log(`    shot ${t.n} ${t.verdict}: ${t.why ?? ""}`);
    }
    /* Written back onto the board, which is a ledger of what was tried and not a wish. */
    for (const shot of board.shots) {
      const mine = result.takes.filter((t) => t.n === shot.n);
      if (mine.length > 0) shot.takes = mine;
    }
    await writeJson(file, board);
    clips = Object.fromEntries(Object.entries(result.kept).map(([n, f]) => [Number(n), relative(ws.dir, f)]));
  } else if (buys.length > 0) {
    console.log(`\n  nothing was bought: this is the animatic, and every move is holding its own first frame.`);
    console.log(`  Add --generate --provider=${provider} to commission ${buys.length} ${buys.length === 1 ? "move" : "moves"} at ${BUY_SECONDS}s each.`);
  }

  /*
    The board as a board: panels in order, with the arrows on them.

    Drawn HERE and not before the shoot, because buying a clip changes what the board says.
    The durations written before anything existed are a guess about a model's behaviour, and
    the measurement replaces them — a sheet printed on the way past would show the numbers
    the guess made and not the ones the film uses.
  */
  const sheet = await contactSheet(board, { html: sheetHtml, png: sheetPng, lang });
  console.log(`\n  contact sheet: ${sheet.png ?? sheet.html}`);

  /* And render it, either way: an animatic is a film you watch, not a file you read. */
  const format = FORMATS[formatId];
  const { boardComposition } = await import("@panoma/video-render/compositions");
  const { renderComposition } = await import("@panoma/video-engine");
  const dirs = {
    assets: ws.dir,
    sessions: ws.paths.sessions,
    generated: join(ws.dir, "generated"),
    sfx: join(ws.dir, "sfx"),
    brand: renderBrand(brandProfile, ws.dir),
    direction,
  };
  /* The animatic stands on the panels themselves, addressed relative to the assets mount. */
  const panels = Object.fromEntries(
    board.shots
      .filter((s) => s.origin === "generated")
      .map((s) => [s.n, s.panels.find((p) => p.at === "first")?.still?.file])
      .filter((e): e is [number, string] => typeof e[1] === "string")
      .map(([n, f]) => [n, relative(ws.dir, f)]),
  );
  const { composition } = boardComposition({ board, brief, lang, format, dirs, ...(clips ? { clips } : {}), panels });
  const out = join(ws.dir, "renders", `${composition.id}.mp4`);
  await mkdir(dirname(out), { recursive: true });
  console.log(`\n  rendering ${composition.id} (${(composition.durationInFrames / composition.fps).toFixed(1)}s)`);
  await renderComposition(composition, { out, assetsDir: dirs.assets, sessionsDir: dirs.sessions, onProgress: (done, total) => { if (done % 60 === 0) console.log(`    ${done}/${total}`); } });
  const { master } = await import("./master.ts");
  await master(out).catch(() => undefined);
  console.log(`\n  board:  ${file}\n  sheet:  ${sheet.png ?? sheet.html}\n  ${clips ? "film" : "animatic"}:  ${out}`);
}

async function cmdBrain() {
  const root = rest.find((a) => !a.startsWith("--")) ?? process.cwd();
  const { scoutProject } = await import("@panoma/video-scout");
  const { brandFromRepo, mergeBrand } = await import("@panoma/video-brand");
  const { openWorkspace, writeJson, openBrainFor, thesisFor } = await import("@panoma/video-director");
  const profile = await scoutProject(root);
  const ws = await openWorkspace(profile.root, { id: profile.id });
  const { brain, why } = await openBrainFor(ws, flag("brain") as import("@panoma/video-brain").BrainChoice | undefined);
  if (!brain) {
    console.error(`No brain: ${why}`);
    process.exit(1);
  }
  const brand = await brandFromRepo(profile.root)
    .then((b) => mergeBrand(b, {}))
    .catch(() => undefined);
  const langs = (flag("langs") ?? "en,es").split(",");
  const t = await thesisFor(brain, { profile, facts: profile.facts, brand, langs });
  await writeJson(ws.paths.brain, { driver: brain.driver, model: brain.model, how: brain.how, at: new Date().toISOString(), thesis: t.value });
  console.log(`${brain.driver}${brain.model ? ` (${brain.model})` : ""} · ${t.hit ? "from cache" : `answered in seconds: ${(t.ms / 1000).toFixed(1)}`}`);
  for (const [lang, what] of Object.entries(t.value.what)) console.log(`  ${lang}: ${what}`);
  console.log(`  angle: ${Object.entries(t.value.angle).map(([l, a]) => `${l} "${a}"`).join(" · ")}`);
  console.log(`  audience: ${t.value.audience} · tone ${t.value.tone} · interface language ${t.value.interfaceLang}`);
  console.log(`  show first: ${t.value.show.first}`);
  if (t.value.show.flows.length > 0) console.log(`  worth using: ${t.value.show.flows.join(" · ")}`);
  if (t.value.show.avoid.length > 0) console.log(`  never: ${t.value.show.avoid.join(" · ")}`);
  if (t.value.verbs.length > 0) console.log(`  verbs: ${t.value.verbs.join(", ")}`);
  console.log(`  why: ${t.value.why}`);
  console.log(`\n${ws.paths.brain}`);
}

async function cmdMcp() {
  /*
    Nothing may reach stdout but the protocol. The register hook and `.env` are already
    loaded by this file; the server imports scenes dynamically, like every command.
  */
  const { startStdio } = await import("@panoma/video-mcp");
  await startStdio();
}

async function cmdDoctor() {
  const { probeRequirements } = await import("@panoma/video-mcp");
  const requirements = await probeRequirements();
  if (rest.includes("--json")) { console.log(JSON.stringify(requirements)); return; }
  console.log(`· browser: ${requirements.browser.present ? "ready" : "missing"} · chromium · approximate MB: ${requirements.browser.approxMB}`);
  const run = promisify(execFile);
  const checks: [string, () => Promise<string>][] = [
    ["node", async () => process.version],
    ["ffmpeg", async () => (await run("ffmpeg", ["-version"])).stdout.split("\n")[0]],
    ["ELEVENLABS_API_KEY", async () => (process.env.ELEVENLABS_API_KEY ? "set" : "missing (voice off; the procedural music bed and the effects still work)")],
    /*
      A key that is set and an account that will sell are two different things, and the
      difference is where the first real generation this repository attempted stopped: the
      key was there and the answer was 429, "your prepayment credits are depleted". So the
      doctor asks the provider rather than the environment — one request that costs
      nothing, and it says which of the three this machine could actually buy a shot from
      today.
    */
    ...(await import("@panoma/video-gen").then(({ PROVIDERS, PROVIDER_KEYS, capabilityOf }) =>
      PROVIDERS.map((name): [string, () => Promise<string>] => [
        `video: ${name}`,
        async () => {
          const can = capabilityOf(name);
          const rate = can.perSecond > 0 ? `$${can.perSecond}/s` : "no published rate";
          if (!process.env[PROVIDER_KEYS[name]]) return `no ${PROVIDER_KEYS[name]} (${rate}; ${can.seconds[0]}-${can.seconds[can.seconds.length - 1]}s, ${can.aspects.join("/")})`;
          if (name === "seedance") return `key set · ${rate} · set PANOMA_VIDEO_SEEDANCE_PER_SECOND to price a board`;
          /*
            And this probe is honest about what it proved, which is less than it looks.

            Listing models is free; generating is metered, and an account with a valid key
            and no prepayment credit answers 200 here and 429 there. Saying "answering"
            would be the reassurance that cost this repository its first generation run.
          */
          const probe = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
          if (probe.status === 429) return `key set, no credit: ${((await probe.json()) as { error?: { message?: string } }).error?.message ?? "429"}`;
          if (!probe.ok) return `key set, but the API answered ${probe.status}`;
          return `key accepted · ${rate} · listing models is free, so this does not prove the account can pay for a shot — only buying one does`;
        },
      ]),
    )),
    [
      "brain",
      async () => {
        const { detectBrain } = await import("@panoma/video-brain");
        const found = await detectBrain((process.env.PANOMA_VIDEO_BRAIN as import("@panoma/video-brain").BrainChoice | undefined) ?? "auto");
        return found.driver
          ? `${found.driver.name} — ${found.how}${found.model ? ` · model ${found.model}` : ""} (PANOMA_VIDEO_BRAIN=none or --brain=none leaves the templates to it)`
          : `none — ${found.why}; the templates write every word`;
      },
    ],
  ];
  for (const [name, check] of checks) {
    try {
      console.log(`· ${name}: ${await check()}`);
    } catch (e) {
      console.log(`· ${name}: MISSING — ${(e as Error).message.split("\n")[0]}`);
    }
  }
}

const commands: Record<string, () => Promise<void>> = {
  list: cmdList,
  render: cmdRender,
  story: cmdStory,
  revise: cmdStory,
  kit: cmdKit,
  ideate: cmdIdeate,
  record: cmdRecord,
  tutorial: cmdTutorialAuto,
  scaffold: cmdScaffold,
  launch: cmdLaunch,
  sfx: cmdSfx,
  assets: cmdAssets,
  master: cmdMaster,
  bpms: cmdBpms,
  doctor: cmdDoctor,
  mcp: cmdMcp,
  scout: cmdScout,
  tour: cmdTour,
  brand: cmdBrand,
  review: cmdReview,
  frame: cmdFrame,
  music: cmdMusic,
  study: cmdStudy,
  auto: cmdAuto,
  promo: cmdAuto,
  themes: cmdThemes,
  teach: cmdTeach,
  storyboard: cmdStoryboard,
  elements: cmdElements,
  brain: cmdBrain,
};

if (!command || !commands[command]) {
  console.log(`panoma video — brief in, mastered videos out.

  panoma-video themes                        the editorial style catalog, with each theme's look and motion
  panoma-video list                          the render matrix, one id per line
  panoma-video render [brief] [--format=v,h] [--hook=id] [--lang=en]
  panoma-video launch <brief> [--lang=en] [--format=v,h] [--hook=id] [--sheet] [--force]
                                             render + master + kit every matching cut (all
                                             languages and formats unless narrowed)
  panoma-video story [brief] --project=<id>    inspect scenes, evidence and saved revisions
  panoma-video promo <path> --new-story       replace the story; preserve prior revision history
  panoma-video revise [brief] --project=<id> --revision=<id> --instruction=<request>
                                             or --edits=<JSON file>, --restore=<revision>
  panoma-video kit <brief> [--sheet]         platform copy + thumbnail (+ contact sheet)
  panoma-video ideate [--repo=.] [--days=30] [--ai]   draft briefs from a repo's git log
  panoma-video record <session> [--take=id]  drive the real product in every take (desktop + mobile)
  panoma-video record <tour> --project=<id>  replay a tour; add --url=<origin> to aim it at a server you started
  panoma-video scaffold <session> [--langs=en,es]
                                             scaffold a narrated tutorial brief from a take's marks
  panoma-video sfx                           synthesise click, scroll and key foley plus legacy edit effects
  panoma-video assets <brief>                generate voice + music through the cache
  panoma-video master <file.mp4>             normalize loudness to -14 LUFS
  panoma-video bpms [fps]                    tempos that cut on whole frames
  panoma-video doctor                        check the environment

  The automatic path — a project in, reviewed videos out (all under ~/.panoma/video):
  panoma-video study <path> [--url=…] [--force]    the studio: every asset, the map of how it
                                             works, and what is missing, before a piece is planned
  panoma-video promo <path> [--url=…] [--langs=en,es] [--format=v|h] [--brain=…] [--music=<file>]
                                             [--creative="Explain this release with text beside the app"] [--theme=normal|flat|vibrant|block|grid|auto]
                                             sell one supported benefit with real product actions,
                                             concise type and music; decisions live in promo.json
  panoma-video auto <path> [--goal=promo|trailer|spotlight|tutorial|sitetour|facts|all] [--until=study|plan|preview|final] [--langs=en,es] [--force]
                                             [--voice=<id>|none] [--url=<origin>] — film a running instance instead of starting one
                                             [--only=<brief> --format=v|h|s --hook=<id> --lang=<id>] — iterate one composition
                                             [--theme=normal|flat|vibrant|block|grid|auto] — Normal / Flat by default; expressive styles and auto require an explicit choice
                                             [--no-camera] — re-grade from the takes on disk; the product is not started
                                             [--brain=auto|none|claude|codex|anthropic|openai] — who writes the words and chooses what to press
                                             [--music=<file>] [--dance=off|light|full] — score the pieces with a track of your own: its tempo
                                             is measured, it is cut to its first downbeat and stretched at most 4.2% to the grid, every cut lands
                                             on its beats. The camera follows actions by default; --dance=light|full explicitly adds musical motion
  panoma-video tutorial <path> [--url=…] [--slate] [--langs=en] [--brain=…] [--music=<file> --dance=…]
                                             NOBODY SAYS WHAT: panoma video reads the product, scores
                                             every screen it reached, has the brain name the candidates
                                             and pick one, and films it. --slate stops at the menu.
  panoma-video teach "<what to teach>" <path> [--url=…] [--langs=en] [--brain=…] [--music=<file> --dance=…]
                                             a tutorial about ONE thing, asked for in words:
                                             panoma video reads the product, plans the route, proves
                                             every step in a browser, and films only what it proved
  panoma-video storyboard <path> [--lang=en] [--format=h] [--moves=2] [--generate]
                                             write the film down: a shot list, priced against every
                                             provider, rendered as an ANIMATIC — real product shots,
                                             real cards, real narration, a slate where each
                                             commissioned shot will go. Costs nothing.
                            [--generate --provider=veo|omni|seedance --model=… --cap=32]
                                             and then buy the shots, once each, under a cap
  panoma-video brain <path> [--brain=…]      what the brain thinks the product is: the thesis, before a frame is shot
  panoma-video scout <path> [--json]         what the project is, how it starts, its facts
  panoma-video tour <url|path> [--name=id]   walk a running product and write its recording script
  panoma-video brand <path> [--url=…]        the product's colours, logo, type and tone
  panoma-video review <file.mp4> [--detailed] the gate: black, freezes, cuts, loudness, flashing, conformance
  panoma-video frame <file.mp4> <seconds>    one frame, full width
  panoma-video music [brief]                 the procedural bed every composition without music plays
  panoma-video mcp                           serve the agent tools over stdio (see skills/panoma-video/SKILL.md)

  --project=<id> (or PANOMA_VIDEO_PROJECT) points list, render, music, kit, launch and record at a workspace instead of the repo.`);
  process.exit(command ? 1 : 0);
}

if (rest.some((arg) => arg === "--theme" || arg.startsWith("--theme=")) && command !== "promo" && command !== "auto") {
  throw new Error("--theme applies to panoma-video promo or panoma-video auto with goal promo/all; it styles ProductPromo graphics only.");
}
await commands[command]();
