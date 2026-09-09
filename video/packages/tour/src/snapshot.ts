/*
  The page as a list of named things, without a model.

  Playwright's `ariaSnapshot({ mode: "ai", boxes: true })` (mode since 1.59, boxes
  since 1.60 — https://playwright.dev/docs/api/class-locator#locator-aria-snapshot)
  is the whole page-understanding layer every browser-agent product sells: one call
  returns role, accessible name, `[ref=eN]`, `[active]`, `[cursor=pointer]` and
  `[box=x,y,w,h]` for every visible element. This module parses that YAML into flat
  nodes and tags each with its nearest landmark, because WAI-ARIA landmarks
  (https://www.w3.org/TR/wai-aria-1.2/#landmark_roles) already say which part of a
  page is navigation, chrome and content — so no model has to.

  Two things the parser refuses to keep: refs and boxes never reach the hash.
  A ref is valid only until the next action in the same process (refs are cached
  on the element and reissued while role and name are unchanged — Playwright's
  packages/injected/src/ariaSnapshot.ts), and a box changes with every scroll. A
  state identity built from either would call the same page a new one, and the
  walker would loop on a no-op click forever.
*/
import { createHash } from "node:crypto";

export type Landmark = "navigation" | "banner" | "main" | "contentinfo" | "complementary" | "form";

const LANDMARKS: ReadonlySet<string> = new Set<Landmark>([
  "navigation",
  "banner",
  "main",
  "contentinfo",
  "complementary",
  "form",
]);

export type SnapshotNode = {
  role: string;
  name: string;
  ref?: string;
  /** Document coordinates once `scrollY` has been added; viewport coordinates otherwise. */
  box?: { x: number; y: number; w: number; h: number };
  /** The nearest landmark ancestor (or the node itself, when it is one). */
  landmark?: Landmark;
  depth: number;
  cursorPointer?: boolean;
  active?: boolean;
  /** The page's observed disabled state, never inferred from a CSS class. */
  disabled?: boolean;
  /** Heading level, when the node is a heading. */
  level?: number;
  /** The `/url:` child of a link, as written in the page. */
  url?: string;
  /** Inline text after the colon, when the node carries any. */
  text?: string;
};

/*
  One line of the snapshot: `- role "name" [attr] [k=v]: text`. The key may arrive
  wrapped in YAML quotes when the name holds characters YAML would misread; the
  name itself is double-quoted with backslash escapes.
*/
function readQuoted(s: string, at: number): { value: string; end: number } {
  const quote = s[at];
  let value = "";
  let i = at + 1;
  while (i < s.length) {
    const c = s[i];
    if (quote === "'" && c === "'") {
      if (s[i + 1] === "'") {
        value += "'";
        i += 2;
        continue;
      }
      return { value, end: i + 1 };
    }
    if (quote === '"' && c === "\\" && i + 1 < s.length) {
      value += s[i + 1];
      i += 2;
      continue;
    }
    if (quote === '"' && c === '"') return { value, end: i + 1 };
    value += c;
    i++;
  }
  return { value, end: i };
}

function parseLine(body: string, depth: number): SnapshotNode | null {
  let key = body;
  let rest = "";
  if (body[0] === "'" || body[0] === '"') {
    const q = readQuoted(body, 0);
    key = q.value;
    rest = body.slice(q.end);
  } else {
    /* The key ends at the first `:` that is followed by a space or the end of the line. */
    let inQuote = false;
    let cut = -1;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === "\\" && inQuote) {
        i++;
        continue;
      }
      if (c === '"') inQuote = !inQuote;
      else if (c === ":" && !inQuote && (i === body.length - 1 || body[i + 1] === " ")) {
        cut = i;
        break;
      }
    }
    if (cut >= 0) {
      key = body.slice(0, cut);
      rest = body.slice(cut);
    }
  }
  let text: string | undefined;
  if (rest.startsWith(":")) {
    const t = rest.slice(1).trim();
    if (t && t !== "|" && t !== ">") text = t[0] === '"' || t[0] === "'" ? readQuoted(t, 0).value : t;
  }

  /* `/url: …` and other property children belong to the parent node. */
  if (key.startsWith("/")) return { role: key, name: "", depth, text };

  let i = 0;
  while (i < key.length && key[i] !== " " && key[i] !== "[") i++;
  const role = key.slice(0, i);
  if (!role) return null;
  const node: SnapshotNode = { role, name: "", depth };
  while (i < key.length && key[i] === " ") i++;
  if (key[i] === '"') {
    const q = readQuoted(key, i);
    node.name = q.value;
    i = q.end;
  }
  const attrs = key.slice(i).matchAll(/\[([^\]=]+)(?:=([^\]]*))?\]/g);
  for (const [, k, v] of attrs) {
    if (k === "ref") node.ref = v;
    else if (k === "active") node.active = true;
    else if (k === "disabled") node.disabled = true;
    else if (k === "cursor" && v === "pointer") node.cursorPointer = true;
    else if (k === "level") node.level = Number(v);
    else if (k === "box") {
      const [x, y, w, h] = (v ?? "").split(",").map(Number);
      if ([x, y, w, h].every(Number.isFinite)) node.box = { x, y, w, h };
    }
  }
  if (text !== undefined) node.text = text;
  return node;
}

/**
 * Parses an aria snapshot (default or ai mode) into flat nodes in document order.
 * `scrollY` turns Playwright's viewport-relative boxes into document coordinates.
 */
export function parseSnapshot(text: string, opts: { scrollY?: number } = {}): SnapshotNode[] {
  const nodes: SnapshotNode[] = [];
  const stack: { depth: number; landmark?: Landmark; node: SnapshotNode }[] = [];
  /*
    Split on CRLF as well as LF. Splitting on "\n" alone leaves a carriage return at
    the end of every line, and `.` in a regular expression never matches one, so
    `(.*)$` cannot reach the end of the string and every single line fails to match:
    the parser returns almost nothing instead of failing. It cost seven tests on the
    first Windows CI run, where Git's `core.autocrlf=true` had rewritten the snapshot
    fixture on checkout. `.gitattributes` settles the checkout; this settles the
    parser, for any snapshot text that reaches it with the other line ending.
  */
  for (const raw of text.split(/\r?\n/)) {
    const m = /^( *)- (.*)$/.exec(raw);
    if (!m) continue;
    const depth = m[1].length / 2;
    const parsed = parseLine(m[2], depth);
    if (!parsed) continue;
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack[stack.length - 1];
    if (parsed.role.startsWith("/")) {
      if (parsed.role === "/url" && parent && parent.depth === depth - 1) parent.node.url = parsed.text ?? "";
      continue;
    }
    if (parsed.box && opts.scrollY) parsed.box = { ...parsed.box, y: parsed.box.y + opts.scrollY };
    const own = LANDMARKS.has(parsed.role) ? (parsed.role as Landmark) : undefined;
    parsed.landmark = own ?? parent?.landmark;
    nodes.push(parsed);
    stack.push({ depth, landmark: parsed.landmark, node: parsed });
  }
  return nodes;
}

/*
  The identity of a page state: roles and names in document order, plus optional
  observed selection/disclosure state from controls in the live document.
  Two snapshots that differ only in refs, boxes, focus or cursor hash the same,
  which is what lets the walker see that a click changed nothing and that a link
  led somewhere it has already been (the state-flow idea of Crawljax, in one line).
*/
export function stateHash(nodes: SnapshotNode[], controls: readonly string[] = []): string {
  const h = createHash("sha256");
  for (const n of nodes) h.update(`${n.depth}${n.role}${n.name}\n`);
  for (const control of controls) h.update(`control:${control}\n`);
  return h.digest("hex").slice(0, 16);
}

/*
  The persisted form of a target. `role=link[name="Docs"s]` is the documented role
  selector with the `s` suffix for a case-sensitive, whole-name match
  (https://playwright.dev/docs/other-locators#role-selector); without it the name
  is a case-insensitive substring, and "Docs" would also be "Docs and guides". Refs
  are deliberately absent: they die with the process that issued them.
*/
export function roleSelector(role: string, name: string, level?: number): string {
  const quoted = JSON.stringify(name);
  return `role=${role}[name=${quoted}s]${level ? `[level=${level}]` : ""}`;
}

/** The inverse of `roleSelector`, for the flow converter; null for any other selector. */
export function parseRoleSelector(selector: string): { role: string; name: string; level?: number } | null {
  const m = /^role=([a-z]+)\[name=("(?:[^"\\]|\\.)*")s?\](?:\[level=(\d+)\])?$/.exec(selector);
  if (!m) return null;
  let name: string;
  try {
    name = JSON.parse(m[2]) as string;
  } catch {
    return null;
  }
  return { role: m[1], name, ...(m[3] ? { level: Number(m[3]) } : {}) };
}
