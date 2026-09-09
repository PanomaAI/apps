/*
  The scaffold. A recorded session already knows what the tutorial's steps ARE —
  they are its marks, in order — so the only thing a person has to supply is the
  sentences. This writes the draft with the structure filled in and the words left
  blank, which is the difference between "write a tutorial brief" and "fill in four
  sentences in two languages".

  Like `panoma-video ideate`, it writes to briefs/drafts and registers nothing. A draft that
  auto-published itself would be a machine choosing what this project says.
*/
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionLog } from "@panoma/video-capture";

/** Every take of a session, newest last, by the file names the recorder writes. */
export async function takesOf(sessionsDir: string, name: string): Promise<SessionLog[]> {
  const files = (await readdir(sessionsDir).catch(() => [] as string[]))
    .filter((f) => f.startsWith(`${name}.`) && f.endsWith(".session.json"))
    .sort();
  const logs: SessionLog[] = [];
  for (const file of files) logs.push(JSON.parse(await readFile(join(sessionsDir, file), "utf8")) as SessionLog);
  return logs;
}

/**
 * Do the takes of one session agree about their marks?
 *
 * They can differ, because a take may bring its own steps — a portrait layout hides
 * behind a menu the desktop layout shows outright — and a mark that exists in one
 * take and not the other produces a tutorial that renders in 16:9 and fails in 9:16,
 * discovered at the end of a launch. Cheap to check the moment the takes are shot.
 */
export function markMismatch(takes: SessionLog[]): string | null {
  if (takes.length < 2) return null;
  const names = takes.map((t) => (t.marks ?? []).map((m) => m.name).join(","));
  if (new Set(names).size === 1) return null;
  return takes.map((t, i) => `  ${t.take}: ${names[i] || "(none)"}`).join("\n");
}

const quote = (s: string) => JSON.stringify(s);

export async function scaffoldTutorial(opts: {
  name: string;
  sessionsDir: string;
  outDir: string;
  langs: string[];
  today: string;
}): Promise<{ path: string; marks: string[] }> {
  const takes = await takesOf(opts.sessionsDir, opts.name);
  if (takes.length === 0) {
    throw new Error(`No take of session "${opts.name}" on disk. Record it first: panoma-video record ${opts.name}`);
  }
  const marks = (takes[0].marks ?? []).map((m) => m.name);
  if (marks.length === 0) {
    throw new Error(
      `Session "${opts.name}" has no marks, so there are no steps to narrate. Add \`{ mark: "..." }\` ` +
        `steps to briefs/sessions/index.ts and re-record it.`,
    );
  }

  const langs = opts.langs;
  const perLang = (indent: string, value: string) =>
    langs.map((l) => `${indent}${l}: ${quote(value)},`).join("\n");

  const body = `/*
  A tutorial draft for session "${opts.name}", scaffolded from its ${marks.length} ${marks.length === 1 ? "mark" : "marks"}.

  Write the sentences. A step's \`text\` is what the narrator SAYS — the clock is built
  from how long it takes to say it — and its \`label\` is the two or three words that
  ride the step chip. Lines without a mark are the closing card.

  NOT auto-registered: move it into briefs/index.ts when it deserves to exist.
*/
import type { Brief } from "@panoma/video-core";

export const drafts: Brief[] = [
  {
    id: ${quote(`${opts.name}-tutorial`)},
    recipe: "Tutorial",
    langs: [${langs.map(quote).join(", ")}],
    bpm: 120,
    fps: 30,
    session: ${quote(opts.name)},
    /* The pain, asked as a question. Several, because the feed votes on hooks. */
    hooks: [
      {
        id: "tired",
        text: {
${perLang("          ", "")}
        },
      },
    ],
    lines: [
${marks
  .map(
    (mark, i) => `      {
        id: ${quote(`step${i + 1}`)},
        mark: ${quote(mark)},
        label: {
${perLang("          ", "")}
        },
        text: {
${perLang("          ", "")}
        },
      },`,
  )
  .join("\n")}
      /* No mark: the closing card. */
      {
        id: "cta",
        text: {
${perLang("          ", "")}
        },
      },
    ],
    tags: ["tutorial"],
  },
];
`;

  await mkdir(opts.outDir, { recursive: true });
  const path = join(opts.outDir, `${opts.today}-${opts.name}-tutorial.ts`);
  await writeFile(path, body);
  return { path, marks };
}
