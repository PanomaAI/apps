/*
  @panoma/video-tour — walk a running product and write its recording script, without a
  model. `writeTour` is the whole product; the rest is exposed so the MCP server,
  the CLI and the tests can read a snapshot, re-rank candidates or convert a
  DevTools recording without driving a browser.
*/
export { writeTour } from "./walk.ts";
export { SCROLL_AT, SCROLL_MS, CLICK_AT, HOLD_MS, AFTER_CLICK_MS, CHROME_MS, readingPause } from "./timing.ts";
export type { WriteTourOptions, Rerank, RerankInput } from "./walk.ts";
export { rewalk } from "./rewalk.ts";
export type { RewalkResult } from "./rewalk.ts";
export { parseSnapshot, stateHash, roleSelector, parseRoleSelector } from "./snapshot.ts";
export type { SnapshotNode, Landmark } from "./snapshot.ts";
export { scoreCandidates, sectionAnchors, pageHeading, slugify, headingSelector } from "./score.ts";
export type { ScoreContext } from "./score.ts";
export { VERBS, CHROME, CONSENT_ORDER, DESTRUCTIVE, EXTERNAL, matchLexicon, isDestructive, isChrome, isExternal, verbOf } from "./lexicon.ts";
export { toUserFlow, fromUserFlow, toRecorderSelectors, fromRecorderSelectors } from "./flow.ts";
export { tourSummary } from "./summary.ts";
export { readAtlas, atlasText, keywords, pathShape, ATLAS_BUDGET, ATLAS_VERSION } from "./atlas.ts";
export type { Atlas, AtlasScreen, AtlasControl, AtlasBudget, ReadAtlasOptions } from "./atlas.ts";
export { writeLesson, routeFromWords, lessonSummary, LESSON_STEPS, LESSON_HOLD_MS } from "./lesson.ts";
export { slateOf, slateText, noTutorialBecause, routeFromCandidate, SLATE_FLOOR } from "./slate.ts";
export type { Candidate, Angle } from "./slate.ts";
export type { LessonScript, Route, RouteStep, Router, Chooser, WriteLessonOptions } from "./lesson.ts";
export { snapshotPage, settled, openTake, launchBrowser, normalizeUrl, PHONE_UA } from "./browser.ts";
export type { PageSnapshot } from "./browser.ts";
export { DEFAULT_BUDGET, STEP_FLOOR, TOUR_VERSION } from "./types.ts";
export type { ScreenNode, ScreenEdge } from "./types.ts";
export type { TourScript, TourMark, TourCandidate, TourBudget, MarkKind, Box } from "./types.ts";
export type { UserFlow, Step, Selector, ClickStep, NavigateStep, ScrollStep, CustomStep } from "./replay-schema.ts";
