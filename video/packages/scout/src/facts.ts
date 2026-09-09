/*
  The fact sheet: every string a generated video is allowed to state about a project,
  each with a stable id and a literal source. This is the supply side of the
  `{{fact:id}}` contract in @panoma/video-core — a brief line that says "install with
  {{fact:cmd.install}}" gets the README's own line, at README.md:14, and a line that
  states a number no fact carries is refused by `auditClaims`.

  Ids are stable across runs of the same repository state: `readme.tagline`,
  `pkg.version`, `git.commits.30d`, `route.docs`, `changelog.added.1`. A director
  template can reference them by name without reading the sheet first.

  `notFacts` are the things that look like facts and must not be quoted: TODO and
  FIXME lines, roadmap bullets, README sections titled Roadmap or Coming soon. They
  are kept, not dropped, so the audit can say "this sentence quotes a plan as if it
  had shipped" — the failure regulators pulled the Apple and Google demo videos for.

  This reader never opens a `.env` file (fs.ts refuses), and it is synchronous on
  purpose: the git facts arrive in the profile, so a sheet costs a few file reads.
*/
import { isDisplayableSource, type Fact, type FactSheet } from "@panoma/video-core";
import { join } from "node:path";
import { exists, readJson, readText, slug, walk } from "./fs.ts";
import { parseChangelog, parseReadme } from "./markdown.ts";
import type { ProjectProfile } from "./types.ts";

type NotFact = FactSheet["notFacts"][number];

/** README sections whose bullets are plans, not shipped features. */
const ROADMAP_TITLE = /\b(roadmap|coming soon|planned|future|next up|todo|to do|wishlist|upcoming|ideas)\b/i;
/** README sections that are housekeeping, never a feature to narrate. */
const HOUSEKEEPING_TITLE = /^(license|licence|contributing|contributors|acknowledg\w*|credits|changelog|table of contents|authors?|sponsors?|support|security|code of conduct)$/i;
const CHANGELOG_NAMES = ["CHANGELOG.md", "CHANGELOG", "changelog.md", "CHANGES.md", "HISTORY.md"];
const ROADMAP_FILES = ["ROADMAP.md", "roadmap.md", "TODO.md", "docs/ROADMAP.md", "docs/roadmap.md"];
const TODO_MARK = /\b(TODO|FIXME|XXX|HACK)\b[:\s-]*(.*)$/;
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|dart|vue|svelte|astro|css|scss|md|mdx|yaml|yml|toml|sh|sql|html)$/i;
/** Caps: a TODO census is context, not a catalogue; and the walk must stay cheap on a big tree. */
const MAX_NOT_FACTS = 40;
const MAX_TODO_FILES = 3000;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_VALUE = 200;
/** A code slide quotes a complete readable example; shortening code would change its meaning. */
const NON_CODE_LANGUAGE = /^(?:|sh|bash|zsh|fish|shell|shell-session|console|terminal|powershell|ps1|pwsh|bat|batch|cmd|dos|text|txt|plaintext|plain|output|log|logs|diff|patch|md|markdown|mdx|mermaid)$/i;
const UNSAFE_EXAMPLE = /(?:\b(?:TODO|FIXME|XXX|HACK)\b|\brm\s+-[rf]|\b(?:DROP|TRUNCATE)\s+(?:TABLE|DATABASE)\b|\b(?:execSync|execFileSync|spawnSync|os\.system|subprocess\.(?:run|call|Popen)|shutil\.rmtree)\s*\(|\b(?:eval|exec)\s*\(|\bcurl\b[^\n]*\|\s*(?:sh|bash)\b)/i;

const clip = (s: string) => (s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE - 1)}…` : s);

function manifestFacts(root: string, profile: Omit<ProjectProfile, "facts">): Fact[] {
  const out: Fact[] = [];
  const pkg = readJson<{ name?: string; description?: string; version?: string }>(join(root, "package.json"));
  if (pkg) {
    if (pkg.name) out.push({ id: "pkg.name", kind: "text", value: pkg.name, source: "package.json#name" });
    if (pkg.description) out.push({ id: "pkg.description", kind: "text", value: pkg.description, source: "package.json#description" });
    if (pkg.version) out.push({ id: "pkg.version", kind: "version", value: pkg.version, source: "package.json#version" });
  } else {
    const file = ["Cargo.toml", "pyproject.toml", "pubspec.yaml"].find((f) => exists(join(root, f)));
    if (file) {
      out.push({ id: "pkg.name", kind: "text", value: profile.name, source: `${file}#name` });
      if (profile.description) out.push({ id: "pkg.description", kind: "text", value: profile.description, source: `${file}#description` });
      if (profile.version) out.push({ id: "pkg.version", kind: "version", value: profile.version, source: `${file}#version` });
    }
  }
  if (profile.framework) {
    out.push({ id: "framework.name", kind: "text", value: profile.framework.name, source: profile.framework.source });
    if (profile.framework.version) out.push({ id: "framework.version", kind: "version", value: profile.framework.version, source: profile.framework.source });
  }
  return out;
}

function readmeFacts(root: string): { facts: Fact[]; notFacts: NotFact[]; file?: string } {
  const file = ["README.md", "readme.md", "README"].find((f) => exists(join(root, f)));
  const text = file ? readText(join(root, file)) : undefined;
  if (!file || text === undefined) return { facts: [], notFacts: [] };
  const r = parseReadme(text);
  const facts: Fact[] = [];
  const notFacts: NotFact[] = [];
  if (r.title) facts.push({ id: "readme.title", kind: "text", value: r.title.text, source: `${file}:${r.title.line}` });
  if (r.tagline) facts.push({ id: "readme.tagline", kind: "text", value: clip(r.tagline.text), source: `${file}:${r.tagline.line}` });
  const seen = new Set<string>();
  for (const s of r.sections) {
    if (ROADMAP_TITLE.test(s.title)) {
      for (const b of s.bullets) notFacts.push({ value: clip(b.text), source: `${file}:${b.line}`, why: `README section "${s.title}" is a plan` });
      continue;
    }
    if (HOUSEKEEPING_TITLE.test(s.title)) continue;
    let id = `readme.section.${slug(s.title)}`;
    if (seen.has(id)) id = `${id}.${s.line}`;
    seen.add(id);
    facts.push({ id, kind: "feature", value: s.title, source: `${file}:${s.line}` });
  }
  r.commands.forEach((c, i) => {
    const block = r.code.find((block) => c.line >= block.line && c.line < block.line + block.text.split("\n").length);
    if (!block || block.headings.some((heading) => ROADMAP_TITLE.test(heading) || HOUSEKEEPING_TITLE.test(heading))) return;
    if (!isDisplayableSource(c.text)) return;
    facts.push({ id: i === 0 ? "cmd.install" : `cmd.${i + 1}`, kind: "command", value: c.text, source: `${file}:${c.line}` });
  });
  r.code.forEach((c, i) => {
    if (NON_CODE_LANGUAGE.test(c.language) || c.headings.some((h) => ROADMAP_TITLE.test(h) || HOUSEKEEPING_TITLE.test(h))) return;
    const lines = c.text.split("\n");
    if (!c.text.trim() || lines.length > 8 || c.text.length > 400 || lines.some((l) => l.length > 70)) return;
    if (r.commands.some((command) => command.line >= c.line && command.line < c.line + lines.length)) return;
    if (!isDisplayableSource(c.text) || UNSAFE_EXAMPLE.test(c.text)) return;
    facts.push({ id: `code.readme.${i + 1}`, kind: "code", value: c.text, source: `${file}:${c.line}` });
  });
  return { facts, notFacts, file };
}

function changelogFacts(root: string): Fact[] {
  const file = CHANGELOG_NAMES.find((f) => exists(join(root, f)));
  const text = file ? readText(join(root, file)) : undefined;
  if (!file || !text) return [];
  const c = parseChangelog(text);
  if (!c) return [];
  const out: Fact[] = [{ id: "changelog.version", kind: "version", value: c.version, source: `${file}:${c.line}` }];
  if (c.date) out.push({ id: "changelog.date", kind: "date", value: c.date, source: `${file}:${c.line}` });
  const counters = new Map<string, number>();
  for (const g of c.groups) {
    for (const item of g.items) {
      const n = (counters.get(g.name) ?? 0) + 1;
      counters.set(g.name, n);
      out.push({ id: `changelog.${g.name}.${n}`, kind: g.name === "added" ? "feature" : "text", value: clip(item.text), source: `${file}:${item.line}` });
    }
  }
  return out;
}

function gitFacts(git: ProjectProfile["git"]): Fact[] {
  if (!git) return [];
  const out: Fact[] = [
    { id: `git.commits.${git.days}d`, kind: "number", value: String(git.commits), source: `git:log:--since=${git.days} days` },
  ];
  if (git.lastTag) out.push({ id: "git.lastTag", kind: "version", value: git.lastTag, source: `git:tag:${git.lastTag}` });
  git.tags.forEach((t, i) => {
    out.push({ id: `git.tag.${i + 1}`, kind: "version", value: t.name, source: `git:tag:${t.name}` });
    if (t.date) out.push({ id: `git.tag.${i + 1}.date`, kind: "date", value: t.date, source: `git:tag:${t.name}` });
  });
  return out;
}

function routeFacts(routes: ProjectProfile["routes"]): Fact[] {
  const seen = new Set<string>();
  return routes.map((r) => {
    let id = r.path === "/" ? "route.root" : `route.${slug(r.path)}`;
    if (seen.has(id)) id = `${id}.${seen.size}`;
    seen.add(id);
    return { id, kind: "route", value: r.path, source: r.source } satisfies Fact;
  });
}

function roadmapNotFacts(root: string): NotFact[] {
  const out: NotFact[] = [];
  const files = ROADMAP_FILES.filter((f) => exists(join(root, f)));
  for (const f of walk(join(root, "docs"), { maxDepth: 1, maxFiles: 200 })) if (/^roadmap.*\.md$/i.test(f)) files.push(`docs/${f}`);
  for (const file of [...new Set(files)]) {
    const text = readText(join(root, file));
    if (!text) continue;
    text.split(/\r?\n/).forEach((line, i) => {
      const m = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.*\S)\s*$/.exec(line);
      if (m) out.push({ value: clip(m[1]), source: `${file}:${i + 1}`, why: "roadmap item" });
    });
  }
  return out;
}

function todoNotFacts(root: string): NotFact[] {
  const out: NotFact[] = [];
  for (const rel of walk(root, { maxFiles: MAX_TODO_FILES })) {
    if (out.length >= MAX_NOT_FACTS) break;
    if (!SOURCE_EXT.test(rel) || /^(CHANGELOG|README|ROADMAP|TODO)/i.test(rel)) continue;
    const text = readText(join(root, rel));
    if (!text || text.length > MAX_FILE_BYTES) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && out.length < MAX_NOT_FACTS; i++) {
      const m = TODO_MARK.exec(lines[i]);
      if (!m) continue;
      const value = m[2].replace(/\*\/\s*$|-->\s*$/, "").trim();
      if (value) out.push({ value: clip(value), source: `${rel}:${i + 1}`, why: `${m[1]} in source` });
    }
  }
  return out;
}

/** The sheet for a profile. Synchronous: git data is already in the profile. */
export function factSheet(root: string, profile: Omit<ProjectProfile, "facts"> | ProjectProfile): FactSheet {
  const readme = readmeFacts(root);
  const facts: Fact[] = [
    ...manifestFacts(root, profile),
    ...readme.facts,
    ...changelogFacts(root),
    ...gitFacts(profile.git),
    ...routeFacts(profile.routes),
  ];
  if (profile.url) {
    const pkgHome = readJson<{ homepage?: string }>(join(root, "package.json"))?.homepage;
    const line = readme.file ? readText(join(root, readme.file))?.split(/\r?\n/).findIndex((l) => l.includes(profile.url!)) ?? -1 : -1;
    const source = pkgHome === profile.url ? "package.json#homepage" : line >= 0 ? `${readme.file}:${line + 1}` : "README.md";
    facts.push({ id: "url", kind: "url", value: profile.url, source });
  }
  const ids = new Set<string>();
  const unique = facts.filter((f) => (ids.has(f.id) ? false : (ids.add(f.id), true)));
  const notFacts = [...readme.notFacts, ...roadmapNotFacts(root), ...todoNotFacts(root)].slice(0, MAX_NOT_FACTS * 2);
  return {
    project: profile.name,
    extractedAt: new Date().toISOString(),
    head: profile.git?.head,
    facts: unique,
    notFacts,
  };
}
