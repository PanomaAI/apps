/*
  @panoma/video-director — the automatic path. A project goes in; reviewed videos come out.

  The pieces: a workspace under PANOMA_VIDEO_HOME for everything the engine makes about a
  project, the plan that turns facts and a tour into briefs (story-bound, audited), the
  templates those briefs speak with, the JSON contracts an agent writes against, and
  the pipeline that runs scout, brand, tour, record, plan, render and review in order
  with every stage cached on its inputs.
*/
export { videoHome, projectIdFor, openWorkspace, readJson, writeJson, listFiles, inputHash, inside } from "./workspace.ts";
export type { Workspace } from "./workspace.ts";
export { trailerBrief, spotlightBrief, tutorialBrief, factsBrief, polishable } from "./templates.ts";
export { TUTORIAL_MIN_STEPS } from "./templates.ts";
export type { Slots, Lang, TutorialMark } from "./templates.ts";
export { BriefSchema, LineSchema, BriefPatchSchema, RECIPES, parseBrief, parsePatch } from "./schema.ts";
export { planBriefs, enrichFacts, slotsOf, momentsOf, rankedClaims, detectLang, missingMarks, isName } from "./plan.ts";
export type { PlanInput, PlannedBrief, Plan } from "./plan.ts";
export { storyChecks, CPS_MAX, CPS_WARN } from "./story-checks.ts";
export type { CaptionPhrase } from "./story-checks.ts";
export { directionOf, directionFor, flowsOf, clampChoice } from "./look.ts";
export type { DirectionFile, DirectionPick, DirectionForInput } from "./look.ts";
export { PROMO_VERSION, PROMO_THEMES, parsePromoTheme, retainedPromoTheme, proposePromoTheme, promoCandidates, planPromo, promoFor } from "./promo.ts";
export type { PromoForInput, PromoThemeRequest, PromoThemeDecision, PromoCandidate, PromoRefusal, PromoDecision, PromoResult } from "./promo.ts";
export { mapSvg, layerOf } from "./map.ts";
export { applyBrandPatch, readBrandPatch, BRAND_PATCH_FILE } from "./brand-patch.ts";
export type { BrandPatch, PatchResult } from "./brand-patch.ts";
export { writeStudy, readStudy, materialOf, paletteSvg, wordmarkSvg, STUDY_VERSION } from "./study.ts";
export type { StudyIndex, StudyInput, MarkMaterial, Gap, GapBy, ShotKind } from "./study.ts";
export type { MapOptions } from "./map.ts";
export { writeKit } from "./kit.ts";
export type { KitEntry } from "./kit.ts";
export { auto, nothingPlanned, OWN_COPY_HINT, onOrigin, isLoopback, stepsOnOrigin, tourOnOrigin } from "./auto.ts";
export { narrate, spokenLines, collidingIds, charCost, DEFAULT_VOICE, NARRATION_CHAR_CAP } from "./narrate.ts";
export { openBrainFor, thesisFor, rerankFor, routerFor, chooserFor, brollFor, writeFor, fixFor, fixableChecks, kitFor, sanitizePatch, numbersVouched, readBrainPatches, writeBrainPatch, viewOf, momentsView, factRows } from "./brain.ts";
export { boardOf, bibleOf, moveBetween, HOLD, BUY_SECONDS } from "./board.ts";
export type { BoardInput } from "./board.ts";
export { shootBoard, BOARD_SECONDS_CAP } from "./shoot.ts";
export type { ShootResult } from "./shoot.ts";
export { contactSheet } from "./sheet.ts";
export type { BrainFile, BrainPatchFile, Refusal, WrittenPlan } from "./brain.ts";
export type { NarrationResult } from "./narrate.ts";
export type { AutoOptions, AutoReport, AutoGoal, AutoUntil, StageName, StageStatus, RenderRow, BrainReport } from "./auto.ts";
export { scoreTrack, describeTrack, pulseOf, TRACK_VERSION } from "./music.ts";
export type { ScoredTrack } from "./music.ts";

export { reviewComposition } from "./render-review.ts";
export { studioWorkspace, promoSourceKey, StudioExportReviewError } from "./studio.ts";
export type { StudioWorkspace, StudioExportResult } from "./studio.ts";
export { normalizeCreationRequest } from "./creation-settings.ts";
export type { CreationRequest, CreationManifest } from "./creation-settings.ts";
export { readPromoRevision, revisePromo, applySavedPromoRevision } from "./promo-revisions.ts";
export type { PromoRevisionContext, PromoRevisionRequest, PromoRevisionDocument } from "./promo-revisions.ts";

export { reviewPromoLayout, promoLayoutSamples } from "./layout-review.ts";
export { assessPromo, rankPromoCandidates, validatePromoChoice, compilePromoChoice } from "./promo.ts";

export { PromoEditSchema, PromoRevisionRequestSchema } from "./promo-revisions.ts";

export { archivePromoRevisions, promoChoiceFromBrief } from "./promo-revisions.ts";
