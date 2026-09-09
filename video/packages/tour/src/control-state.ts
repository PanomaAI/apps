import type { Page } from "playwright";

/**
 * Selection and disclosure can be visible without being exposed through ARIA.
 * Read a finite vocabulary from real controls; never rewrite the page or promote
 * a CSS class into an accessible name, result heading or product claim.
 */
export async function controlState(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selector = 'button,input,select,textarea,a[href],summary,[role="button"],[role="tab"],[role="checkbox"],[role="radio"],[role="switch"],[role="option"],[role="menuitem"],[role="treeitem"]';
    const states: string[] = [];
    const vocabulary = new Set(["active", "inactive", "selected", "unselected", "open", "closed", "checked", "unchecked", "indeterminate", "expanded", "collapsed", "on", "off"]);
    let ordinal = 0;
    const visit = (root: Document | ShadowRoot) => {
      for (const element of Array.from(root.querySelectorAll("*"))) {
        if (element.shadowRoot) visit(element.shadowRoot);
        if (!element.matches(selector) || !element.getClientRects().length) continue;
        const style = getComputedStyle(element);
        if (style.visibility === "hidden" || style.visibility === "collapse" || element.closest('[aria-hidden="true"],[inert]')) continue;
        const at = ordinal++;
        const observed: string[] = [];
        for (const token of Array.from(element.classList)) {
          if (/^(?:is[-_])?(?:selected|active|open|checked|expanded)$/.test(token)) observed.push(`class:${token}`);
        }
        const data = element.getAttribute("data-state");
        if (data && vocabulary.has(data)) observed.push(`data-state:${data}`);
        for (const attribute of ["aria-selected", "aria-checked", "aria-expanded", "aria-pressed", "aria-disabled"]) {
          const value = element.getAttribute(attribute);
          if (value === "true" || value === "false" || value === "mixed") observed.push(`${attribute}:${value}`);
        }
        if (element.matches(":disabled")) observed.push("native:disabled");
        if (element.matches(":checked")) observed.push("native:checked");
        if (element instanceof HTMLInputElement && element.indeterminate) observed.push("native:indeterminate");
        if (element instanceof HTMLElement && element.tagName === "SUMMARY" && element.parentElement?.matches("details[open]")) observed.push("native:open");
        if (observed.length) states.push(`${at}:${element.tagName}:${observed.sort().join(",")}`);
      }
    };
    visit(document);
    return states;
  });
}
