/*
  Briefs from what actually happened in a repository. The heuristics are pure — the
  CLI feeds them git data, an optional model rewrites the hooks later — so the worst
  case (no network, no key, no model) still yields honest drafts with real numbers in
  them. Real numbers are the point: "47 commits" hooks, "since Tuesday" does not.

  Copy rule, enforced by test: sentences end on their number ("Commits this month:
  47"), never inflect a word against a digit ("47 commits" in running text is fine in
  English, but the pattern that has broken nine times is the n=1 case — so templates
  put the number last, where grammar cannot touch it).
*/
import type { Brief } from "./brief.ts";

export type RepoStats = {
  /** Directory name of the repository. */
  name: string;
  /** Commits in the window. */
  commits: number;
  /** The window, in days. */
  days: number;
  /** Commit subjects, newest first. */
  subjects: string[];
  /** Most recent tag, if any. */
  lastTag?: string;
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function draftBriefs(stats: RepoStats): Brief[] {
  const fixes = stats.subjects.filter((s) => /\bfix|\barregl|\bcorrig/i.test(s)).length;
  const drafts: Brief[] = [];

  drafts.push({
    id: `${slug(stats.name)}-pace`,
    recipe: "KineticQuote",
    langs: ["en", "es"],
    bpm: 120,
    fps: 30,
    hooks: [
      {
        id: "pace",
        text: {
          en: `Days: ${stats.days}. Commits: ${stats.commits}.`,
          es: `Días: ${stats.days}. Commits: ${stats.commits}.`,
        },
      },
    ],
    lines: [
      { id: "what", text: { en: `All of it went into ${stats.name}.`, es: `Todo fue a parar a ${stats.name}.` } },
      { id: "why", text: { en: "Built in the open. No shortcuts.", es: "Construido en abierto. Sin atajos." } },
      { id: "brand", text: { en: stats.name, es: stats.name } },
    ],
    tags: [slug(stats.name)],
  });

  if (fixes > 0) {
    drafts.push({
      id: `${slug(stats.name)}-fixes`,
      recipe: "TerminalRun",
      langs: ["en", "es"],
      bpm: 120,
      fps: 30,
      hooks: [
        {
          id: "fixes",
          text: {
            en: `Bugs that died this week: ${fixes}`,
            es: `Bugs que murieron esta semana: ${fixes}`,
          },
        },
      ],
      lines: [
        { id: "cmd", text: { en: `git log --oneline --since="${stats.days} days"`, es: `git log --oneline --since="${stats.days} days"` } },
        ...stats.subjects
          .filter((s) => /\bfix|\barregl|\bcorrig/i.test(s))
          .slice(0, 4)
          .map((s, i) => ({ id: `s${i}`, text: { en: s, es: s } })),
        { id: "sum", text: { en: `Shipped fixes: ${fixes}`, es: `Arreglos publicados: ${fixes}` } },
      ],
      tags: [slug(stats.name)],
    });
  }

  if (stats.lastTag) {
    drafts.push({
      id: `${slug(stats.name)}-release`,
      recipe: "KineticQuote",
      langs: ["en", "es"],
      bpm: 120,
      fps: 30,
      hooks: [
        {
          id: "release",
          text: {
            en: `${stats.name} ${stats.lastTag} is out.`,
            es: `${stats.name} ${stats.lastTag} ya está fuera.`,
          },
        },
      ],
      lines: [
        {
          id: "count",
          text: {
            en: `Commits behind this release: ${stats.commits}`,
            es: `Commits detrás de esta versión: ${stats.commits}`,
          },
        },
        { id: "try", text: { en: "Try it today.", es: "Pruébala hoy." } },
        { id: "brand", text: { en: stats.name, es: stats.name } },
      ],
      tags: [slug(stats.name), "release"],
    });
  }

  return drafts;
}
