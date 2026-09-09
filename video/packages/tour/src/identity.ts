import type { Page } from "playwright";

/** An alternate for this exact element, never a selector guessed from its screen position. */
export async function alternateSelector(page: Page, original: string): Promise<string | undefined> {
  const target = page.locator(original).first();
  if (!(await target.count())) return undefined;
  const identity = await target.evaluate(element => {
    const selectors: string[] = [];
    if (element.id) selectors.push(`#${CSS.escape(element.id)}`);
    const tag = element.tagName.toLowerCase();
    for (const name of ["data-testid", "data-test", "data-cy", "name"]) {
      const value = element.getAttribute(name);
      if (value) selectors.push(`${tag}[${name}=${JSON.stringify(value)}]`);
    }
    const text = element.textContent?.replace(/\s+/g, " ").trim();
    if (text && text.length <= 160) selectors.push(`${tag}:has-text(${JSON.stringify(text)})`);
    return selectors;
  });
  for (const selector of identity) {
    const candidate = page.locator(`css=${selector}`);
    if ((await candidate.count()) !== 1) continue;
    const same = await target.evaluate((element, selector) => {
      // Playwright's text pseudo-class is checked by the locator equality below.
      return selector.includes(":has-text(") || element.matches(selector);
    }, selector);
    if (!same) continue;
    const candidateHandle = await candidate.elementHandle();
    if (!candidateHandle) continue;
    try { if (await target.evaluate((element, other) => element === other, candidateHandle)) return `css=${selector}`; }
    finally { await candidateHandle.dispose(); }
  }
  return undefined;
}
