import type { Page } from "playwright";

/** Source-reviewed CSS selectors supplement the action lexicon; a model cannot remove them. */
export function actionDenySelectors(value: readonly string[] = []): string[] {
  if (!Array.isArray(value) || value.length > 64 || value.some(selector => typeof selector !== "string" || !selector.trim() || selector.length > 512)) {
    throw new Error("denySelectors must contain at most 64 nonempty CSS selectors, each at most 512 characters");
  }
  return [...new Set(value.map(selector => selector.trim()))].sort();
}

export async function deniedSelector(page: Page, selector: string, denied: readonly string[] = []): Promise<string | null> {
  if (!denied.length || !(await page.locator(selector).first().count())) return null;
  return page.locator(selector).first().evaluate((element, selectors) => selectors.find(denied => element.closest(denied)) ?? null, [...denied]);
}

/** Rechecked at the actual pointer/focus after motion, immediately before an input. */
export async function assertActionAllowed(page: Page, denied: readonly string[] = [], point?: { x: number; y: number }): Promise<void> {
  if (!denied.length) return;
  const matched = await page.evaluate(({ selectors, point }) => {
    const target = point ? document.elementFromPoint(point.x, point.y) : document.activeElement;
    return target instanceof Element ? selectors.find(selector => target.closest(selector)) ?? null : null;
  }, { selectors: [...denied], point });
  if (matched) throw new Error(`Action refused by source policy: ${matched}`);
}
