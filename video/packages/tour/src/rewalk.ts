/*
  The mobile re-walk: the same script, run again under the phone camera, so that
  ONE step list serves both takes.

  Every vendor crops a desktop capture into a phone-shaped hole; panoma video records the
  product's own portrait layout, and that layout hides things — the navigation
  folds into a button, a secondary link disappears. A script written on the
  desktop take would then die at the first hidden target under the mobile camera,
  or, worse, a tutorial pinned to a mark only one take carries would render in
  16:9 and fail in 9:16. So the re-walk resolves every target on the mobile take
  and repairs the script rather than forking it:

  - a target hidden behind a collapsed navigation gets the menu button inserted
    before it as an optional chrome step (optional: on the desktop take the button
    is not rendered, and the recorder skips an optional step whose target is gone);
  - a target that is simply not there becomes `optional: true`, so the step is
    skipped on this take and its mark still fires, on both takes, in the same order.

  Nothing is removed and no mark moves, which is the whole point.
*/
import { deniedSelector, type SessionStep, type SessionTake } from "@panoma/video-capture";
import type { Browser, Page } from "playwright";
import { boxOf, openTake, scrollToTarget, settle, targetAbsent, targetDisappeared } from "./browser.ts";
import { parseSnapshot, roleSelector } from "./snapshot.ts";
import type { TourCandidate } from "./types.ts";
import { CHROME_MS, SCROLL_AT, SCROLL_MS } from "./timing.ts";

type Targeted = Extract<SessionStep, { clickOn: string } | { scrollTo: string }>;

const selectorOf = (s: SessionStep): string | null =>
  "clickOn" in s ? s.clickOn : "scrollTo" in s ? s.scrollTo : null;

/*
  The button that unfolds a collapsed navigation: a button in the banner or the
  navigation landmark that carries `aria-expanded`, which is how WAI-ARIA says
  "this controls something that opens" (https://www.w3.org/TR/wai-aria-1.2/#aria-expanded).
  Its selector is built from the accessible name, like every other target.
*/
async function findMenu(page: Page, denySelectors: readonly string[]): Promise<string | null> {
  for (const scope of ["role=banner", "role=navigation", "css=header"]) {
    /* Two locator calls, not one `>>` chain: a comma union inside a chain is split on `>>` first. */
    const loc = page.locator(scope).locator("button[aria-expanded], [role=button][aria-expanded]");
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const snap = await el.ariaSnapshot({ mode: "ai" }).catch(() => "");
      const node = parseSnapshot(snap).find((x) => x.role === "button" && x.name.trim());
      if (node) {
        const selector = roleSelector("button", node.name);
        if (!(await deniedSelector(page, selector, denySelectors))) return selector;
      }
    }
  }
  return null;
}

/**
 * Whether the last `scrollTo` this take ran went back up by more than the recorder's guard
 * allows. The walk measures that on the first take and flags the step `back`; this take has
 * its own layout — a phone stacks what the desktop put side by side — so the same step can go
 * back here and not there. Measured on 12-Sep-2026: a catalog's «List view» button sat above
 * the section marked before it on the phone, and the mobile take died on the guard the
 * re-walk had never armed.
 */
let lastScrollWentBack = false;

async function run(page: Page, step: Targeted, denySelectors: readonly string[]): Promise<boolean> {
  lastScrollWentBack = false;
  if ("clickOn" in step) {
    if (await deniedSelector(page, step.clickOn, denySelectors)) return true;
    await page
      .locator(step.clickOn)
      .first()
      .click({ timeout: 4000 })
      .catch(() => undefined);
    await settle(page);
    return true;
  }
  const box = await boxOf(page, step.scrollTo);
  if (!box) return !(await targetAbsent(page, step.scrollTo));
  try {
    const moved = await scrollToTarget(page, step.scrollTo, { at: step.at ?? SCROLL_AT });
    lastScrollWentBack = moved.backward;
    return true;
  } catch (error) {
    if (!(await targetDisappeared(page, step.scrollTo, error))) throw error;
    return false;
  }
}

export type RewalkResult = {
  steps: SessionStep[];
  notes: TourCandidate[];
  /*
    Marks whose action this take cannot perform.

    The step list is shared by every take, so a control the phone does not render
    becomes an optional step that is simply skipped there — while its mark still
    fires, because a mark is a moment in the script and not a thing on the page. The
    footage then never changes at that moment in this take, and a sentence that says
    what the click DID is false in that cut. The names come back so the plan can say
    less there rather than something untrue.
  */
  unreachedMarks: string[];
};

/**
 * Re-runs `steps` on `take`, returning the repaired list (menu steps inserted,
 * missing targets optional) and one note per repair, as a candidate with score 0
 * so the summary can list what changed and why.
 */
export async function rewalk(
  browser: Browser,
  take: SessionTake,
  steps: SessionStep[],
  colorScheme: "light" | "dark",
  denySelectors: readonly string[] = [],
): Promise<RewalkResult> {
  const { context, page } = await openTake(browser, take, colorScheme);
  const out: SessionStep[] = [];
  const notes: TourCandidate[] = [];
  const unreached: string[] = [];
  /* The walker writes `{ mark }` and then the approach and the click it names. */
  let current: string | null = null;
  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if ("mark" in step) current = step.mark;
      if ("goto" in step) {
        out.push(step);
        await page.goto(step.goto, { waitUntil: "networkidle" });
        await settle(page);
        continue;
      }
      const selector = selectorOf(step);
      if (selector === null) {
        out.push(step);
        continue;
      }
      /*
        A scrollTo immediately followed by a clickOn of the same selector is the
        walker's approach-then-click; the menu must open BEFORE the approach, and
        both halves share one fate.
      */
      const group: Targeted[] = [step as Targeted];
      let j = i + 1;
      for (; j < Math.min(i + 3, steps.length); j++) {
        const s = steps[j];
        if ("pause" in s) continue;
        if ("clickOn" in s && s.clickOn === selector && "scrollTo" in step) group.push(s);
        break;
      }
      const isGroup = group.length > 1;
      const tail = isGroup ? steps.slice(i + 1, j + 1) : [];

      let present = (await boxOf(page, selector)) !== null;
      /*
        The same destination, rendered without a name.

        A phone's navigation is a row of icons: the link to /bridge is still a link to
        /bridge and still goes there, but it carries no accessible name, so a selector
        built from the desktop's name matches nothing. Measured on a real application,
        where it cost the vertical cut three narrated instructions over a picture that
        never moved. Where the name fails and the destination is the same, the
        destination is the identity — and the repaired selector replaces the old one in
        the shared list, because it is true of both takes.
      */
      let repaired: SessionStep = step;
      if (!present) {
        const alternate = group.map(target => "alternate" in target ? target.alternate : undefined).find(Boolean);
        if (alternate && (await page.locator(alternate).count()) === 1 && (await boxOf(page, alternate)) !== null && !(await deniedSelector(page, alternate, denySelectors))) {
          present = true;
          repaired = { ...step, ...("clickOn" in step ? { clickOn: alternate } : { scrollTo: alternate }) } as SessionStep;
          for (let k = 0; k < group.length; k++) group[k] = { ...group[k], ...("clickOn" in group[k] ? { clickOn: alternate } : { scrollTo: alternate }) } as Targeted;
          notes.push({ selector: alternate, description: `responsive label for "${selector}" on the ${take.id} take`, method: "click", box: (await boxOf(page, alternate))!, score: 0,
            reasons: ["same exact element: the desktop-verified alternate also resolves uniquely on this take"] });
        }
      }
      if (!present) {
        const href = group.map((g) => ("href" in g ? g.href : undefined)).find(Boolean);
        const byHref = href ? `css=a[href="${href}"]` : null;
        if (byHref && (await boxOf(page, byHref)) !== null) {
          present = true;
          repaired = { ...step, ...("clickOn" in step ? { clickOn: byHref } : { scrollTo: byHref }) } as SessionStep;
          for (let k = 0; k < group.length; k++) group[k] = { ...group[k], ...("clickOn" in group[k] ? { clickOn: byHref } : { scrollTo: byHref }) } as Targeted;
          notes.push({
            selector: byHref,
            description: `"${selector}" has no accessible name on the ${take.id} take`,
            method: "clickOn" in step ? "click" : "scrollTo",
            box: (await boxOf(page, byHref)) ?? { x: 0, y: 0, w: 0, h: 0 },
            score: 0,
            reasons: ["found by its destination instead: the control is rendered without a name on this take, and a link to the same place is the same control"],
          });
        }
      }
      if (!present && !(step as Targeted).optional) {
        const menu = await findMenu(page, denySelectors);
        if (menu) {
          await page.locator(menu).first().click({ timeout: 2000 }).catch(() => undefined);
          await page.waitForTimeout(300);
          present = (await boxOf(page, selector)) !== null;
          if (present) {
            out.push(
              { scrollTo: menu, at: SCROLL_AT, ms: SCROLL_MS, back: true, optional: true },
              { clickOn: menu, optional: true, role: "chrome" },
              { pause: CHROME_MS },
            );
            notes.push({
              selector: menu,
              description: `menu button on the ${take.id} take, opened before "${selector}"`,
              method: "click",
              box: (await boxOf(page, menu)) ?? { x: 0, y: 0, w: 0, h: 0 },
              score: 0,
              reasons: ["inserted as an optional chrome step: the navigation is collapsed on this take"],
            });
          } else {
            /* Not behind the menu after all; close it again so the state matches the desktop walk. */
            await page.locator(menu).first().click({ timeout: 2000 }).catch(() => undefined);
          }
        }
      }

      if (present && group.some(s => "clickOn" in s) && (await deniedSelector(page, selectorOf(repaired)!, denySelectors))) {
        present = false;
        notes.push({ selector, description: `source policy on the ${take.id} take`, method: "click", box: { x: 0, y: 0, w: 0, h: 0 }, score: 0, reasons: ["source policy refuses this control on this take"] });
      }
      // Presence was checked before the approach. A responsive control may have
      // disappeared since then; give the whole approach/click group the same fate.
      const disappeared = present && !(await run(page, repaired as Targeted, denySelectors));
      if (disappeared) present = false;
      /* The approach went back up on this take: the shared step says so, which only permits it. */
      if (present && "scrollTo" in repaired && lastScrollWentBack && repaired.back !== true) {
        repaired = { ...repaired, back: true as const };
        notes.push({ selector: selectorOf(repaired)!, description: `"${selector}" is above the previous mark on the ${take.id} take`, method: "scrollTo",
          box: (await boxOf(page, selectorOf(repaired)!)) ?? { x: 0, y: 0, w: 0, h: 0 }, score: 0,
          reasons: ["flagged back: this take's layout puts the target above where the last step left the page"] });
      }
      if (!present) {
        /* A click this take will skip: whatever the mark it belongs to was seen to do, it does not do it here. */
        if (current && group.some((s) => "clickOn" in s) && !unreached.includes(current)) unreached.push(current);
        for (const s of group) {
          if (!s.optional || disappeared) {
            notes.push({
              selector: disappeared ? selectorOf(repaired)! : selector,
              description: `"${selector}" is missing on the ${take.id} take`,
              method: "clickOn" in s ? "click" : "scrollTo",
              box: { x: 0, y: 0, w: 0, h: 0 },
              score: 0,
              reasons: [disappeared
                ? "made optional: target disappeared after it was observed, so the approach and click are skipped on this take"
                : "made optional: the target is not rendered on this take, so the step is skipped there and its mark survives"],
            });
          }
        }
        out.push({ ...step, optional: true } as SessionStep);
        for (const s of tail) out.push("clickOn" in s || "scrollTo" in s ? ({ ...s, optional: true } as SessionStep) : s);
        i = isGroup ? j : i;
        continue;
      }

      out.push(repaired);
      for (const s of tail) {
        const fixed = repaired === step ? s : ({ ...s, ...("clickOn" in s ? { clickOn: selectorOf(repaired)! } : { scrollTo: selectorOf(repaired)! }) } as SessionStep);
        out.push(fixed);
        if ("clickOn" in fixed || "scrollTo" in fixed) await run(page, fixed as Targeted, denySelectors);
      }
      i = isGroup ? j : i;
    }
  } finally {
    await context.close();
  }
  return { steps: out, notes, unreachedMarks: unreached };
}
