/*
  Line-numbered reading of README.md and CHANGELOG.md. Every fact a video may quote
  must point at a line, so this parser never loses the line number of anything it
  returns — that is the whole reason it exists instead of a markdown library, which
  gives back an AST and forgets where the text came from.

  It understands only what the two files reliably use: ATX headings, fenced code
  blocks, list bullets, badges (`[![…](…)](…)` and `![…](…)` and `<img>`), and the
  Keep a Changelog 1.1.0 layout — `## [x.y.z] - YYYY-MM-DD` sections with Added /
  Changed / Deprecated / Removed / Fixed / Security groups, latest first
  (https://keepachangelog.com/en/1.1.0/).
*/

export type Located = { text: string; line: number };
export type CodeExample = Located & { language: string; headings: string[] };

export type ReadmeParse = {
  title?: Located;
  /** First paragraph after the title, badges stripped, lines joined with a space. */
  tagline?: Located;
  h2: Located[];
  /** Lines inside fenced blocks that install or run something, in order of appearance. */
  commands: Located[];
  /** Complete fenced examples, verbatim, with the first content line and heading ancestry. */
  code: CodeExample[];
  /** Every H2 section with the bullets directly under it (until the next heading). */
  sections: { title: string; line: number; bullets: Located[] }[];
  /** https URLs in prose or badges, in order of appearance. */
  urls: Located[];
};

const BADGE_LINK = /\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g;
const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const HTML_TAG = /<[^>]+>/g;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/;
const INSTALL_LINE = /^\s*(?:\$\s*)?((?:npx|npm (?:i|install|create|exec)|pnpm (?:add|i|install|dlx|create)|yarn (?:add|create|dlx)|bun (?:add|x|create)|bunx|cargo install|pip3? install|pipx install|uv (?:tool install|pip install|add)|brew install|go install|gem install|apt(?:-get)? install|curl -fsSL)\b.*\S)\s*$/;
const URL = /https:\/\/[^\s)\]>"'`]+/g;

export function stripBadges(s: string): string {
  return s.replace(BADGE_LINK, "").replace(IMAGE, "").replace(HTML_TAG, "").trim();
}

/** Inline markdown to plain text: links keep their label, emphasis and code marks go. */
export function plain(s: string): string {
  return stripBadges(s)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseReadme(text: string): ReadmeParse {
  const lines = text.split(/\r?\n/);
  const out: ReadmeParse = { h2: [], commands: [], code: [], sections: [], urls: [] };
  let fence: { marker: string; language: string; line: number; content: string[]; headings: string[] } | undefined;
  const headings: { level: number; title: string }[] = [];
  let paragraph: string[] = [];
  let paragraphStart = 0;
  let taglineDone = false;
  let current: ReadmeParse["sections"][number] | undefined;

  const closeParagraph = () => {
    if (out.title && !taglineDone && paragraph.length) {
      const joined = plain(paragraph.join(" "));
      if (joined) {
        out.tagline = { text: joined, line: paragraphStart };
        taglineDone = true;
      }
    }
    paragraph = [];
  };

  lines.forEach((raw, i) => {
    const line = i + 1;
    for (const m of raw.matchAll(URL)) out.urls.push({ text: m[0].replace(/[.,;:]+$/, ""), line });
    if (fence) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(raw);
      if (close && close[1][0] === fence.marker[0] && close[1].length >= fence.marker.length) {
        out.code.push({ text: fence.content.join("\n"), line: fence.line, language: fence.language, headings: fence.headings });
        fence = undefined;
      } else {
        fence.content.push(raw);
        const m = INSTALL_LINE.exec(raw);
        if (m) out.commands.push({ text: m[1], line });
      }
      return;
    }
    const open = /^\s*(`{3,}|~{3,})([^`~]*)$/.exec(raw);
    if (open) {
      fence = { marker: open[1], language: open[2].trim().split(/\s+/)[0].toLowerCase(), line: line + 1,
        content: [], headings: headings.map((h) => h.title) };
      closeParagraph();
      return;
    }
    const h = HEADING.exec(raw);
    if (h) {
      closeParagraph();
      const level = h[1].length;
      const title = plain(h[2]);
      while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
      headings.push({ level, title });
      if (level === 1 && !out.title) out.title = { text: title, line };
      else if (level === 2) {
        out.h2.push({ text: title, line });
        current = { title, line, bullets: [] };
        out.sections.push(current);
      } else if (level < 2) current = undefined;
      return;
    }
    // A setext title: "Name" underlined with "====". Rare in READMEs but real.
    if (/^=+\s*$/.test(raw) && paragraph.length === 1 && !out.title) {
      out.title = { text: plain(paragraph[0]), line: line - 1 };
      paragraph = [];
      return;
    }
    const b = BULLET.exec(raw);
    if (b && current) {
      const t = plain(b[1]);
      if (t) current.bullets.push({ text: t, line });
      closeParagraph();
      return;
    }
    if (raw.trim() === "") {
      closeParagraph();
      return;
    }
    // Badge-only or html-only lines are not a tagline, and neither is a blockquote or a table.
    const visible = stripBadges(raw);
    if (!visible || /^\s*[>|]/.test(raw)) return;
    if (paragraph.length === 0) paragraphStart = line;
    paragraph.push(visible);
  });
  closeParagraph();
  return out;
}

export type ChangelogParse = {
  version: string;
  date?: string;
  line: number;
  groups: { name: string; items: Located[] }[];
};

const RELEASE = /^##\s+\[?v?(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.]+)?)\]?(?:\s*[-–—]\s*|\s*\(\s*)?(\d{4}-\d{2}-\d{2})?/;
const GROUP = /^###\s+(Added|Changed|Deprecated|Removed|Fixed|Security)\b/i;

/** The newest released section. `[Unreleased]` is skipped: it is a plan, not a release. */
export function parseChangelog(text: string): ChangelogParse | undefined {
  const lines = text.split(/\r?\n/);
  let section: ChangelogParse | undefined;
  let group: ChangelogParse["groups"][number] | undefined;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (FENCE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^##\s/.test(raw)) {
      if (section) break;
      const m = RELEASE.exec(raw);
      if (!m) continue;
      section = { version: m[1], date: m[2], line: i + 1, groups: [] };
      group = undefined;
      continue;
    }
    if (!section) continue;
    const g = GROUP.exec(raw);
    if (g) {
      group = { name: g[1].toLowerCase(), items: [] };
      section.groups.push(group);
      continue;
    }
    const b = BULLET.exec(raw);
    if (b) {
      if (!group) {
        group = { name: "changed", items: [] };
        section.groups.push(group);
      }
      const t = plain(b[1]);
      if (t) group.items.push({ text: t, line: i + 1 });
    }
  }
  return section;
}
