/*
  Studio's project adapter. Preview, revisions and exports all build the actual
  composition matrix from the same fact-bound brief. No browser-only draft exists.
*/
import { existsSync } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { disclosureText, expandBrief, needsDisclosure, postKitMarkdown, provenanceJson, type Brief, type FactSheet, type ReviewReport } from "@panoma/video-core";
import { renderBrand, type BrandProfile } from "@panoma/video-brand";
import { withHouseTheme, type Direction } from "@panoma/video-brand/direction";
import type { ProjectProfile } from "@panoma/video-scout";
import type { SessionLog } from "@panoma/video-capture";
import type { TourScript } from "@panoma/video-tour";
import { ensureSfx, master, writeBed } from "@panoma/video-audio";
import type { BrainChoice } from "@panoma/video-brain";
import { directionOf } from "./look.ts";
import { openBrainFor, type BrainFile } from "./brain.ts";
import { assessPromo, promoCandidates, type PromoDecision, type PromoForInput } from "./promo.ts";
import { applySavedPromoRevision, readPromoRevision, revisePromo, promoChoiceFromBrief, type PromoRevisionContext, type PromoRevisionRequest } from "./promo-revisions.ts";
import { parseBrief } from "./schema.ts";
import { validatePromoVariants } from "./promo-validation.ts";
import { reviewComposition } from "./render-review.ts";
import { exportProvenance } from "./export-provenance.ts";
import { captureReviewContext } from "./export-review.ts";
import { engineRuntimeKey } from "./runtime-key.ts";
import { readCreationManifest, restrictCreationMatrix } from "./creation-settings.ts";
import { inputHash, listFiles, openWorkspace, readJson, videoHome, writeJson, type Workspace } from "./workspace.ts";

export type StudioExportResult = {
  out: string; seconds: number; lufs?: string; provenance: string; disclose: boolean;
  review: { status: ReviewReport["status"]; file: string; checks: { id: string; status: ReviewReport["checks"][number]["status"]; summary: string; fix: { by: NonNullable<ReviewReport["checks"][number]["fix"]>["by"]; hint: string } }[] };
  outputs: string[];
};

/** An encoded cut was produced but failed its review; keep its evidence inspectable. */
export class StudioExportReviewError extends Error {
  readonly exported: StudioExportResult;
  constructor(exported: StudioExportResult) {
    super(`Export needs correction: ${exported.review.checks.filter(check => check.status === "fail").map(check => check.summary).join("; ")}. Report: ${exported.review.file}`);
    this.name = "StudioExportReviewError";
    this.exported = exported;
  }
}

export function promoSourceKey(profile: Pick<ProjectProfile, "root">, takes: readonly SessionLog[]): string {
  return inputHash("recording", profile.root, takes.map((take) => [take.name, take.take, take.recordedAt, take.head]));
}

export async function studioWorkspace(projectId: string, home = videoHome(), options: { prepareAudio?: boolean; projectRoot?: string } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(projectId)) throw new Error("Invalid workspace id.");
  const dir = join(home, "projects", projectId);
  const [profile, factFile] = await Promise.all([
    readJson<ProjectProfile>(join(dir, "profile.json")), readJson<FactSheet>(join(dir, "facts.json")),
  ]);
  if (!profile || !factFile) throw new Error("This project has no plan yet. Create a promotion first.");
  const facts = factFile;
  /* The workspace must sit outside the filmed project; `openWorkspace` is the one door that refuses it, and it refuses before writing anything. */
  const ws = await openWorkspace(options.projectRoot ?? profile.root, { id: projectId, home });
  const creation = await readCreationManifest(ws.dir);
  if (ws.dir !== dir) throw new Error("The workspace id does not match its directory.");
  const [brand, chosen, tour, brain, decision] = await Promise.all([
    readJson<BrandProfile>(ws.paths.brand), readJson<{ direction: Direction }>(ws.paths.direction),
    readJson<TourScript>(join(ws.paths.tours, `${ws.id}.json`)), readJson<BrainFile>(ws.paths.brain),
    readJson<PromoDecision>(join(ws.dir, "promo.json")),
  ]);
  const takes: SessionLog[] = [];
  for (const file of await listFiles(ws.paths.sessions, ".session.json")) {
    const take = await readJson<SessionLog>(file);
    if (take && take.name === ws.id) takes.push(take);
  }
  const raw: Brief[] = [];
  for (const file of await listFiles(ws.paths.briefs, ".json")) {
    if (/\.(?:patch|brain)\.json$/.test(file)) continue;
    const value = await readJson<Record<string, unknown>>(file);
    if (!value) continue;
    const { origin, goal, ...rest } = value;
    void origin; void goal;
    if (creation && !creation.selection.briefIds.includes(String(rest.id))) continue;
    const parsed = parseBrief(rest);
    raw.push(parsed);
  }
  const direction = chosen?.direction ? withHouseTheme(chosen.direction) : (brand ? directionOf(brand, tour) : undefined);
  const inputFor = (brief: Brief): PromoForInput => ({ profile, facts, tour: tour ?? undefined, takes, langs: brief.langs as ("en" | "es")[], thesis: brain?.thesis, music: brief.music, direction });
  const contextFor = (brief: Brief): PromoRevisionContext => ({ brief, input: inputFor(brief), sourceKey: promoSourceKey(profile, takes) });
  const contexts = new Map(raw.filter((brief) => brief.recipe === "ProductPromo").map((brief) => [brief.id, contextFor(brief)]));
  const effective: Brief[] = [];
  for (const brief of raw) effective.push(brief.recipe === "ProductPromo" ? await applySavedPromoRevision(ws, contexts.get(brief.id)!) : brief);
  const dirs = { assets: ws.dir, sessions: ws.paths.sessions, generated: ws.paths.generated, sfx: ws.paths.sfx,
    ...(brand ? { brand: renderBrand(brand, ws.dir) } : {}), ...(direction ? { direction } : {}) };
  await import("@panoma/video-engine/register");
  const { buildCompositions } = await import("@panoma/video-render/compositions");
  const build = (briefs: Brief[]) => restrictCreationMatrix(buildCompositions(briefs.map((brief) => expandBrief(brief, facts)), dirs,
    { formats: creation?.selection.formats }), creation);
  let matrix = build(effective);
  const newSfx = options.prepareAudio !== false && await ensureSfx(ws.paths.sfx);
  let newBed = false;
  for (const bed of matrix.beds.values()) if (options.prepareAudio !== false && !existsSync(bed.path)) {
    await mkdir(join(bed.path, ".."), { recursive: true });
    writeBed(bed.opts, bed.path);
    newBed = true;
  }
  if (newBed || newSfx) matrix = build(effective);
  if (creation && options.prepareAudio !== false) {
    if (effective.some(brief => brief.recipe !== creation.selection.recipe)) throw new Error("The saved video configuration no longer matches its selected recipe.");
    const expected = effective.reduce((count, brief) => count + brief.hooks.length * creation.selection.langs.length * creation.selection.formats.length, 0);
    if (!expected || matrix.compositions.length !== expected || matrix.mismatched.size) throw new Error("The saved video configuration needs a matching take and composition in every selected format.");
    if (creation.selection.voice === "on" && matrix.compositions.some(comp => !(matrix.words.get(comp.id)?.length))) throw new Error("The selected narration is not mounted in every video. Complete the voice assets before opening or exporting this production.");
  }
  const context = (id: string) => {
    const found = contexts.get(id.split("--")[0]);
    if (!found) throw new Error("Scene revisions are available for ProductPromo. Select a promotion.");
    return found;
  };
  const document = async (id: string) => {
    const current = await readPromoRevision(ws, context(id));
    const input = inputFor(current.brief), menu = promoCandidates(input);
    const choice = promoChoiceFromBrief(current.brief);
    const first = choice.proofs[0], original = decision?.selected[0];
    const argument = decision?.argument;
    const sameProof = first && original && first.id === original.id && argument?.proof === first.id &&
      first.facts.length === original.facts.length && first.facts.every(fact => original.facts.includes(fact)) && argument.facts.every(fact => first.facts.includes(fact));
    return { ...current, editorial: assessPromo(input, menu.facts, menu.candidates, { ...choice, audience: decision?.audience ?? choice.audience, tension: decision?.tension ?? choice.tension,
      ...(sameProof ? { argument } : {}) }),
      originalArgument: decision?.argument, argumentScope: "original-plan" as const,
      project: { id: ws.id, name: brand?.name || profile.name } };
  };
  const validate = (brief: Brief) => validatePromoVariants({ brief, material: inputFor(brief), dirs });
  const revisions = new Map<string, string>();
  for (const brief of effective) if (brief.recipe === "ProductPromo") revisions.set(brief.id, (await document(brief.id)).revision);
  const filePaths = [...new Set([
    ...takes.flatMap(take => [take.video, ...(take.frames ?? []).map(entry => entry.file), ...(take.elements ?? []).map(entry => entry.file),
      ...(take.macros ?? []).flatMap(entry => [entry.file, entry.after?.file, entry.afterControl?.file].filter((file): file is string => Boolean(file)))])
      .map(file => isAbsolute(file) ? file : join(ws.paths.sessions, file)),
    ...matrix.compositions.flatMap(comp => comp.audio.map(clip => clip.path)),
    ...(brand?.logo?.file ? [brand.logo.file] : []),
  ])];
  const signatures = await Promise.all(filePaths.map(async file => {
    const media = await stat(file, { bigint: true }).catch(() => null);
    return [file, media && [String(media.size), String(media.mtimeNs), String(media.ctimeNs), String(media.ino)]];
  }));
  const runtime = await engineRuntimeKey();
  const fingerprint = inputHash("studio-v2", runtime, effective, facts, takes, signatures, brand, direction, [...matrix.words], creation);
  return {
    ws, profile, facts, takes, tour, dirs, raw: effective, matrix, fingerprint, document, creation,
    async revise(id: string, request: PromoRevisionRequest, choice?: BrainChoice, signal?: AbortSignal) {
      const opened = request.instruction ? await openBrainFor(ws, choice, signal) : { brain: null };
      return revisePromo(ws, context(id), request, { brain: opened.brain ?? undefined, validate, signal });
    },
    kit(id: string) {
      const [briefId, hookId, lang, format] = id.split("--");
      const brief = effective.find((brief) => brief.id === briefId);
      const hook = brief?.hooks.find((hook) => hook.id === hookId);
      if (!brief || !hook) throw new Error("Unknown composition.");
      return postKitMarkdown(expandBrief(brief, facts), expandBrief(brief, facts).hooks.find((entry) => entry.id === hook.id)!, lang, format as "h" | "v" | "s", { chapters: matrix.chapters.get(id) });
    },
    async render(id: string, onProgress: (done: number, total: number) => void, signal?: AbortSignal, renderOptions: { force?: boolean } = {}) {
      const comp = matrix.compositions.find((comp) => comp.id === id);
      const brief = effective.find((brief) => brief.id === id.split("--")[0]);
      if (!comp || !brief) throw new Error("Unknown composition.");
      signal?.throwIfAborted();
      if (brief.recipe === "ProductPromo") await validate(brief);
      const fresh = await studioWorkspace(ws.id, home, { prepareAudio: options.prepareAudio, projectRoot: options.projectRoot });
      if (fresh.fingerprint !== fingerprint) throw new Error("The story or its assets changed after this preview loaded. Refresh the studio before exporting.");
      const revision = revisions.get(brief.id) ?? fingerprint;
      const base = join(ws.paths.renders, `${id}--r-${revision}-${fingerprint.slice(0, 8)}`);
      const out = `${base}.mp4`, pending = `${base}.pending.mp4`;
      const key = inputHash(fingerprint, comp.id);
      const cached = !renderOptions.force && existsSync(out) && (await readJson<{ key: string }>(`${base}.export.json`))?.key === key;
      const provenance = await exportProvenance({ brief, facts, comp, takes, ws, profile,
        assetsDir: dirs.assets, engine: runtime, hasVoice: (matrix.words.get(id)?.length ?? 0) > 0,
        bedFile: matrix.beds.get(id)?.path, reviewFile: `${base}.review.json` });
      const { renderComposition } = await import("@panoma/video-engine");
      try {
        if (!cached) {
          await renderComposition(comp, { out: pending, assetsDir: dirs.assets, sessionsDir: dirs.sessions, onProgress, signal,
            metadata: { comment: disclosureText(provenance) } });
          signal?.throwIfAborted();
          if (comp.audio.length) await master(pending);
          signal?.throwIfAborted();
          await rename(pending, out);
        } else onProgress(comp.durationInFrames, comp.durationInFrames);
        const plan = matrix.plans.get(id);
        const { captionCards, captionPhrases } = await import("@panoma/video-render/timing");
        const spoken = matrix.words.get(id);
        const reviewInput = { file: out, comp, brief, facts, plan, takes, assetsDir: dirs.assets, sessionsDir: dirs.sessions, signal, tour: tour ?? undefined,
          staticSite: profile.kind === "static-site", ...(spoken?.length ? { captions: captionPhrases(captionCards(spoken)) } : {}),
          ...(brief.recipe === "ProductPromo" ? { promoCandidates: promoCandidates(inputFor(brief)).candidates } : {}) };
        const review = await reviewComposition(reviewInput);
        signal?.throwIfAborted();
        const reviewContext = await captureReviewContext({ ...reviewInput, review });
        const current = await studioWorkspace(ws.id, home, { prepareAudio: options.prepareAudio, projectRoot: options.projectRoot });
        if (current.fingerprint !== fingerprint) throw new Error("The story changed during export. The previous version remains intact; export the current story again.");
        await writeJson(`${base}.review.json`, review);
        await writeJson(`${base}.plan.json`, plan);
        provenance.review = { status: review.status, file: `${base}.review.json` };
        const provenanceFile = `${base}.provenance.json`;
        await writeFile(provenanceFile, provenanceJson({ ...provenance, revision, brief, key } as typeof provenance));
        await writeJson(`${base}.export.json`, { key, revision, compositionId: id, brief, project: profile.id, sources: facts, review: `${base}.review.json`, provenance: provenanceFile, disclose: needsDisclosure(provenance), reviewContext });
        await writeFile(`${base}.kit.md`, this.kit(id));
        const exported: StudioExportResult = { out, seconds: comp.durationInFrames / comp.fps, lufs: review.measured.lufs?.toFixed(1), provenance: provenanceFile, disclose: needsDisclosure(provenance),
          review: { status: review.status, file: `${base}.review.json`, checks: review.checks.map(check => ({ id: check.id, status: check.status, summary: check.summary, fix: { by: check.fix?.by ?? "none", hint: check.fix?.hint ?? "" } })) }, outputs: [`${base}.review.json`, `${base}.kit.md`, `${base}.plan.json`, provenanceFile] };
        if (review.status === "fail") throw new StudioExportReviewError(exported);
        return exported;
      } finally { await rm(pending, { force: true }); }
    },
  };
}

export type StudioWorkspace = Awaited<ReturnType<typeof studioWorkspace>>;
