/*
  Chrome DevTools Recorder JSON in and out.

  A tour that only exists as panoma video's own step type is trapped: nobody else can
  record one, nobody else can replay one. The Recorder's user-flow JSON is the one
  free, standard, replayable format (@puppeteer/replay, Apache-2.0; the panel in
  every Chrome), so a person records a tour in the browser with nothing installed,
  an agent writes the JSON by hand, and the engine replays both through `recordSession`.

  The mapping is lossless in both directions for what the engine emits. Fields the
  Recorder has no slot for — a step's role, `optional`, `at`, `ms`, `back`,
  `settleMs` — travel in an `engine` property on the step; @puppeteer/replay's parser
  copies the fields it knows and ignores the rest, so the flow still replays in
  Chrome, and `fromUserFlow` reads them back. Steps the engine has no native mapping for
  (`move`, pixel `click`, `press`) round-trip as a `customStep` carrying the step.
*/
import type { SessionStep } from "@panoma/video-capture";
import type { ClickStep, CustomStep, NavigateStep, ScrollStep, Step, UserFlow, WaitForExpressionStep } from "./replay-schema.ts";
import { parseRoleSelector, roleSelector } from "./snapshot.ts";
import type { TourScript } from "./types.ts";

type Meta = Record<string, unknown>;
/*
  `engine` was `vira` until the engine was renamed. A flow written before that carries
  the old key, and Chrome's Recorder round-trips whatever it does not understand, so the
  old name is still read — written, never again. Saved tours keep replaying.
*/
type WithMeta<T> = T & { engine?: Meta; /** @deprecated read-only, for flows written before the rename. */ vira?: Meta };

/*
  The Recorder's own idiom for a wait is a `waitForExpression` that resolves after
  a timeout; writing a pause that way means the flow really pauses when Chrome
  replays it, and the regex below reads the number back.
*/
const pauseExpression = (ms: number): string => `new Promise((resolve) => setTimeout(() => resolve(true), ${ms}))`;
const PAUSE_RE = /^new Promise\(\(resolve\) => setTimeout\(\(\) => resolve\(true\), (\d+)\)\)$/;

/*
  A Playwright selector as the Recorder's alternatives: `aria/Name[role="link"]`
  (the puppeteer aria selector, https://pptr.dev/guides/page-interactions#aria-selectors)
  first, `text/Name` as the fallback a replayer tries when the first goes stale.
  Anything else is passed through: a CSS selector is valid in both worlds.
*/
export function toRecorderSelectors(selector: string): string[] {
  const role = parseRoleSelector(selector);
  if (role) return [`aria/${role.name}[role="${role.role}"]`, `text/${role.name}`];
  if (selector.startsWith("text=")) return [`text/${selector.slice(5)}`];
  if (selector.startsWith("css=")) return [selector.slice(4)];
  if (selector.startsWith("xpath=")) return [`xpath/${selector.slice(6)}`];
  return [selector];
}

/** The first Recorder selector that Playwright can run, as a Playwright selector. */
export function fromRecorderSelectors(selectors: (string | string[])[]): string | null {
  for (const alt of selectors) {
    /* An array lists ancestors first and the target last; the target alone is what Playwright needs. */
    const s = Array.isArray(alt) ? alt[alt.length - 1] : alt;
    if (typeof s !== "string" || !s) continue;
    const aria = /^aria\/(.*?)(?:\[role="([a-z]+)"\])?$/.exec(s);
    if (aria) return aria[2] ? roleSelector(aria[2], aria[1]) : `text=${aria[1]}`;
    if (s.startsWith("text/")) return `text=${s.slice(5)}`;
    if (s.startsWith("xpath/")) return `xpath=${s.slice(6)}`;
    if (s.startsWith("pierce/")) return `css=${s.slice(7)}`;
    return s;
  }
  return null;
}

function metaOf(step: object, keys: string[], selector?: string): Meta | undefined {
  const meta: Meta = {};
  for (const k of keys) {
    const v = (step as Record<string, unknown>)[k];
    if (v !== undefined) meta[k] = v;
  }
  /*
    A selector the Recorder alternatives cannot rebuild — a heading's `[level=2]`,
    say, which puppeteer's aria syntax has no slot for — travels verbatim, so the
    round trip is lossless and Chrome still has its own alternatives to replay.
  */
  if (selector !== undefined && fromRecorderSelectors(toRecorderSelectors(selector)) !== selector) meta.selector = selector;
  return Object.keys(meta).length ? meta : undefined;
}

/** The selector a step should run: the engine's own when it travelled, the Recorder's otherwise. */
function selectorFrom(meta: Meta, selectors: (string | string[])[]): string | null {
  return typeof meta.selector === "string" ? meta.selector : fromRecorderSelectors(selectors);
}

/** Writes the script as a Recorder user flow, one Recorder step per session step. */
export function toUserFlow(script: Pick<TourScript, "name" | "steps" | "marks" | "candidates">): UserFlow {
  const steps: Step[] = [];
  for (const step of script.steps) {
    if ("goto" in step) {
      const s: WithMeta<NavigateStep> = { type: "navigate", url: step.goto, assertedEvents: [{ type: "navigation", url: step.goto }] };
      const meta = metaOf(step, ["settleMs"]);
      if (meta) s.engine = meta;
      steps.push(s);
    } else if ("clickOn" in step) {
      const box = script.candidates.find((c) => c.selector === step.clickOn)?.box;
      const s: WithMeta<ClickStep> = {
        type: "click",
        selectors: toRecorderSelectors(step.clickOn),
        offsetX: box ? Math.round(box.w / 2) : 1,
        offsetY: box ? Math.round(box.h / 2) : 1,
      };
      const meta = metaOf(step, ["role", "optional", "href", "alternate"], step.clickOn);
      if (meta) s.engine = meta;
      steps.push(s);
    } else if ("scrollTo" in step) {
      const s: WithMeta<ScrollStep> = { type: "scroll", selectors: toRecorderSelectors(step.scrollTo) };
      const meta = metaOf(step, ["at", "ms", "optional", "back", "role"], step.scrollTo);
      if (meta) s.engine = meta;
      steps.push(s);
    } else if ("scroll" in step) {
      const s: WithMeta<ScrollStep> = { type: "scroll", y: step.scroll.y };
      const meta = metaOf(step.scroll, ["ms"]);
      if (meta) s.engine = meta;
      if (step.role) s.engine = { ...s.engine, role: step.role };
      steps.push(s);
    } else if ("pause" in step) {
      const s: WithMeta<WaitForExpressionStep> = { type: "waitForExpression", expression: pauseExpression(step.pause) };
      if (step.settled) s.engine = { settled: true };
      steps.push(s);
    } else if ("mark" in step) {
      const m = script.marks.find((x) => x.name === step.mark);
      const s: CustomStep = { type: "customStep", name: "mark", parameters: { name: step.mark, ...(m ? { kind: m.kind, label: m.label } : {}) } };
      steps.push(s);
    } else {
      const s: CustomStep = { type: "customStep", name: "engine", parameters: step };
      steps.push(s);
    }
  }
  return { title: script.name, steps };
}

/** Reads a Recorder user flow back into session steps; steps with no counterpart are skipped. */
export function fromUserFlow(flow: UserFlow): SessionStep[] {
  const out: SessionStep[] = [];
  for (const raw of flow.steps) {
    const step = raw as WithMeta<Step>;
    const meta = step.engine ?? step.vira ?? {};
    switch (step.type) {
      case "navigate":
        out.push({ goto: step.url, ...(typeof meta.settleMs === "number" ? { settleMs: meta.settleMs } : {}) });
        break;
      case "click":
      case "doubleClick": {
        const selector = selectorFrom(meta, step.selectors);
        if (!selector) break;
        out.push({
          clickOn: selector,
          ...(meta.optional === true ? { optional: true } : {}),
          ...(meta.role === "chrome" || meta.role === "product" ? { role: meta.role } : {}),
          /* Where it went, for a take that renders the control without a name — see SessionStep. */
          ...(typeof meta.href === "string" ? { href: meta.href } : {}),
          ...(typeof meta.alternate === "string" ? { alternate: meta.alternate } : {}),
        });
        break;
      }
      case "scroll": {
        if ("selectors" in step && step.selectors) {
          const selector = selectorFrom(meta, step.selectors);
          if (!selector) break;
          out.push({
            scrollTo: selector,
            ...(typeof meta.ms === "number" ? { ms: meta.ms } : {}),
            ...(typeof meta.at === "number" ? { at: meta.at } : {}),
            ...(meta.optional === true ? { optional: true } : {}),
            ...(meta.back === true ? { back: true } : {}),
            ...(meta.role === "chrome" || meta.role === "product" ? { role: meta.role } : {}),
          });
        } else {
          out.push({ scroll: { y: step.y ?? 0, ...(typeof meta.ms === "number" ? { ms: meta.ms } : {}) }, ...(meta.role === "chrome" || meta.role === "product" ? { role: meta.role } : {}) });
        }
        break;
      }
      case "waitForExpression": {
        const m = PAUSE_RE.exec(step.expression);
        if (m) out.push({ pause: Number(m[1]), ...(meta.settled === true ? { settled: true } : {}) });
        break;
      }
      case "customStep": {
        if (step.name === "mark" && step.parameters && typeof step.parameters === "object") {
          const name = (step.parameters as { name?: unknown }).name;
          if (typeof name === "string") out.push({ mark: name });
        } else if ((step.name === "engine" || step.name === "vira") && step.parameters && typeof step.parameters === "object") {
          out.push(step.parameters as SessionStep);
        }
        break;
      }
      case "keyDown":
        out.push({ press: { key: step.key } });
        break;
      case "change": {
        /* The Recorder sets a value on an element; the recorder here types into what is focused, so focus it first. */
        const selector = fromRecorderSelectors(step.selectors);
        if (selector) out.push({ clickOn: selector }, { type: { text: step.value } });
        break;
      }
      default:
        break;
    }
  }
  return out;
}
