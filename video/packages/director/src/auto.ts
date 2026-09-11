/*
  The automatic path, end to end: a project goes in, reviewed videos come out.

  Every stage writes its result into the project's workspace and is keyed on its
  inputs, so a second run redoes only what changed: the scout is always fresh (it is
  fast), the tour and the takes are keyed on the product's commit, on what the working
  tree has that the commit does not, and on the tour's own steps — never on the port
  the dev server happened to get; the briefs are regenerated and then patched, and a render is keyed on the
  expanded brief, the take files, the engine commit and the fonts. A stage that fails
  does not fail the run: it is recorded as failed with the tool that fixes it, and
  the run carries on with what it has — an agent on a bad day still gets evidence.

  What it never does: run the project's install script, write inside the project,
  read a .env, or call a paid API without a key and a cap. The dev server binds
  127.0.0.1 on a free port and is stopped, with its process tree, before this
  function returns — on success, on failure, and on cancellation.
*/
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  FORMATS,
  applyPatch,
  auditClaims,
  cuesFromWords,
  disclosureText,
  expandBrief,
  JOBS,
  needsDisclosure,
  provenanceJson,
  toSrt,
  toTranscript,
  toVtt,
  type Brief,
  type BriefPatch,
  type FactSheet,
  type FormatId,
  type ReviewCheck,
  type ReviewReport,
} from "@panoma/video-core";
import { actionDenySelectors, DESKTOP_TAKE, ELEMENT_CAPTURE_VERSION, MOBILE_TAKE, recordTake, type ElementHint, type SessionLog } from "@panoma/video-capture";
import { brandFromPage, brandFromRepo, defaultBrand, launchBrowser, mergeBrand, renderBrand, type BrandProfile, type LivePageContext } from "@panoma/video-brand";
import { filmSchemeOf, withHouseTheme, type Direction } from "@panoma/video-brand/direction";
import { describeTrack, scoreTrack } from "./music.ts";
import { directionFor } from "./look.ts";
import { scoutProject, startServer, worktreeDigest, type ProjectProfile, type RunningServer } from "@panoma/video-scout";
import { writeTour, writeLesson, lessonSummary, tourSummary, toUserFlow, ATLAS_VERSION, LESSON_STEPS, TOUR_VERSION, type LessonScript, type TourScript } from "@panoma/video-tour";
import { ensureSfx, writeBed, loudness, master } from "@panoma/video-audio";
import { contactSheet, overall } from "@panoma/video-review";
import { planBriefs, type Plan, type PlannedBrief } from "./plan.ts";
import { parsePromoTheme, retainedPromoTheme, promoCandidates, promoFor, type PromoResult, type PromoDecision, type PromoThemeRequest } from "./promo.ts";
import { DEFAULT_VOICE, narrate } from "./narrate.ts";
import { VOICE_MANIFEST } from "@panoma/video-core/cache";
import { storyChecks } from "./story-checks.ts";
import { reviewComposition } from "./render-review.ts";
import { exportProvenance } from "./export-provenance.ts";
import { engineRuntimeKey as engineCommit } from "./runtime-key.ts";
import { validatePromoVariants } from "./promo-validation.ts";
import { applySavedPromoRevision, archivePromoRevisions } from "./promo-revisions.ts";
import { polishable, type Lang } from "./templates.ts";
import { inputHash, inside, listFiles, openWorkspace, readJson, videoHome, writeJson, type Workspace } from "./workspace.ts";
import { writeKit } from "./kit.ts";
import { parseBrief, parsePatch } from "./schema.ts";
import type { Brain, BrainChoice, Thesis } from "@panoma/video-brain";
import { chooserFor, fixFor, fixableChecks, kitFor, openBrainFor, readBrainPatches, rerankFor, routerFor, thesisFor, writeBrainPatch, writeFor, type BrainFile } from "./brain.ts";
import { writeStudy } from "./study.ts";
import { applyBrandPatch, readBrandPatch, BRAND_PATCH_FILE } from "./brand-patch.ts";
import { probeCaptureSource, type CaptureSource } from "./capture-source.ts";

const run = promisify(execFile);

/* Changelog is still booked; spotlight is the product-film path for a real app. */
export type AutoGoal = "promo" | "trailer" | "spotlight" | "tutorial" | "sitetour" | "facts" | "all";
export type AutoUntil = "study" | "plan" | "preview" | "final";
export type StageName = "scout" | "brand" | "brain" | "serve" | "tour" | "record" | "score" | "study" | "plan" | "narrate" | "render" | "review";
export type StageStatus = { status: "done" | "cached" | "skipped" | "failed"; summary: string; next?: { tool: string; args: Record<string, unknown> } };

export type AutoOptions = {
  root: string;
  goal?: AutoGoal;
  langs?: Lang[];
  until?: AutoUntil;
  /** Redo the tour and the takes even when their inputs did not change. */
  force?: boolean;
  /*
    An ElevenLabs voice id for the tutorial.

    Absent means the default voice, which is what makes a narrated tutorial the
    normal outcome rather than a thing you have to know an id to ask for — but only
    when a key is set, because panoma video never calls a paid API without one. Pass "none"
    for a silent piece that shows its sentences as type.
  */
  voice?: string;
  /*
    An address to film instead of starting the product.

    The pipeline starts the project's own dev server, which is right for a project
    and wrong for an instance that is already running with something in it: a staging
    deployment, or the production build someone is using on this machine. Two servers
    over one database is also how a single-writer product gets hurt. Given this, the
    serve stage does nothing and the camera goes where it is sent.
  */
  url?: string;
  /** Source-reviewed CSS selectors whose effects are forbidden; retained in the tour and enforced by the camera. */
  denySelectors?: readonly string[];
  /*
    A tutorial about one thing, asked for in words.

    Everything else here films what the product IS; this films how to do something in
    it. It changes one stage and one decision: the walk becomes a reading and a route
    (`writeLesson`), and the only piece planned is the tutorial — a request for "how to
    manage the .md files" is not answered by also cutting a trailer. The words travel
    all the way to the writing, because a sentence that answers the question asked is
    the whole difference between a tutorial and a tour with narration over it.
  */
  about?: string;
  /** Editorial direction for a promotion; never a source of new product facts. */
  creative?: string;
  /** Explicitly replace a promotional story, preserving its prior journal in an archive. */
  newStory?: boolean;
  /** Omitted is Normal / Flat (or a retained user choice); auto explicitly opts into theme selection. */
  theme?: PromoThemeRequest;
  /*
    Make a tutorial without being told what about.

    `about` says what to teach; this says "decide". The reading is scored screen by
    screen (`slateOf`), a brain names the rows and picks one, and the task it names
    becomes the goal for everything downstream — so nothing after this stage knows the
    difference between a tutorial somebody asked for and one panoma video chose. Which
    is the point: a tool you have to know how to ask is a tool for people who already
    know the product.
  */
  teach?: boolean;
  projectId?: string;
  home?: string;
  /** Render only this format in preview (default "h", the take with the most pixels). */
  previewFormat?: FormatId;
  /** Render one composition: a brief, and optionally its hook and language. */
  only?: { brief: string; hook?: string; lang?: string };
  /*
    Which brain answers: a driver by name, "auto" — the first one this machine has,
    the claude or codex agent before a key — or "none" for the templates alone. The
    default is "auto", or PANOMA_VIDEO_BRAIN when it is set.
  */
  brain?: BrainChoice;
  /*
    A track of your own, scored for the grid (music.ts): every cut lands on its beats.
    The camera follows the product's actions by default. `dance` explicitly enables
    musical motion: "full" on a wordless piece, "light" under narration, "off" by default.
  */
  music?: string;
  dance?: "off" | "light" | "full";
  /** Fix passes still allowed. A review the brain can answer by rewriting words is rewritten and rendered once more. */
  fixes?: number;
  /** Internal: false on a fix pass, which reuses the takes on disk and does not start the product again. */
  camera?: boolean;
  onProgress?: (stage: StageName | "kit", message: string, done?: number, total?: number) => void;
  signal?: AbortSignal;
};

export type BrainReport = {
  driver: string;
  model: string;
  how: string;
  calls: number;
  cached: number;
  failed: number;
  thesis?: { what: Record<string, string>; angle: Record<string, string>; interfaceLang: string };
  /** Every choice the brain made about this run, with its reason, in order. */
  decisions: string[];
  file: string;
  log: string;
};

export type RenderRow = {
  id: string;
  file: string;
  review: { status: ReviewReport["status"]; failing: ReviewCheck[]; file: string };
  sheet?: string;
  seconds: number;
  lufs?: number;
  kit?: string;
  provenance: string;
};

export type AutoReport = {
  project: { id: string; root: string; dir: string; name: string; kind: ProjectProfile["kind"] };
  files: { profile: string; facts: string; brand: string; tour?: string; study?: string; captureSource?: string; auto: string };
  stages: Record<StageName, StageStatus>;
  briefs: { id: string; goal: string; job?: string; formats: string[]; file: string; recipe: string; claims: number }[];
  skipped: { goal: string; why: string }[];
  /** Who the pieces are for, and what would unlock each job this product has not earned. */
  campaign: { make: { job: string; goal?: string; formats: string[]; why: string }[]; skip: { job: string; unlock: string }[] };
  renders: RenderRow[];
  /** Lines a model could improve, with why. */
  polish: { brief: string; line: string; lang: string; text: string; why: string }[];
  /** Compositions whose file carries a synthetic voice or a generated bed — the platform's disclosure checkbox. */
  disclose: string[];
  reference?: RenderRow;
  /** Present when a brain was wired for this run. */
  brain?: BrainReport;
  /** Present when the run was asked for a tutorial about one thing: what was asked, and the route that answered it. */
  lesson?: { goal: string; by: "brain" | "words"; why: string; summary: string; angle?: string; evidence?: string; chose?: string };
};

const stage = (status: StageStatus["status"], summary: string, next?: StageStatus["next"]): StageStatus => ({ status, summary, ...(next ? { next } : {}) });

/**
 * The sentence for a plan that produced nothing, with the kind that was asked for first.
 *
 * Every kind is planned and every one set aside is reported, so a person who asked for a promo
 * used to read four reasons in a row and find theirs third. The one they asked for is the
 * answer; the others follow it, because a host that shows only the first line still shows the
 * right one.
 */
export function nothingPlanned(skipped: { goal: string; why: string }[], wanted: (goal: string) => boolean): string {
  const asked = skipped.filter((s) => wanted(s.goal));
  const ordered = [...asked, ...skipped.filter((s) => !asked.includes(s))];
  return `no brief could be planned: ${ordered.map((s) => `${s.goal} — ${s.why}`).join("; ")}`;
}


async function fileHash(path: string): Promise<string> {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex").slice(0, 16);
  } catch {
    return "missing";
  }
}

/*
  The addresses a cache key is allowed to see.

  The dev server binds a free port, so the same product is served from
  http://127.0.0.1:50270 on one run and from somewhere else on the next. Hashing that
  verbatim is why the tour and the takes were never reused, and why every render was
  re-encoded behind them: the port is handed out by the operating system and says
  nothing about the product, so a loopback address becomes the word "local" before it
  reaches a key. That string is only ever hashed, never opened. A deployed address is
  kept whole — a tour of https://example.com is a tour of something other than this
  checkout, and the two must never share a key or a take.

  The same function does the opposite job when the camera rolls: a stored `goto` names
  the port of the run that wrote it, and that socket is closed, so the steps are moved
  onto the address this run is serving from.
*/
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "0.0.0.0"]);
const LOCAL = "local";

export function onOrigin(raw: string, origin: string): string {
  try {
    const u = new URL(raw);
    return LOOPBACK.has(u.hostname) ? `${origin}${u.pathname}${u.search}${u.hash}` : raw;
  } catch {
    return raw;
  }
}

/**
 * Is this address a port on this machine — the kind that stops answering the moment
 * the run that opened it ends? A tour of a deployed site is not, and replaying it
 * needs no server at all.
 */
export function isLoopback(raw: string): boolean {
  try {
    return LOOPBACK.has(new URL(raw).hostname);
  } catch {
    return false;
  }
}

/** Every `goto` in a tour moved onto one origin; no other kind of step carries an address. */
export const stepsOnOrigin = (steps: TourScript["steps"], origin: string): TourScript["steps"] =>
  steps.map((s) => ("goto" in s ? { ...s, goto: onOrigin(s.goto, origin) } : s));

/** Rebind a cached local tour only after its replacement takes were filmed on
 * the engine's newly allocated server. Named remote subjects keep their identity. */
export function tourOnOrigin<T extends TourScript>(tour: T, origin: string): T {
  if (!isLoopback(tour.url) || !isLoopback(origin)) return tour;
  const base = new URL(origin).origin;
  const moved = { ...tour, url: onOrigin(tour.url, base), steps: stepsOnOrigin(tour.steps, base) };
  return { ...moved, flow: toUserFlow(moved) };
}

/** The takes on disk for a session name, by take id. */
async function takesOf(ws: Workspace, name: string): Promise<SessionLog[]> {
  const files = await listFiles(ws.paths.sessions, ".session.json");
  const logs: SessionLog[] = [];
  for (const f of files) {
    const log = await readJson<SessionLog>(f);
    if (log?.name === name && existsSync(join(ws.paths.sessions, log.video))) logs.push(log);
  }
  return logs;
}

async function patchesOf(ws: Workspace): Promise<Record<string, BriefPatch>> {
  const out: Record<string, BriefPatch> = {};
  for (const f of await listFiles(ws.paths.briefs, ".patch.json")) {
    const id = basename(f, ".patch.json");
    const raw = await readJson<unknown>(f);
    if (raw) out[id] = parsePatch(raw);
  }
  return out;
}

export async function auto(opts: AutoOptions): Promise<AutoReport> {
  parsePromoTheme(opts.theme);
  const until = opts.until ?? "preview";
  const langs = opts.langs ?? ["en", "es"];
  /* A request in words — or a request to choose one — is a request for one piece: the tutorial. */
  const goal: AutoGoal = opts.about || opts.teach ? "tutorial" : (opts.goal ?? "all");
  if (opts.theme !== undefined && goal !== "promo" && goal !== "all") throw new Error("theme applies only to goal promo or all, where it styles ProductPromo graphics.");
  const say = (s: StageName | "kit", m: string, done?: number, total?: number) => opts.onProgress?.(s, m, done, total);
  const aborted = () => opts.signal?.aborted === true;

  /* ---- scout: always fresh, always first ---- */
  say("scout", "reading the project");
  const profile = await scoutProject(opts.root);
  const ws = await openWorkspace(profile.root, { id: opts.projectId ?? profile.id, home: opts.home });
  const savedPolicy = await readJson<Pick<TourScript, "denySelectors">>(join(ws.paths.tours, `${ws.id}.json`));
  const denySelectors = actionDenySelectors(opts.denySelectors ?? savedPolicy?.denySelectors);
  if (denySelectors.length && (opts.about || opts.teach)) throw new Error("denySelectors currently applies to automatic tours; a lesson cannot silently discard a source action policy.");
  /* An unchanged URL or Git tree does not prove that a changed recorder, tour or
     source policy can reuse its takes. Refuse before the brain, probe or metadata
     writes: a camera upgrade must not overwrite an approved edit's evidence. */
  if (opts.camera !== false && !opts.newStory && (await listFiles(join(ws.dir, "promo-revisions"), ".json")).length > 0) {
    throw new Error("This project has saved scene revisions. A camera run may replace their recorded evidence; use --no-camera to keep editing the saved footage, or --new-story to allow fresh capture and archive the old story.");
  }
  const theme = retainedPromoTheme(opts.theme, (goal === "promo" || goal === "all") && opts.theme === undefined ? await readJson<unknown>(join(ws.dir, "promo.json")) : undefined);
  let { facts: rawFacts } = profile;
  const { facts: _facts, ...profileWithoutFacts } = profile;
  void _facts;
  /*
    What the walk and the takes are OF. The commit says which version; the tree digest
    says what has been edited since, so an uncommitted change costs a fresh walk and
    fresh takes. When git cannot fingerprint the tree at all — no repository, or one
    that ignores this very directory — there is no evidence of sameness, and a constant
    in its place would be evidence of it: run one's footage would be served forever. So
    the run gets a token of its own and nothing is reused. The stage summaries say so,
    because a pipeline that never caches should not be a mystery.
  */
  const tree = await worktreeDigest(profile.root);
  const blind = tree === undefined;
  const revision = [profile.git?.head ?? "no-git", tree ?? randomUUID()];
  const unkeyed = blind ? " · git cannot fingerprint this tree, so nothing is reused between runs" : "";
  /*
    The trap below is a `set` trap, so it announces a stage when one is assigned and never
    announces the table it started with. That silently swallowed scout's own summary — the only
    stage that is already finished when the table is built — so the host saw eleven stages and
    the twelfth arrived as nothing. The literal is built first and announced by hand.
   */
  const initial: Record<StageName, StageStatus> = {
    scout: stage("done", `${profile.name} · ${profile.kind}${profile.framework ? ` · ${profile.framework.name}` : ""} · routes: ${profile.routes.length} · facts: ${rawFacts.facts.length}`),
    brand: stage("skipped", "not run"),
    brain: stage("skipped", "not run"),
    serve: stage("skipped", "not run"),
    tour: stage("skipped", "not run"),
    record: stage("skipped", "not run"),
    score: stage("skipped", "no track: the procedural bed"),
    study: stage("skipped", "not run"),
    plan: stage("skipped", "not run"),
    narrate: stage("skipped", "not run"),
    render: stage("skipped", "not run"),
    review: stage("skipped", "not run"),
  };
  for (const [name, value] of Object.entries(initial)) say(name as StageName, `${value.status}: ${value.summary}`);
  const stages: Record<StageName, StageStatus> = new Proxy(initial, {
    // Completed and skipped stages matter to the host too, including the no-model path.
    set(target, property: string, value: StageStatus) {
      const name = property as StageName;
      target[name] = value;
      say(name, `${value.status}: ${value.summary}`);
      return true;
    },
  });
  const report: AutoReport = {
    project: { id: ws.id, root: ws.root, dir: ws.dir, name: profile.name, kind: profile.kind },
    files: { profile: ws.paths.profile, facts: ws.paths.facts, brand: ws.paths.brand, auto: ws.paths.auto },
    stages,
    briefs: [],
    skipped: [],
    campaign: { make: [], skip: [] },
    renders: [],
    polish: [],
    disclose: [],
  };
  /* The brain, when one is wired: its thesis is read by the tour, the plan, the fix pass and the kit. */
  let brain: Brain | null = null;
  let thesis: Thesis | undefined;
  const decisions: string[] = [];
  const finish = async () => {
    if (brain) {
      const l = brain.ledger();
      report.brain = {
        driver: brain.driver,
        model: brain.model,
        how: brain.how,
        calls: l.calls,
        cached: l.cached,
        failed: l.failed,
        ...(thesis ? { thesis: { what: thesis.what, angle: thesis.angle, interfaceLang: thesis.interfaceLang } } : {}),
        decisions,
        file: ws.paths.brain,
        log: ws.paths.brainLog,
      };
    }
    await writeJson(ws.paths.auto, report);
    return report;
  };

  /* ---- brand, repo pass ---- */
  let brand: BrandProfile = defaultBrand();
  try {
    const recordedBrand = opts.camera === false ? await readJson<BrandProfile>(ws.paths.brand) : null;
    if (recordedBrand?.colors && recordedBrand.scheme && recordedBrand.type) {
      brand = recordedBrand;
      stages.brand = stage("cached", "offline edit: the brand measured with the saved footage");
    } else {
      const repo = await brandFromRepo(profile.root);
      brand = mergeBrand(repo, {});
      stages.brand = stage("done", `repo pass · primary ${brand.colors.primary.hex} (${brand.colors.primary.confidence})`);
    }
  } catch (e) {
    stages.brand = stage("failed", `repo pass failed: ${(e as Error).message.split("\n")[0]}; the engine's theme is used`);
  }

  /* ---- brain: the judgement, when one is wired ---- */
  {
    const opened = await openBrainFor(ws, opts.brain, opts.signal);
    brain = opened.brain;
    if (!brain) {
      stages.brain = stage("skipped", `no brain: ${opened.why}; the templates write every word`);
    } else {
      say("brain", `asking ${brain.driver} what this product is`);
      try {
        const t = await thesisFor(brain, { profile, facts: rawFacts, brand, langs });
        thesis = t.value;
        const angle = thesis.angle[langs[0]] ?? Object.values(thesis.angle)[0] ?? "";
        stages.brain = stage(t.hit ? "cached" : "done", `${brain.driver}${brain.model ? ` (${brain.model})` : ""} · angle: ${angle} · interface language ${thesis.interfaceLang}`);
        decisions.push(`thesis: ${thesis.why}`);
        await writeJson(ws.paths.brain, { driver: brain.driver, model: brain.model, how: brain.how, at: new Date().toISOString(), thesis } satisfies BrainFile);
      } catch (e) {
        /* A brain that cannot answer the first question is not asked the others; the run goes on without it. */
        stages.brain = stage("failed", `${brain.driver} did not answer the thesis: ${(e as Error).message.split("\n")[0]}; the templates write every word`);
        brain = null;
      }
    }
  }

  /* ---- serve: the product on a loopback port, or its deployed address ---- */
  const camera = profile.kind === "web-app" || profile.kind === "static-site";
  let server: RunningServer | null = null;
  let url: string | undefined = opts.url;
  let captureSource: CaptureSource | undefined;
  const captureSourceFile = join(ws.paths.sessions, `${ws.id}.source.json`);
  if (opts.camera === false) {
    /* A fix pass: the takes on disk are the takes, the brand is the one they were shot under, and the product is not started again. */
    // A supplied URL used to survive this branch and silently trigger live extraction,
    // a new walk and a new recording when the brain or capture version changed.
    url = undefined;
    brand = (await readJson<BrandProfile>(ws.paths.brand)) ?? brand;
    stages.serve = stage("skipped", "fix pass: the product is not started again");
    const savedTour = await readJson<TourScript>(join(ws.paths.tours, `${ws.id}.json`));
    const savedTakes = await takesOf(ws, ws.id);
    stages.tour = savedTour ? stage("cached", "fix pass: the tour on disk")
      : stage("failed", "no saved tour; run once with the camera enabled", { tool: "panoma_video_record", args: { project_path: profile.root } });
    stages.record = savedTakes.length === 2 ? stage("cached", "fix pass: the takes on disk")
      : stage("failed", "both takes are required; run once with the camera enabled", { tool: "panoma_video_record", args: { project_path: profile.root } });
  } else if (opts.url) {
    stages.serve = stage("skipped", `filming ${opts.url}; the product was not started`);
  } else if (camera) {
    /*
      "Installed" means the project's declared dependencies are on disk. A package
      with no dependencies at all (a plain Node server) needs no node_modules, and
      the engine never runs install — an unattended run executing someone's postinstall
      is the one thing this path must not do.
    */
    const pkg = await readJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(join(profile.root, "package.json"));
    const declared = Object.keys(pkg?.dependencies ?? {}).length + Object.keys(pkg?.devDependencies ?? {}).length;
    const node = profile.packageManager !== undefined && ["npm", "pnpm", "yarn", "bun"].includes(profile.packageManager);
    const installed = !node || declared === 0 || existsSync(join(profile.root, "node_modules"));
    if (profile.start && installed) {
      say("serve", `starting ${profile.start.command} ${profile.start.args.join(" ")}`);
      try {
        server = await startServer(profile, { timeoutMs: 90_000, runtimeBase: join(videoHome(), "runtimes") });
        url = server.url;
        stages.serve = stage("done", `${profile.start.command} on ${url}`);
      } catch (e) {
        const message = (e as Error).message;
        await writeFile(ws.paths.serverLog, message);
        stages.serve = stage("failed", `could not start the product: ${message.split("\n")[0]}`, { tool: "shell", args: { run: profile.commands.find((c) => c.purpose === "start")?.command ?? "(no start command)" } });
      }
    } else if (profile.start && !installed) {
      stages.serve = stage("skipped", "node_modules is missing and panoma video never runs install; the deployed address is used if the project has one", { tool: "shell", args: { run: profile.commands.find((c) => c.purpose === "install")?.command ?? "install dependencies" } });
    } else {
      stages.serve = stage("skipped", "no documented start command");
    }
    if (!url && profile.url) {
      url = profile.url;
      /* The deployed address is a fallback, and the reason it was needed keeps its fix. */
      stages.serve = { ...stages.serve, status: "done", summary: `${stages.serve.summary} — using the deployed address ${url}` };
    }
  } else if (!opts.url) {
    stages.serve = stage("skipped", `${profile.kind}: no camera path`);
  }

  try {
    /* An existing instance can change while this checkout stays still. The probe
       does not run on an offline edit or on the temporary server panoma video started. */
    if (url && !server && !aborted()) {
      const previous = await readJson<CaptureSource>(captureSourceFile);
      captureSource = await probeCaptureSource(url, { previous, force: opts.force, signal: opts.signal });
      report.files.captureSource = captureSourceFile;
      stages.serve = { ...stages.serve, summary: `${stages.serve.summary} · ${captureSource.reason}` };
      say("serve", captureSource.reason);
    }
    /* Facts and profile belong to the saved evidence too. A refused deployment
       refresh must leave their exact bytes intact, or the retained journal becomes
       stale before Studio can open it even though no recording was replaced. */
    await writeJson(ws.paths.profile, profileWithoutFacts);
    await writeJson(ws.paths.facts, rawFacts);
    /* ---- brand, live pass ---- */
    let livePage: LivePageContext | undefined;
    if (url) {
      try {
        const browser = await launchBrowser();
        try {
          const live = await brandFromPage(url, { browser, outDir: ws.dir,
            ...(brain ? { onPageContext: (page: LivePageContext) => { livePage = page; } } : {}) });
          brand = mergeBrand(await brandFromRepo(profile.root), live);
          stages.brand = stage("done", `repo + live · primary ${brand.colors.primary.hex} (${brand.colors.primary.confidence}) · scheme ${brand.scheme.default}`);
        } finally {
          await browser.close();
        }
      } catch (e) {
        stages.brand = stage("done", `${stages.brand.summary} · live pass failed: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    /* A route title such as "Projects" or "Dashboard" is not the product name.
       Prefer the repository's human-facing name when the live page only named its
       current screen, and strip manifest furniture that would never appear in a mark. */
    if (/^(home|projects?|dashboard|overview|settings|app)$/i.test(brand.name.trim())) {
      const publicName = profile.name.replace(/^@[^/]+\//, "").replace(/[-_](monorepo|repo|app|web)$/i, "").replace(/[-_]+/g, " ");
      brand = { ...brand, name: publicName.replace(/\b\w/g, (c) => c.toUpperCase()) };
    }
    /* Repository logos are evidence, not dependencies: copy the exact bytes into
       the external workspace so a later render does not read from or depend on the
       filmed checkout. Live extraction already writes there and takes this branch out.

       "Already in the workspace" is a path-boundary question, and it used to be asked
       with `startsWith(`${ws.dir}/`)`. That slash is written by hand: on Windows the
       children of `D:\a\ws` are separated by a backslash, so the test never matched,
       and a logo that was already the copy got copied onto itself — which Windows
       refuses with EBUSY rather than quietly doing nothing. `inside` asks `path`. */
    if (brand.logo && !inside(ws.dir, brand.logo.file)) {
      const suffix = extname(brand.logo.file).toLowerCase() || ".bin";
      const copied = join(ws.dir, `brand-logo${suffix}`);
      await copyFile(brand.logo.file, copied);
      brand = { ...brand, logo: { ...brand.logo, file: copied, origin: `${brand.logo.origin} (copied into the panoma video workspace)` } };
    }
    /*
      A person's correction outranks every measurement. It is read here — after the two
      passes and before anything is written — so `brand.json` on disk is what the film
      was actually made from, and the fix pass, which re-reads that file, needs nothing
      extra to honour it.
    */
    const patched = applyBrandPatch(brand, await readBrandPatch(ws), ws.dir);
    brand = patched.brand;
    if (patched.applied.length > 0 || patched.refused.length > 0) {
      stages.brand = stage(
        stages.brand.status === "skipped" ? "done" : stages.brand.status,
        `${stages.brand.summary} · ${BRAND_PATCH_FILE}: ${patched.applied.length > 0 ? `applied ${patched.applied.join(", ")}` : "nothing applied"}${patched.refused.length > 0 ? ` · refused ${patched.refused.join("; ")}` : ""}`,
      );
    }
    /*
      A patched name becomes a fact with the patch as its source, so a film may say it.
      Everything a video states must trace to a fact — a person's assertion in a file is a
      source like a README line is, and without this the correction reached the palette
      card and never the card the film opens on.
    */
    if (patched.applied.includes("name")) {
      rawFacts = { ...rawFacts, facts: [{ id: "brand.name", kind: "text", value: brand.name, source: `${BRAND_PATCH_FILE}#name` }, ...rawFacts.facts.filter((f) => f.id !== "brand.name")] };
      await writeJson(ws.paths.facts, rawFacts);
    } else if (brand.nameEvidence?.value === brand.name && brand.name.trim().length > 0 && brand.name.length <= 80 && !/[\r\n]/.test(brand.name)) {
      // A starter package id is build metadata. The page's declared identity is the
      // product name, with its exact witness retained for offline edits and exports.
      rawFacts = { ...rawFacts, facts: [{ id: "brand.name", kind: "text", value: brand.name, source: `brand.json#nameEvidence (${brand.nameEvidence.source})` }, ...rawFacts.facts.filter((f) => f.id !== "brand.name")] };
      await writeJson(ws.paths.facts, rawFacts);
    }
    await writeJson(ws.paths.brand, brand);

    if (brain && livePage?.snapshot.trim() && !aborted()) {
      // A starter README cannot direct exploration of a different live product.
      // This reuses the existing thesis question, cache and call cap before any click.
      say("brain", "checking the product understanding against its live interface before the tour");
      try {
        const checked = await thesisFor(brain, { profile, facts: rawFacts, brand, langs,
          page: { ...livePage, url: opts.url ? livePage.url : onOrigin(livePage.url, LOCAL) } });
        thesis = checked.value;
        stages.brain = stage(checked.hit ? "cached" : "done", `${brain.driver} · live interface · angle: ${thesis.angle[langs[0]] ?? ""} · interface language ${thesis.interfaceLang}`);
        decisions.push(`live thesis: ${thesis.why}`);
        await writeJson(ws.paths.brain, { driver: brain.driver, model: brain.model, how: brain.how, at: new Date().toISOString(), thesis } satisfies BrainFile);
      } catch (error) {
        decisions.push(`live thesis retained its earlier answer: ${(error as Error).message.split("\n")[0]}`);
      }
    }

    /*
      The scheme the film is shot in, computed once, here, because the next four things
      that need it must not be able to disagree: the walker is told it, the recorder
      paints it behind the page, and BOTH cache keys are hashed on it. It is derived from
      the stage rather than read from `brand.scheme.default`, which is what the page says
      about itself — they agree on every product on this disk, and the day they do not,
      changing the recorder without the key would pin this workspace to takes in the wrong
      scheme for ever.
    */
    const filmScheme = filmSchemeOf(brand);

    /* ---- tour ---- */
    let tour: TourScript | undefined;
    let tourCacheKey: string | undefined;
    const tourFile = join(ws.paths.tours, `${ws.id}.json`);
    if (url && !aborted()) {
      /*
        An address the caller named is part of what was filmed, port and all: it is a
        choice about which instance, and two instances of one product show different
        things. A port the operating system handed out is not, and collapses to a word.
      */
      /* The live thesis exists before exploration. A corrected interpretation must
         invalidate a walk chosen from starter metadata, even with the same model. */
      const key = inputHash("tour", TOUR_VERSION, ATLAS_VERSION, opts.about ?? (opts.teach ? "vira-chooses" /* not a typo and not a leftover: this literal is hashed into the tour cache key, so renaming it with the engine would re-walk every product for nothing. */ : "no-request"), opts.url ?? onOrigin(url, LOCAL), revision, filmScheme, brain ? ["brain", brain.driver, brain.model, thesis] : "no-brain", ...(captureSource ? [captureSource.key] : []), ...(denySelectors.length ? [denySelectors] : []));
      tourCacheKey = key;
      const existing = await readJson<TourScript & { key?: string }>(tourFile);
      if (existing && existing.key === key && !opts.force) {
        tour = existing;
        stages.tour = stage("cached", `marks: ${tour.marks.length}${captureSource ? ` · ${captureSource.reason}` : ""}`);
      } else if (opts.about || opts.teach) {
        say("tour", opts.about ? `reading ${url} for "${opts.about}"${brain ? `, ${brain.driver} planning the route` : ""}` : `reading ${url} to decide what it should teach`);
        try {
          const lesson = await writeLesson({
            url,
            name: ws.id,
            ...(opts.about ? { goal: opts.about } : {}),
            colorScheme: filmScheme,
            ...(brain && opts.about ? { router: routerFor(brain, LESSON_STEPS.most) } : {}),
            ...(brain && !opts.about ? { chooser: chooserFor(brain, thesis) } : {}),
            onProgress: (m) => say("tour", m),
          });
          tour = lesson;
          await writeJson(tourFile, { ...lesson, key });
          await writeJson(join(ws.paths.tours, `${ws.id}.flow.json`), lesson.flow);
          await writeJson(join(ws.paths.tours, `${ws.id}.lesson.json`), { goal: lesson.goal, ...lesson.lesson });
          stages.tour = stage(
            "done",
            `${lesson.marks.length} ${lesson.marks.length === 1 ? "mark" : "marks"} for "${lesson.goal}"${lesson.lesson.slate ? ` · chosen from a slate of ${lesson.lesson.slate.menu.length}` : ""} · route by ${lesson.lesson.by}${lesson.lesson.angle ? ` · angle ${lesson.lesson.angle}` : ""}${lesson.lesson.dropped.length > 0 ? ` · dropped ${lesson.lesson.dropped.length}` : ""}${unkeyed}`,
          );
          report.lesson = {
            goal: lesson.goal,
            by: lesson.lesson.by,
            why: lesson.lesson.why,
            summary: lessonSummary(lesson),
            ...(lesson.lesson.angle ? { angle: lesson.lesson.angle } : {}),
            ...(lesson.lesson.evidence ? { evidence: lesson.lesson.evidence } : {}),
            ...(lesson.lesson.slate ? { chose: lesson.lesson.slate.menu[lesson.lesson.slate.chosen].path } : {}),
          };
        } catch (e) {
          stages.tour = stage("failed", `the lesson could not be planned: ${(e as Error).message.split("\n")[0]}`, { tool: "panoma_video_record", args: { project_path: profile.root, force: true } });
        }
      } else {
        say("tour", `walking ${url}${brain ? `, ${brain.driver} choosing what to press` : ""}`);
        try {
          tour = await writeTour({ url, name: ws.id, colorScheme: filmScheme, ...(denySelectors.length ? { denySelectors } : {}), ...(brain && thesis ? { rerank: rerankFor(brain, thesis), verbs: thesis.verbs } : {}) });
          await writeJson(tourFile, { ...tour, key });
          await writeJson(join(ws.paths.tours, `${ws.id}.flow.json`), tour.flow);
          const chosen = tour.candidates.filter((c) => c.reasons.some((r) => r.startsWith("brain: ranked"))).length;
          stages.tour = stage("done", `${tourSummary(tour).split("\n")[0]}${chosen > 0 ? ` · controls the brain put forward: ${chosen}` : ""}${unkeyed}`);
        } catch (e) {
          stages.tour = stage("failed", `the walker failed: ${(e as Error).message.split("\n")[0]}`, { tool: "panoma_video_record", args: { project_path: profile.root, force: true } });
        }
      }
      report.files.tour = tourFile;
    }

    /* ---- record ---- */
    let takes: SessionLog[] = [];
    if (tour && url && !aborted()) {
      /* Not the walker version: what a camera shoots is the steps, and the steps are in the key already. */
      const key = inputHash("record", ELEMENT_CAPTURE_VERSION, opts.url ? tour.steps : stepsOnOrigin(tour.steps, LOCAL), revision, filmScheme, [DESKTOP_TAKE, MOBILE_TAKE], ...(captureSource ? [captureSource.key] : []), ...(denySelectors.length ? [denySelectors] : []));
      const keyFile = join(ws.paths.sessions, `${ws.id}.key`);
      const previous = await readFile(keyFile, "utf8").catch(() => "");
      takes = await takesOf(ws, ws.id);
      if (previous === key && takes.length === 2 && !opts.force) {
        stages.record = stage("cached", `2 takes · marks: ${takes[0].marks.map((m) => m.name).join(", ")}${captureSource ? ` · ${captureSource.reason}` : ""}`);
        if (captureSource) await writeJson(captureSourceFile, captureSource);
      } else {
        /*
          The takes on disk are replaced one at a time, so the key that describes them
          stops being true at the first frame. Drop it before shooting: a run that dies
          between the two takes must not leave a pair an old key still vouches for.
        */
        await rm(keyFile, { force: true });
        takes = [];
        for (const take of [DESKTOP_TAKE, MOBILE_TAKE]) {
          if (aborted()) break;
          say("record", `shooting the ${take.id} take`);
          try {
            /*
              Every click and scroll the tour wrote is optional on tape: a control that
              existed when the walker looked and not when the camera did (a player's
              Play button, a lazy banner) must cost that step, never the take. Marks
              are separate steps and always land, which is what the plan pins to.
            */
            const steps = stepsOnOrigin(tour.steps, url).map((s) => ("clickOn" in s || "scrollTo" in s ? { ...s, optional: true } : s));
            const elementHints = Object.fromEntries(
              tour.marks.map((mark): [string, ElementHint] => {
                /*
                  The selector comes from the step the mark introduces, not from a
                  candidate's prose: a description reads `link "Get started" in banner
                  → /start (on /)` and a mark's label reads `Get started`, so matching
                  the two never once produced a selector and every hint carried a box.
                */
                const from = tour.steps.findIndex((step) => "mark" in step && step.mark === mark.name);
                const step = from < 0 ? undefined : tour.steps.slice(from + 1).find((x) => "clickOn" in x || "scrollTo" in x);
                const selector = step && ("clickOn" in step ? step.clickOn : "scrollTo" in step ? step.scrollTo : undefined);
                return [mark.name, {
                  ...(selector ? { selector } : {}),
                  ...(mark.target ? { box: mark.target } : {}),
                  label: mark.label,
                  kind: mark.kind,
                }];
              }),
            );
            /* What the walker saw each click produce, so the camera can measure where the answer landed. */
            const outcomes = Object.fromEntries(tour.marks.filter((mark) => mark.outcome).map((mark) => [mark.name, mark.outcome!]));
            const log = await recordTake({
              name: ws.id,
              take,
              steps,
              outDir: ws.paths.sessions,
              colorScheme: filmScheme,
              ...(denySelectors.length ? { denySelectors } : {}),
              /* A take of the deployed site is a photograph of whatever is deployed, not of this checkout. */
              head: server ? profile.git?.head : undefined,
              elementHints,
              outcomes,
            });
            takes.push(log);
          } catch (e) {
            stages.record = stage("failed", `the ${take.id} take failed: ${(e as Error).message.split("\n")[0]}`, { tool: "panoma_video_record", args: { project_path: profile.root, force: true } });
          }
        }
        if (takes.length === 2) {
          /* A cached walk retains its previous port until new footage exists.
             Keep the strict same-origin proof check: bind the saved tour to the
             server we actually filmed instead of treating all loopback apps alike.
             Reused takes must keep their original tour origin. */
          if (server && !opts.url) {
            const rebound = tourOnOrigin(tour, url);
            await writeJson(tourFile, { ...rebound, ...(tourCacheKey ? { key: tourCacheKey } : {}) });
            await writeJson(join(ws.paths.tours, `${ws.id}.flow.json`), rebound.flow);
          }
          await writeFile(keyFile, key);
          if (captureSource) await writeJson(captureSourceFile, { ...captureSource, capturedAt: captureSource.checkedAt });
          stages.record = stage("done", `2 takes · ${(takes[0].durationMs / 1000).toFixed(1)} s and ${(takes[1].durationMs / 1000).toFixed(1)} s${unkeyed}${captureSource ? ` · ${captureSource.reason}` : ""}`);
        }
      }
    }
  } finally {
    if (server) {
      await writeFile(ws.paths.serverLog, server.log()).catch(() => undefined);
      await server.stop().catch(() => undefined);
    }
  }
  if (aborted()) return finish();

  /* ---- plan ---- */
  /* A voice, unless the caller refused one or there is no key to pay for it. */
  const voice = opts.voice === "none" ? undefined : (opts.voice ?? (process.env.ELEVENLABS_API_KEY ? DEFAULT_VOICE : undefined));
  const takesOnDisk = await takesOf(ws, ws.id);
  const tourOnDisk = await readJson<TourScript>(join(ws.paths.tours, `${ws.id}.json`));
  const patches = await patchesOf(ws);

  if (brain && tourOnDisk && takesOnDisk.length === 2) {
    // The first thesis helps explore. The recorded interface corrects boilerplate
    // README assumptions before they can direct the film's argument or language.
    say("brain", "checking the product understanding against its recorded interface");
    try {
      const checked = await thesisFor(brain, { profile, facts: rawFacts, brand, langs, tour: tourOnDisk });
      thesis = checked.value;
      stages.brain = stage(checked.hit ? "cached" : "done", `${brain.driver} · recorded interface · angle: ${thesis.angle[langs[0]] ?? ""} · interface language ${thesis.interfaceLang}`);
      decisions.push(`recorded thesis: ${thesis.why}`);
      await writeJson(ws.paths.brain, { driver: brain.driver, model: brain.model, how: brain.how, at: new Date().toISOString(), thesis } satisfies BrainFile);
    } catch (error) {
      decisions.push(`recorded thesis retained its earlier answer: ${(error as Error).message.split("\n")[0]}`);
    }
  }

  /* ---- score: a track of your own, on the grid ---- */
  /*
    Before the direction and the plan, because both read the tempo: the plan writes it
    into every brief and the direction's bed would be scored in it. The stage is keyed on
    the file's bytes (music.ts), so a second run with the same track is a cache hit and a
    changed file is a new analysis.
  */
  let scored: Awaited<ReturnType<typeof scoreTrack>> | undefined;
  if (opts.music) {
    say("score", `reading ${basename(opts.music)} for its beats`);
    try {
      scored = await scoreTrack(ws, opts.music, 30);
      stages.score = stage("done", describeTrack(scored));
    } catch (e) {
      stages.score = stage("failed", `${basename(opts.music)}: ${(e as Error).message.split("\n")[0]}; the procedural bed plays instead`);
    }
  }

  /*
    The look of this product's film. Derived here, from brand.json and the shape of the
    tour, so it exists before the plan and reaches the planner, the matrix and the render
    key. The FILE it came from can never be hashed: brand.json carries `source.url`, which
    is a free loopback port, and `source.extractedAt`, a wall clock — hashing either would
    miss the cache on every run for ever. The derived object carries neither.
  */
  /*
    A fix pass re-renders the cuts whose words changed, under the direction the review
    saw: it reads direction.json rather than asking again, because a brain that did not
    answer on the first pass and does on the second would change the whole film.
  */
  const kept = opts.camera === false ? (await readJson<{ direction: Direction }>(ws.paths.direction))?.direction : undefined;
  const direction = kept ? withHouseTheme(kept) : (await directionFor({ brain, thesis, brand, tour: tourOnDisk, kind: profile.kind, ws, decisions, music: scored ? { given: true, bpm: scored.measured, seconds: scored.seconds } : { given: false } }));

  /*
    With a track, the tempo is the track's — conformed to whole frames per beat. The
    direction object itself is not changed: it is
    hashed into the render key and the tour keys, and the tempo reaches the render through
    the brief, which is hashed too.
  */
  const filmDirection = scored ? { ...direction, sound: { ...direction.sound, bpm: scored.bpm } } : direction;
  /*
    Musical motion is a mode the caller requests, with a track or with the procedural bed.
    Write the default into every brief as well: a retained direction.json from an older
    run may still say "full", and must not activate motion the caller did not request.
  */
  const dance = opts.dance ?? "off";
  const planInput = {
    profile,
    facts: rawFacts,
    tour: takesOnDisk.length === 2 && tourOnDisk ? tourOnDisk : undefined,
    takes: takesOnDisk,
    langs,
    voice,
    patches,
    direction: filmDirection,
    music: { ...(scored ? { file: scored.file, pulse: scored.pulse } : {}), dance },
  };

  /* ---- study ---- */
  /*
    Everything a film could be made of, assembled before anything is planned: what the
    takes left, what each mark can honestly be shown as, the map, the palette card, and
    the gaps. Disk only — no browser, no server, no model — so the fix pass rebuilds it
    and `--brain=none` gets the same one.
  */
  /* The brand's name, not the package's: `@panoma/site` is an address and "Panoma" is
     the product. The wordmark and the palette card are drawings of a name. */
  const study = await writeStudy({ ws, profile: { name: brand.name || profile.name, kind: profile.kind }, brand, direction: filmDirection, takes: takesOnDisk, tour: tourOnDisk, facts: rawFacts }).catch((e: unknown) => {
    stages.study = stage("failed", `the studio could not be assembled: ${String(e)}`);
    return null;
  });
  if (study) {
    const empty = study.gaps.filter((g) => g.by !== "engine").length;
    stages.study = stage(
      "done",
      `screens: ${study.screens.length} · components: ${study.components.length} · controls: ${study.macro.length}${study.map ? ` · map: screens ${study.map.screens}, filmed ${study.map.filmed}` : ""} · gaps: ${empty}`,
    );
    report.files.study = join(ws.dir, "study", "index.json");
  }
  if (until === "study") return finish();

  let plan: Plan = planBriefs(planInput);
  /*
    The templates write the structure; the brain, when there is one, writes the words
    over it — and may set a piece aside. Its patch is kept beside the brief and
    re-applied under the agent's, and the plan is made again with both. What it could
    not be allowed to say is in the decisions, line by line.
  */
  const setAside = new Map<string, string>();
  const writingPlan = { ...plan, briefs: plan.briefs.filter((b) => b.brief.recipe !== "ProductPromo" && (goal === "all" || b.goal === goal || (goal === "tutorial" && b.goal === "facts"))) };
  if (brain && thesis && writingPlan.briefs.length > 0) {
    say("plan", `asking ${brain.driver} to write the words`);
    try {
      /*
        The request the words answer, whoever asked it. In the directed mode that is what
        the caller typed; in the autonomous one it is the task panoma video chose, and by the time
        the writing happens the two are the same kind of thing — which is why it is read
        off the tour rather than off the options.
      */
      const asked = (planInput.tour as { goal?: string; lesson?: { angle?: string; evidence?: string } } | undefined) ?? undefined;
      const written = await writeFor(brain, {
        thesis,
        plan: writingPlan,
        langs,
        tour: planInput.tour,
        ...(asked?.goal ? { about: asked.goal } : {}),
        ...(asked?.lesson?.angle ? { angle: asked.lesson.angle } : {}),
        ...(asked?.lesson?.evidence ? { evidence: asked.lesson.evidence } : {}),
      });
      for (const [id, patch] of Object.entries(written.patches)) await writeBrainPatch(ws, id, (f) => ({ ...f, write: patch }));
      for (const d of written.dropped) setAside.set(d.id, d.why);
      for (const [id, why] of Object.entries(written.why)) decisions.push(`${id}: ${why}`);
      for (const r of written.refused) decisions.push(`refused in ${r.brief}/${r.line} (${r.lang}): ${JSON.stringify(r.token)} — ${r.why}`);
      plan = planBriefs({ ...planInput, brainPatches: await readBrainPatches(ws, plan.briefs.map((b) => b.brief.id)) });
    } catch (e) {
      decisions.push(`write: ${brain.driver} did not answer (${(e as Error).message.split("\n")[0]}); the templates' words stand`);
    }
  }
  if (goal === "promo" || goal === "all") {
    say("plan", "choosing the supported benefit and its recorded proof");
    /* Discover the saved story independently of fresh eligibility. Losing a take,
       fact or destination can remove the new template, never the person's history. */
    const journals = await listFiles(join(ws.dir, "promo-revisions"), ".json");
    if (journals.length > 1) throw new Error("This workspace contains multiple promotional revision journals. Resolve which saved story is active before replanning; no history or brief was removed.");
    const savedPromoId = journals[0] ? basename(journals[0], ".json") : undefined;
    const journalExists = savedPromoId !== undefined;
    let promoLangs: readonly Lang[] = langs;
    let promo: PromoResult;
    if (journalExists && !opts.newStory) {
      const saved = await readJson<Record<string, unknown>>(join(ws.paths.briefs, `${savedPromoId}.json`));
      const savedDecision = await readJson<PromoDecision>(join(ws.dir, "promo.json"));
      if (!saved || !savedDecision) throw new Error("This promotion has saved revisions but its original plan is missing. Restore the plan before rendering its history.");
      const { origin, goal: savedGoal, ...raw } = saved;
      void origin; void savedGoal;
      const savedBrief = parseBrief(raw);
      if (opts.langs && (opts.langs.length !== savedBrief.langs.length || savedBrief.langs.some(lang => !opts.langs!.includes(lang as Lang)))) {
        throw new Error("This promotion has saved scene revisions with different language tracks. Use --new-story (MCP new_story: true) to change languages while archiving the approved story.");
      }
      /* Omitted settings keep the saved story's language order, including its
         evidence hash; default languages belong only to a new planning decision. */
      promoLangs = savedBrief.langs as readonly Lang[];
      const menu = promoCandidates({ ...planInput, langs: promoLangs, facts: plan.facts });
      const effective = await applySavedPromoRevision(ws, { brief: savedBrief, input: { ...planInput, langs: promoLangs, facts: menu.facts, thesis },
        sourceKey: inputHash("recording", profile.root, takesOnDisk.map(take => [take.name, take.take, take.recordedAt, take.head])) });
      if ((opts.dance !== undefined && opts.dance !== (effective.music?.dance ?? "off")) ||
          (opts.music !== undefined && (!scored || scored.file !== effective.music?.file))) {
        throw new Error("This promotion has saved scene revisions with different music or dance settings. Use --new-story (MCP new_story: true) to apply that adjustment while archiving the approved story.");
      }
      const selectedTheme = parsePromoTheme(opts.theme);
      if (opts.creative || (selectedTheme && selectedTheme !== (effective.promo?.theme ?? "flat"))) {
        throw new Error("This promotion has saved scene revisions. Apply the requested adjustment with panoma-video revise or Studio so the approved story stays intact.");
      }
      promo = { brief: effective, facts: menu.facts, decision: savedDecision, refused: menu.refused };
      decisions.push("promo: retained the saved scene revision; no new promotional decision was requested");
    } else {
      promo = await promoFor(brain, { ...planInput, facts: plan.facts, thesis, theme, ...(opts.creative ? { creative: opts.creative } : {}) });
    }
    if (opts.newStory && journalExists && !promo.brief) throw new Error(`The replacement story is unavailable: ${promo.why ?? "no supported promotional proof"} The saved brief and revision history were preserved.`);
    if (opts.newStory && promo.brief) {
      const original = promo.brief;
      promo = { ...promo, brief: applyPatch(promo.brief, patches[promo.brief.id]) };
      const material = { ...planInput, facts: promo.facts, thesis };
      await validatePromoVariants({ brief: promo.brief!, baseline: original, material, dirs: { assets: ws.dir, sessions: ws.paths.sessions, generated: ws.paths.generated, sfx: ws.paths.sfx, brand: renderBrand(brand, ws.dir), direction } });
      opts.signal?.throwIfAborted();
      const archived = await archivePromoRevisions(ws, savedPromoId ?? promo.brief!.id, { signal: opts.signal });
      if (archived.archived) decisions.push(`promo: previous story preserved at ${archived.file}`);
    }
    await writeJson(join(ws.dir, "promo.json"), promo.decision);
    // Other recipes in an all-goals run may already reference tour observations.
    // A promo's per-take proof restrictions stay in its own candidate menu.
    plan.facts = { ...promo.facts, facts: [...new Map([...plan.facts.facts, ...promo.facts.facts].map(fact => [fact.id, fact])).values()] };
    if (promo.brief) {
      const baseline = journalExists || opts.newStory ? promo.brief : applyPatch(promo.brief, patches[promo.brief.id]);
      const brief = await applySavedPromoRevision(ws, {
        brief: baseline,
        input: { ...planInput, langs: promoLangs, facts: promo.facts, thesis },
        sourceKey: inputHash("recording", profile.root, takesOnDisk.map((take) => [take.name, take.take, take.recordedAt, take.head])),
      });
      plan.briefs = [...plan.briefs.filter((b) => b.goal !== "promo"), { brief, goal: "promo", origin: promo.decision.by === "brain" ? "brain" : "template", claims: auditClaims(brief, plan.facts) }];
      decisions.push(`promo: ${promo.decision.why}`);
      decisions.push(`promo theme: ${promo.decision.theme.id} (${promo.decision.theme.by}) — ${promo.decision.theme.why}`);
    }
    for (const refusal of promo.refused) decisions.push(`promo refused: ${JSON.stringify(refusal)}`);
  }
  await writeJson(ws.paths.facts, plan.facts);
  report.skipped = plan.skip.map((s) => ({ goal: s.goal, why: s.why }));
  const wantedGoal = (name: string) => goal === "all" || name === goal || (goal === "tutorial" && name === "facts");
  const wanted = (b: PlannedBrief) => wantedGoal(b.goal);
  /* A piece the brain set aside stays set aside only when nobody asked for it by name. */
  const chosen = plan.briefs.filter(wanted).filter((b) => {
    const why = setAside.get(b.brief.id);
    if (why === undefined || goal !== "all") return true;
    report.skipped.push({ goal: b.goal, why: `the brain set this piece aside: ${why}` });
    return false;
  });
  /*
    And the briefs of runs that are over are removed.

    A workspace accumulated every brief every plan had ever written, and nothing said which
    of them the CURRENT tour is about. The cost is not disk: a brief pins its sentences to
    facts (`{{fact:ui.bridge.result}}`), the facts are rewritten by each plan, and a stale
    brief therefore refers to a fact the sheet no longer has — so any command that reads
    the workspace's briefs and expands them throws on a film nobody asked for. It bit
    `panoma-video render --project` and then `panoma-video storyboard`, both times on a piece planned days
    earlier from a walk that no longer exists.

    Only whole briefs go. A `.patch.json` is a person's own edit and is left where it is,
    orphaned and harmless, because deleting somebody's writing to tidy up is not this
    stage's decision to make.
  */
  const keep = new Set(chosen.map((b) => `${b.brief.id}.json`));
  for (const stale of await listFiles(ws.paths.briefs, ".json")) {
    const name = basename(stale);
    if (name.endsWith(".patch.json") || name.endsWith(".brain.json") || keep.has(name)) continue;
    await rm(stale, { force: true });
    decisions.push(`removed ${name}: planned by an earlier run, and its facts are gone`);
  }
  for (const b of chosen) {
    const file = join(ws.paths.briefs, `${b.brief.id}.json`);
    await writeJson(file, { ...b.brief, origin: b.origin, goal: b.goal });
    const job = b.brief.job;
    report.briefs.push({ id: b.brief.id, goal: b.goal, ...(job ? { job } : {}), formats: [...(job ? JOBS[job].formats : ["h", "v", "s"])], file, recipe: b.brief.recipe, claims: b.claims.length });
    /* Sentences a model could improve: the brain already did, where it wrote them. */
    if (b.origin === "template") for (const p of polishable(b.brief)) report.polish.push({ brief: b.brief.id, ...p });
  }
  stages.plan = chosen.length > 0
    ? stage("done", `briefs: ${chosen.map((b) => `${b.brief.id} (${b.brief.recipe}${b.origin === "brain" ? ", words by the brain" : ""})`).join(", ")}`)
    : stage("failed", nothingPlanned(report.skipped, wantedGoal), { tool: "panoma_video_plan", args: { project_path: profile.root } });
  report.campaign = { make: plan.campaign.make.map((j) => ({ ...j, formats: [...j.formats] })), skip: [...plan.campaign.skip] };
  await writeJson(join(ws.dir, "plan.json"), { pairs: plan.pairs, make: plan.make, skip: plan.skip, campaign: plan.campaign });
  if (until === "plan" || chosen.length === 0) return finish();

  /* ---- render + review ---- */
  const engine = await engineCommit();
  const { buildCompositions } = await import("@panoma/video-render/compositions");
  const { renderComposition, renderFrames, renderStill } = await import("@panoma/video-engine");
  const { heroFrame, captionCards, captionPhrases } = await import("@panoma/video-render/timing");
  const dirs = {
    assets: ws.dir,
    sessions: ws.paths.sessions,
    generated: ws.paths.generated,
    sfx: ws.paths.sfx,
    brand: renderBrand(brand, ws.dir),
    /* The product's own look: the stage, the ink, the accent, the rhythm and the bed. */
    direction,
  };
  await ensureSfx(ws.paths.sfx);

  /*
    A brief the audit flagged is not rendered: its placeholders may name nothing, and a
    number nobody vouched for must not reach a frame. The report already lists the
    claims and the tool that fixes them.
  */
  const renderable = chosen.filter((b) => b.claims.length === 0);
  const withheld = chosen.filter((b) => b.claims.length > 0).map((b) => `${b.brief.id} (claims to fix: ${b.claims.length})`);
  const expanded = renderable.map((b) => expandBrief(b.brief, plan.facts));

  /* ---- narrate: the voice, before the matrix goes looking for it ---- */
  /*
    Before the compositions are built, not after: `buildCompositions` decides a
    tutorial's whole clock from the seconds each sentence actually takes to say, and
    it learns those by reading the files this writes. Narrating afterwards would lay
    the piece out on estimates and then play a voice that does not fit it.
  */
  /* Rendering one cut pays for that cut's voice and no other brief's. */
  const toNarrate = opts.only ? expanded.filter((b) => b.id === opts.only!.brief) : expanded;
  if (toNarrate.some((b) => b.voice)) {
    say("narrate", "speaking the tutorial");
    try {
      const said = await narrate({
        briefs: toNarrate,
        outDir: ws.paths.generated,
        cacheDir: ws.paths.cache,
        onProgress: (m, done, total) => say("narrate", m, done, total),
        signal: opts.signal,
      });
      stages.narrate = stage(
        said.status,
        said.summary,
        said.status === "failed" ? { tool: "panoma_video_plan", args: { project_path: profile.root } } : undefined,
      );
    } catch (e) {
      /* A voice that fails is a tutorial with type instead of speech, not a run that stops. */
      stages.narrate = stage("failed", `the narration failed, and the piece falls back to type: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  if (aborted()) return finish();
  /*
    The matrix mounts a bed only when its file exists, and it is the matrix that says
    which beds exist to be written — so it is built twice: once to learn the beds,
    once with them on disk. Building it is arithmetic; rendering is the cost. A matrix
    that will not build (a take gone stale, a mark the take lost) fails this stage with
    the tool that fixes it, never the whole run.
  */
  let first: ReturnType<typeof buildCompositions>;
  try {
    first = buildCompositions(expanded, dirs);
  } catch (e) {
    stages.render = stage("failed", `the compositions could not be built: ${(e as Error).message.split("\n")[0]}`, { tool: "panoma_video_record", args: { project_path: profile.root, force: true } });
    return finish();
  }
  let wroteBeds = false;
  for (const bed of first.beds.values()) {
    if (!existsSync(bed.path)) {
      await mkdir(join(bed.path, ".."), { recursive: true });
      writeBed(bed.opts, bed.path);
      wroteBeds = true;
    }
  }
  const matrix = wroteBeds ? buildCompositions(expanded, dirs) : first;
  /*
    A track shorter than the film it scores.

    Nothing fails: the mix runs out and the rest plays under the voice and the effects
    alone. But it is the one thing about a brought track a person cannot see coming — a
    thirty-second loop under a ninety-second tutorial — so the stage says it, with the
    piece that outlasts it, rather than leaving a silent second half to be discovered in
    the file.
  */
  if (scored) {
    const longest = matrix.compositions.reduce((worst, c) => (c.durationInFrames / c.fps > worst.seconds ? { id: c.id, seconds: c.durationInFrames / c.fps } : worst), { id: "", seconds: 0 });
    if (longest.seconds > scored.seconds + 0.5) {
      const short = `the track is ${scored.seconds.toFixed(0)} s and ${longest.id} runs ${longest.seconds.toFixed(0)} s: it plays dry from ${scored.seconds.toFixed(0)} s`;
      stages.score = stage(stages.score.status, `${stages.score.summary} · ${short}`);
      decisions.push(`score: ${short}`);
    }
  }
  const previewFormat = opts.previewFormat ?? "h";
  const selection = opts.only
    ? matrix.compositions.filter((c) => {
        const [b, h, l, f] = c.id.split("--");
        const brief = renderable.find((x) => x.brief.id === opts.only!.brief);
        return b === opts.only!.brief && h === (opts.only!.hook ?? brief?.brief.hooks[0].id) && l === (opts.only!.lang ?? brief?.brief.langs[0]) && f === previewFormat;
      })
    : until === "final"
      ? matrix.compositions
      : renderable
          .map((b) => {
            /*
              One cut per brief, in the preview canvas — unless this brief's job is not
              published there. A feed cut is vertical only, so looking for its 1920x1080
              found nothing and the piece silently did not appear in the preview at all.
            */
            const head = `${b.brief.id}--${b.brief.hooks[0].id}--${b.brief.langs[0]}--`;
            return matrix.compositions.find((c) => c.id === `${head}${previewFormat}`) ?? matrix.compositions.find((c) => c.id.startsWith(head));
          })
          .filter((c): c is NonNullable<typeof c> => Boolean(c));
  if (selection.length === 0) {
    stages.render = withheld.length > 0 && renderable.length === 0
      ? stage("failed", `nothing to render until the claims are fixed: ${withheld.join(", ")}`, { tool: "panoma_video_plan", args: { project_path: profile.root } })
      : stage("failed", "no composition could be built: the briefs need takes that are not on disk", { tool: "panoma_video_record", args: { project_path: profile.root } });
    return finish();
  }

  let rendered = 0;
  const failures: string[] = [];
  /* Every check of every cut, by composition, for the fix pass to read. */
  const checksOf = new Map<string, { brief: string; checks: ReviewCheck[] }>();
  for (const comp of selection) {
    if (aborted()) break;
    const [briefId, , lang, formatId] = comp.id.split("--");
    const planned = renderable.find((b) => b.brief.id === briefId)!;
    const brief = planned.brief;
    const out = join(ws.paths.renders, `${comp.id}.mp4`);
    const base = out.slice(0, -4);
    const renderPlan = matrix.plans.get(comp.id);
    const takesUsed = takesOnDisk.filter((t) => t.name === brief.session);
    /*
      The narration is in the key by its manifest, not by the brief's intent. A brief
      only says a voice was ASKED for; whether one exists is a fact about the disk, and
      a recipe whose length does not depend on it (a card piece, a screen demo) would
      otherwise be served silent from cache after being voiced, with the provenance
      claiming a voice the file does not carry.
    */
    const key = inputHash(
      "render",
      expanded.find((b) => b.id === briefId),
      await Promise.all(takesUsed.map((t) => fileHash(join(ws.paths.sessions, t.video)))),
      await fileHash(join(ws.paths.generated, briefId, VOICE_MANIFEST)),
      engine,
      comp.durationInFrames,
      /* Every colour, every rhythm and the bed's style and key come from here now. */
      direction,
    );
    const keyFile = `${base}.key`;
    const cached = existsSync(out) && (await readFile(keyFile, "utf8").catch(() => "")) === key && !opts.force;

    const provenance = await exportProvenance({ brief, facts: plan.facts, comp, takes: takesUsed, ws, profile,
      assetsDir: dirs.assets, engine, hasVoice: (matrix.words.get(comp.id)?.length ?? 0) > 0,
      bedFile: matrix.beds.get(comp.id)?.path, scored, reviewFile: `${base}.review.json` });

    say("render", `${cached ? "cached" : "rendering"} ${comp.id}`, rendered, selection.length);
    if (!cached) {
      try {
        await renderComposition(comp, {
          out,
          assetsDir: dirs.assets,
          sessionsDir: dirs.sessions,
          onProgress: (done, total) => say("render", `${comp.id} · ${done}/${total}`, rendered, selection.length),
          metadata: { comment: disclosureText(provenance) },
          signal: opts.signal,
        });
        if (comp.audio.length > 0) await master(out);
        await writeFile(keyFile, key);
      } catch (e) {
        await rm(out, { force: true }).catch(() => undefined);
        failures.push(`${comp.id}: ${(e as Error).message.split("\n")[0]}`);
        continue;
      }
    }
    rendered++;

    /* review: the file, then the story */
    say("review", `reviewing ${comp.id}`);
    const targets = FORMATS[formatId as FormatId].targets.filter((target) => ["youtube", "shorts", "tiktok", "reels", "x", "linkedin"].includes(target));
    const fps = comp.fps;
    const spoken = matrix.words.get(comp.id);
    const review = await reviewComposition({
      file: out, comp, brief, facts: plan.facts, plan: renderPlan, assetsDir: dirs.assets, sessionsDir: dirs.sessions, signal: opts.signal,
      tour: tourOnDisk ?? undefined, takes: takesUsed,
      ...(brief.recipe === "ProductPromo" ? { promoCandidates: promoCandidates({ ...planInput, facts: plan.facts, takes: takesUsed }).candidates } : {}),
      staticSite: profile.kind === "static-site" || planned.goal === "sitetour",
      ...(spoken && spoken.length > 0 ? { captions: captionPhrases(captionCards(spoken)) } : {}),
    });
    const checks = review.checks;
    checksOf.set(comp.id, { brief: briefId, checks });
    const full = review;
    await writeJson(`${base}.review.json`, full);

    /*
      Twelve tiles, always: the cuts first (that is where a piece is decided), then
      evenly spaced seconds to fill the grid, sorted — a sheet padded with black tiles
      reads as a broken video to the model looking at it.
    */
    const total = review.measured.seconds;
    const even = Array.from({ length: 12 }, (_, i) => Math.round(((i * total) / 12) * 100) / 100);
    const atCuts = renderPlan ? renderPlan.cuts.map((c) => Math.round((c.frame / fps) * 100) / 100).filter((s) => s > 0 && s < total - 0.2) : [];
    /* A promo's review sheet must show its payoff and destination, not just the
       before-states at its cuts. Otherwise a correct film can look like empty UI. */
    const results = brief.recipe === "ProductPromo" ? (renderPlan?.uses ?? []).map((use) =>
      Math.min(use.to - 1, use.resultFrame + Math.floor(fps * (use.treatment === "focus" ? 0.9 : 0.42))) / fps) : [];
    const sourceExamples = brief.recipe === "ProductPromo" ? (renderPlan?.texts ?? []).filter((text) => text.kind === "terminal" || text.kind === "code") : [];
    const recap = brief.recipe === "ProductPromo" ? renderPlan?.texts?.filter((text) => text.kind === "recap").at(-1) : undefined;
    const effectFrames = [...sourceExamples, ...(recap ? [recap] : [])].map((text) =>
      Math.min(text.to - 1, (text.readFrom ?? text.from) + Math.ceil(fps * 0.7)) / fps);
    const close = brief.recipe === "ProductPromo" ? renderPlan?.cards.find((card) => card.id === "end") : undefined;
    const picked = [0, ...results, ...effectFrames, ...(close ? [(close.from + Math.min(6, close.to - close.from - 1)) / fps] : [])];
    for (const s of atCuts) if (picked.length < 12 && !picked.some((p) => Math.abs(p - s) < 0.2)) picked.push(s);
    for (const s of even) if (picked.length < 12 && !picked.some((p) => Math.abs(p - s) < 0.5)) picked.push(s);
    const seconds = picked.sort((x, y) => x - y).slice(0, 12);
    let sheet: string | undefined;
    try {
      sheet = (await contactSheet(out, { seconds, out: `${base}.sheet.jpg` })).file;
    } catch {
      sheet = undefined;
    }

    const words = matrix.words.get(comp.id);
    if (words && words.length > 0) {
      const cues = cuesFromWords(words);
      await writeFile(`${base}.srt`, toSrt(cues));
      await writeFile(`${base}.vtt`, toVtt(cues));
      await writeFile(`${base}.txt`, toTranscript(cues));
    }
    provenance.review = { status: full.status, file: `${base}.review.json` };
    await writeFile(`${base}.provenance.json`, provenanceJson(provenance));
    if (needsDisclosure(provenance)) report.disclose.push(comp.id);

    let kit: string | undefined;
    if (until === "final" || selection.length === 1) {
      say("kit", `kit for ${comp.id}`);
      try {
        const hook = brief.hooks.find((h) => comp.id.split("--")[1] === h.id) ?? brief.hooks[0];
        const shown = expandBrief(brief, plan.facts);
        const shownHook = shown.hooks.find((h) => h.id === hook.id) ?? hook;
        /* The post copy, by the brain when there is one and it stayed inside the facts; the template's otherwise. */
        const copy = brain ? ((await kitFor(brain, { thesis, brief: shown, hook: shownHook, lang, targets, facts: plan.facts })) ?? undefined) : undefined;
        kit = await writeKit(
          { id: comp.id, brief: shown, hook: shownHook, lang, formatId: formatId as FormatId },
          { kitsDir: ws.paths.kits, assetsDir: dirs.assets, sessionsDir: dirs.sessions, sheet: false, chapters: matrix.chapters.get(comp.id), copy, comp, renderStill, renderFrames, heroFrame },
        );
        if (sheet) await copyFile(sheet, join(kit, "sheet.jpg"));
      } catch (e) {
        failures.push(`${comp.id} kit: ${(e as Error).message.split("\n")[0]}`);
      }
    }

    const row: RenderRow = {
      id: comp.id,
      file: out,
      review: { status: full.status, failing: checks.filter((c) => c.status === "fail"), file: `${base}.review.json` },
      sheet,
      seconds: review.measured.seconds,
      lufs: review.measured.lufs,
      kit,
      provenance: `${base}.provenance.json`,
    };
    report.renders.push(row);
    if (!report.reference) report.reference = row;
  }

  const held = withheld.length > 0 ? ` Withheld until their claims are fixed: ${withheld.join(", ")}.` : "";
  /* The count closes the phrase, and the phrase is still a sentence: "rendered 1 of 1 cuts" would inflect a word against a digit. */
  const tally = `rendered, of the cuts selected: ${rendered} of ${selection.length}`;
  stages.render = failures.length === 0 ? stage("done", `${tally}.${held}`) : stage(rendered > 0 ? "done" : "failed", `failed: ${failures.join("; ")}.${held} And ${tally}`, { tool: "panoma_video_render", args: { project_path: profile.root } });
  const worst = report.renders.map((r) => r.review.status).includes("fail") ? "fail" : report.renders.some((r) => r.review.status === "warn") ? "warn" : "pass";
  /* The worst status leads, then each cut with its own; a cut that is the only one does not say its status twice. */
  const perCut = report.renders.map((r) => `${r.id}${r.review.failing.length > 0 ? ` (${r.review.failing.map((c) => c.id).join(", ")})` : ""}${report.renders.length > 1 ? ` — ${r.review.status}` : ""}`).join(" · ");
  stages.review = stage("done", `${worst} · ${perCut}`);

  /*
    The fix pass. A check that names the words as the problem — a claim without a
    fact, a caption that reads too fast — is handed to the brain with the brief, and
    its rewrite is kept beside the brief as a fix. Then the same run is made again on
    the takes already on disk: every stage is keyed on its inputs, so only the cuts
    whose words changed render again. Once, by default: a second pass that still
    fails is a report, not a loop.
  */
  const fixes = opts.fixes ?? 1;
  if (brain && fixes > 0 && !aborted()) {
    const byBrief = new Map<string, ReviewCheck[]>();
    for (const entry of checksOf.values()) {
      const fixable = fixableChecks(entry.checks);
      if (fixable.length > 0) byBrief.set(entry.brief, [...(byBrief.get(entry.brief) ?? []), ...fixable]);
    }
    let rewritten = 0;
    for (const [briefId, checks] of byBrief) {
      const planned = renderable.find((b) => b.brief.id === briefId);
      if (!planned) continue;
      const named = [...new Set(checks.map((c) => c.id))].join(", ");
      if (planned.brief.recipe === "ProductPromo") {
        // The general rewrite has no proof menu and its patches are not a promo
        // choice. Replaying it would either detach the claim or repeat the same cut.
        decisions.push(`fix ${briefId} (${named}): follow the named review fixes and replan the promotion with its proof menu; no generic rewrite was applied`);
        continue;
      }
      say("review", `asking ${brain.driver} to fix ${briefId}: ${named}`);
      try {
        const fixed = await fixFor(brain, { thesis, brief: planned.brief, goal: planned.goal, facts: plan.facts, checks, langs });
        const changes = Object.keys(fixed.patch.lines ?? {}).length + Object.keys(fixed.patch.hooks ?? {}).length + (fixed.patch.drop?.length ?? 0);
        for (const r of fixed.refused) decisions.push(`refused in ${r.brief}/${r.line} (${r.lang}): ${JSON.stringify(r.token)} — ${r.why}`);
        if (changes === 0) {
          decisions.push(`fix ${briefId} (${named}): nothing the audit would accept — ${fixed.why}`);
          continue;
        }
        await writeBrainPatch(ws, briefId, (f) => ({ ...f, fixes: [...f.fixes, fixed.patch] }));
        decisions.push(`fix ${briefId} (${named}): ${fixed.why}`);
        rewritten++;
      } catch (e) {
        decisions.push(`fix ${briefId} (${named}): ${brain.driver} did not answer (${(e as Error).message.split("\n")[0]})`);
      }
    }
    if (rewritten > 0) {
      const spent = brain.ledger();
      /* `force` was for the walk and the takes; carried into this pass it would render every cut again, not only the rewritten ones. */
      const again = await auto({ ...opts, force: false, fixes: fixes - 1, camera: false });
      if (again.brain) {
        again.brain.decisions = [...decisions, `fix pass: rendered again with the rewritten words`, ...again.brain.decisions];
        again.brain.calls += spent.calls;
        again.brain.cached += spent.cached;
        again.brain.failed += spent.failed;
      }
      return again;
    }
  }
  return finish();
}

/** Loudness of a mastered file, for the CLI's summary line. */
export { loudness };
