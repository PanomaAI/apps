/*
  The sentences an automatic brief may say, and no others.

  The reference trailers have no sentences at all — music, type cards of two to five
  words, a wordmark — so the automatic trailer is wordless: a kicker, a theme line if
  a fact fits in six words, the claim cards the story layer bound to proof, a counted
  ticker, a status line, an end card. The tutorial narrates one short imperative per
  step built from the interface's own names. Every slot is a fact reference that
  panoma video expands verbatim; the templates carry no digits and no adjectives, and the
  number always closes its sentence. What a person or a model can do afterwards is
  rewrite any of these through a patch, under the same audit.

  Two languages ship. A third is a new column here, not new code.
*/
import type { Brief, Line, BoundPair } from "@panoma/video-core";

/** Fact ids the templates may reference, resolved by the director from the sheet. */
export type Slots = {
  readonly name: string;
  readonly version?: string;
  readonly tagline?: string;
  /** The tagline's language, when it has one: it is quoted only in that track. */
  readonly taglineLang?: string;
  readonly headlineLang?: string;
  readonly install?: string;
  readonly url?: string;
  readonly docs?: string;
  readonly fixes?: string;
  readonly commits?: string;
  readonly ctaName?: string;
  readonly headline?: string;
};

export type Lang = "en" | "es";

const ref = (id: string) => `{{fact:${id}}}`;

const T = {
  ticker: { en: (f: string) => `Fixes and improvements: ${ref(f)}`, es: (f: string) => `Arreglos y mejoras: ${ref(f)}` },
  status: { en: "Available now.", es: "Ya disponible." },
  whatsNew: { en: (n: string, v: string) => `What's new in ${ref(n)} ${ref(v)}`, es: (n: string, v: string) => `Novedades de ${ref(n)} ${ref(v)}` },
  commitsBehind: { en: (c: string) => `Commits behind this release: ${ref(c)}`, es: (c: string) => `Commits detrás de esta versión: ${ref(c)}` },
  running: { en: (n: string) => `This is ${ref(n)} running.`, es: (n: string) => `Esto es ${ref(n)} en marcha.` },
  installOne: { en: "Install it with one command.", es: "Instálalo con un comando." },
  click: { en: (c: string) => `Click ${ref(c)}.`, es: (c: string) => `Pulsa ${ref(c)}.` },
  result: { en: "This is the result.", es: "Este es el resultado." },
  docs: { en: (d: string) => `Docs: ${ref(d)}.`, es: (d: string) => `Documentación: ${ref(d)}.` },
  labelOpen: { en: "Open it", es: "Ábrelo" },
  labelClick: { en: "One click", es: "Un clic" },
  labelResult: { en: "The result", es: "El resultado" },
  labelInstall: { en: "Install", es: "Instala" },
  /*
    The half of a tutorial sentence every automatic tool has to invent: what the
    thing you just clicked DID. panoma video does not invent it — the walker refuses a click
    that changes nothing, and the heading the page showed afterwards is on the mark,
    so these say it and cite the page.
  */
  startOn: { en: (u: string) => `Start on ${ref(u)}.`, es: (u: string) => `Empieza en ${ref(u)}.` },
  startHere: { en: "Start here.", es: "Empieza aquí." },
  then: { en: (u: string) => `Then ${ref(u)}.`, es: (u: string) => `Después, ${ref(u)}.` },
  clickOpens: { en: (c: string, r: string) => `Click ${ref(c)} and ${ref(r)} opens.`, es: (c: string, r: string) => `Pulsa ${ref(c)} y se abre ${ref(r)}.` },
  openReach: { en: (c: string, r: string) => `Open ${ref(c)} and you land on ${ref(r)}.`, es: (c: string, r: string) => `Abre ${ref(c)} y llegas a ${ref(r)}.` },
  tryIt: { en: (u: string) => `Try it yourself: ${ref(u)}`, es: (u: string) => `Pruébalo tú: ${ref(u)}` },
  labelNext: { en: "Next", es: "Después" },
} as const;

/*
  How many steps a tutorial needs before its sections stop earning one.

  A step that scrolls to a heading shows the product saying something; a step that
  clicks shows it doing something, and a tutorial is about doing. So the actions are
  the piece, and the sections are only allowed in to give a short one a body — below
  the floor the demo-tour vendors publish (Navattic's 5, docs/tour.md), which is
  where a piece stops reading as a tour and starts reading as a fragment.
*/
const TUTORIAL_STEP_FLOOR = 5;

/*
  And how few steps a tutorial may have at all.

  Open it, do the thing, see what happened: that is three, and it is the shortest
  arc that teaches anything. Below it the piece is a fragment — one instruction over
  a landing page — and the thing to make instead is the site tour, which is honest
  about being a page. The plan says so rather than shipping the fragment.
*/
export const TUTORIAL_MIN_STEPS = 3;

const both = (en: string, es: string): Record<string, string> => ({ en, es });
const same = (s: string) => both(s, s);

/**
 * The wordless release trailer. Lines with a mark are claim→proof pairs in score
 * order; the ticker, status and end card have no mark and close the piece. The
 * hook is the kicker: the product's name and version, inside the first five seconds.
 */
/*
  The tempo of a piece. It was the literal 120 in every template, so every product's film
  cut on the same beat and its bed played the same eight-second phrase; the direction now
  chooses among the tempos whose beat is a whole number of frames at 30 fps. The default
  stays 120 for a caller that has no direction — the repository's own briefs, and every
  test that pins a duration.
*/
export const DEFAULT_BPM = 120;

export function trailerBrief(input: {
  /** The direction's tempo; 120 when nothing chose one. */
  bpm?: number;
  id: string;
  slots: Slots;
  pairs: readonly BoundPair[];
  langs: readonly Lang[];
  session: string;
  project: string;
  statusAllowed: boolean;
  music?: Brief["music"];
}): Brief {
  const { slots } = input;
  const kicker = slots.version ? `${ref(slots.name)} ${ref(slots.version)}` : ref(slots.name);
  const lines: Line[] = [];
  /* The headline is quoted only in its own language; the plan skips the theme elsewhere. */
  if (slots.headline) {
    const text = Object.fromEntries(input.langs.filter((l) => !slots.headlineLang || slots.headlineLang === l).map((l) => [l, ref(slots.headline!)]));
    if (Object.keys(text).length > 0) lines.push({ id: "theme", mode: "type", text });
  }
  input.pairs.forEach((pair, i) => {
    /*
      A claim that quotes a fact references it in the fact's own language. In the other
      tracks the card carries the words literally — a five-word card over an interface
      that speaks that language anyway — and the report lists the line for polishing.
      A card with a digit in it is different: the digit is vouched for only where the
      fact itself can be quoted, so the other tracks get no card and no chip, and the
      render falls back. The chip follows the same rule as the card, because the audit
      reads both and the screen shows both.
    */
    const literalOk = !/\d/.test(pair.claim.text);
    const perLang = (fallback: string | undefined) =>
      Object.fromEntries(
        input.langs
          .map((l): [string, string | undefined] => {
            const own = !pair.claim.lang || pair.claim.lang === l;
            if (pair.claim.factId && own) return [l, ref(pair.claim.factId)];
            return [l, literalOk ? fallback : undefined];
          })
          .filter((e): e is [string, string] => e[1] !== undefined),
      );
    const text = perLang(pair.claim.text);
    if (Object.keys(text).length === 0) return;
    const label = literalOk ? same(pair.claim.text) : perLang(undefined);
    lines.push({ id: `claim-${i + 1}`, mark: pair.moment.id, mode: "type", text, ...(Object.keys(label).length > 0 ? { label } : {}) });
  });
  if (slots.fixes) lines.push({ id: "ticker", mode: "type", text: both(T.ticker.en(slots.fixes), T.ticker.es(slots.fixes)) });
  if (input.statusAllowed) lines.push({ id: "status", mode: "type", text: both(T.status.en, T.status.es) });
  const end = slots.url ?? slots.install;
  if (end) lines.push({ id: "end", mode: "type", text: same(ref(end)) });
  return {
    id: input.id,
    recipe: "ReleaseTrailer",
    langs: [...input.langs],
    bpm: input.bpm ?? DEFAULT_BPM,
    fps: 30,
    session: input.session,
    project: input.project,
    hooks: [{ id: "kicker", mode: "type", text: same(kicker) }],
    lines,
    ...(input.music ? { music: input.music } : {}),
    tags: ["release"],
  };
}

/**
 * A product film made from the application's own pieces. It shares the trailer's
 * fact-clean claim construction, then removes release furniture: the spotlight
 * opens on the product, shows each control being used at macro scale, names what
 * the click produced, and closes on the exact logo.
 *
 * `results` is what the interface showed after each mark's action, by mark, as a
 * fact id (`ui.<mark>.result`): the after-state's own heading, quoted — the half of
 * the sentence every other tool invents. A mark without one is shown without a
 * name rather than with a guessed one.
 */
export function spotlightBrief(input: {
  /** The direction's tempo; 120 when nothing chose one. */
  bpm?: number;
  id: string;
  slots: Slots;
  pairs: readonly BoundPair[];
  langs: readonly Lang[];
  session: string;
  project: string;
  music?: Brief["music"];
  results?: Readonly<Record<string, string>>;
}): Brief {
  const trailer = trailerBrief({ ...input, statusAllowed: false });
  return {
    ...trailer,
    id: input.id,
    recipe: "FeatureSpotlight",
    lines: trailer.lines
      .filter((line) => line.mark || line.id === "theme" || line.id === "end")
      .map((line) => {
        const result = line.mark ? input.results?.[line.mark] : undefined;
        return result ? { ...line, result: same(ref(result)) } : line;
      }),
    tags: ["spotlight", "product-film"],
  };
}

/** One mark, as the plan hands it over: what the interface calls it, and what it did. */
export type TutorialMark = {
  id: string;
  kind: "hero" | "section" | "cta" | "flow";
  /** Fact id for the interface's own name for this thing, when the sheet carries one. */
  name?: string;
  /** Words in that name — a chip holds two or three, a sentence holds any. */
  nameWords?: number;
  /** Fact id for the heading the page showed once this step landed. */
  result?: string;
  /** An accessible name that explains a gesture is narrated as the observed action. */
  instruction?: "open" | "click";
};

/**
 * The narrated getting-started tutorial: one short instruction per mark, in the
 * interface's own names, and — where the walker saw the page change — what that
 * instruction DOES.
 *
 * The difference between "Click Get started" and "Click Get started and Your catalog
 * opens" is the whole product. Every other tool in this field has to invent the
 * second half or ask a person to record themselves saying it; here it is a fact with
 * the page as its source, because a click that changed nothing never became a mark
 * in the first place. A sentence that has no such fact says less rather than
 * guessing: an instruction nobody vouched for is the one thing a tutorial may not do.
 *
 * A person following along in their own window cannot be hurried, which is why these
 * stay short and why the recipe lets the narration own the clock.
 */
export function tutorialBrief(input: {
  /** The direction's tempo; 120 when nothing chose one. */
  bpm?: number;
  id: string;
  /*
    Set when this tutorial answers a request somebody made in words.

    It changes exactly one thing here, and it is the opening. A getting-started tutorial
    opens on how to get the product at all, which is the one instruction a viewer cannot
    see on screen; a lesson opens where the lesson happens. Left in, the first sentence
    of a tutorial about one panel was "install it by running…" spoken over a catalogue —
    narration about a command the piece never shows, which is the plainest way to teach a
    viewer to stop trusting the voice.
  */
  about?: string;
  slots: Slots;
  marks: readonly TutorialMark[];
  langs: readonly Lang[];
  session: string;
  project: string;
  voice?: string;
  music?: Brief["music"];
}): Brief {
  const { slots } = input;
  /* The tagline opens the piece in its own language; the other track gets the plain sentence. */
  const hook: Line = {
    id: "hook",
    text: Object.fromEntries(
      input.langs.map((l) => [l, slots.tagline && (!slots.taglineLang || slots.taglineLang === l) ? ref(slots.tagline) : T.running[l](slots.name)]),
    ),
  };
  /*
    A step's label is its TITLE CARD — the frame to itself for three beats before the
    product comes back — and that changes what belongs on it. As a chip in the corner of
    a picture it could be a connective: "Next" said where you were in a list. On a card
    that fills the frame, "Next" is a second and a half of a word that names nothing, and
    it is the one thing a signpost may not be. So the control's own name wins wherever it
    fits, and a card holds five words where a chip held three; the connective is what is
    left when the interface gave the step no name at all.
  */
  const chip = (mark: TutorialMark, fallback: { en: string; es: string }) =>
    mark.name && (mark.nameWords ?? 99) <= 5 ? same(ref(mark.name)) : both(fallback.en, fallback.es);
  const step = (mark: TutorialMark, label: Record<string, string>, text: Record<string, string>): Line => ({
    id: `step-${mark.id}`,
    mark: mark.id,
    label,
    text,
  });

  /*
    Built in two passes, because the piece is its actions.

    Gating the sections on how many ACTIONS there are gets the arithmetic backwards:
    a page with three of them admits all six of its headings and ships ten steps, six
    of which are a narrator reading section titles. So the instructions are collected
    first, and sections are then let in one at a time, in the order the product does
    them, only while the piece is still short of the floor.
  */
  const acts: { order: number; line: Line }[] = [];
  const context: { order: number; line: Line }[] = [];
  let opened = false;
  input.marks.forEach((mark, order) => {
    if (mark.kind === "hero" && !opened) {
      opened = true;
      /* The one instruction a viewer cannot see on screen: how to get the thing at all. */
      if (slots.install && !input.about) acts.push({ order, line: step(mark, both(T.labelInstall.en, T.labelInstall.es), both(T.installOne.en, T.installOne.es)) });
      else if (mark.name) acts.push({ order, line: step(mark, chip(mark, T.labelOpen), both(T.startOn.en(mark.name), T.startOn.es(mark.name))) });
      /* The route is "/" on almost every project, and "Open / to start" is not a sentence anyone says. */
      else acts.push({ order, line: step(mark, both(T.labelOpen.en, T.labelOpen.es), both(T.startHere.en, T.startHere.es)) });
      return;
    }
    if (mark.kind === "section") {
      if (mark.name) context.push({ order, line: step(mark, chip(mark, T.labelNext), both(T.then.en(mark.name), T.then.es(mark.name))) });
      return;
    }
    if (mark.instruction) {
      const opening = mark.instruction === "open";
      acts.push({ order, line: step(mark,
        opening ? both("Open this item", "Abre este elemento") : both("Select this control", "Pulsa este control"),
        opening ? both("Open this item.", "Abre este elemento.") : both("Click this control.", "Pulsa este control.")) });
      return;
    }
    const c = mark.name ?? (mark.kind === "cta" ? slots.ctaName : undefined);
    if (!c) {
      /* A control with no name it can be told to press: the flow still happened, so the piece says the least it can. */
      if (mark.kind === "flow") acts.push({ order, line: step(mark, both(T.labelResult.en, T.labelResult.es), both(T.result.en, T.result.es)) });
      return;
    }
    const text = mark.result
      ? mark.kind === "cta"
        ? both(T.clickOpens.en(c, mark.result), T.clickOpens.es(c, mark.result))
        : both(T.openReach.en(c, mark.result), T.openReach.es(c, mark.result))
      : both(T.click.en(c), T.click.es(c));
    acts.push({ order, line: step(mark, chip(mark, mark.kind === "cta" ? T.labelClick : T.labelResult), text) });
  });
  const lines: Line[] = [...acts, ...context.slice(0, Math.max(0, TUTORIAL_STEP_FLOOR - acts.length))]
    .sort((a, b) => a.order - b.order)
    .map((s) => s.line);

  /*
    Where to go and do it. An address the viewer can type beats a sentence about how it
    went — and there is always a closing card, because the recipe reserves a bar of
    outro whether or not anything is written on it: without this the piece ends on
    three and a half seconds of dimmed, frozen picture under nothing at all.
  */
  if (slots.url) lines.push({ id: "cta", text: both(T.tryIt.en(slots.url), T.tryIt.es(slots.url)) });
  else if (slots.docs) lines.push({ id: "cta", text: both(T.docs.en(slots.docs), T.docs.es(slots.docs)) });
  else if (slots.install) lines.push({ id: "cta", text: same(ref(slots.install)) });
  else lines.push({ id: "cta", text: same(ref(slots.name)) });
  return {
    id: input.id,
    recipe: "Tutorial",
    langs: [...input.langs],
    bpm: input.bpm ?? DEFAULT_BPM,
    fps: 30,
    session: input.session,
    project: input.project,
    ...(input.voice ? { voice: input.voice, voiceSpeed: 0.92 } : {}),
    hooks: [hook],
    lines,
    ...(input.music ? { music: input.music } : {}),
    tags: ["tutorial"],
  };
}

/** A card piece from facts alone, for projects with no camera path (a CLI, a library). */
export function factsBrief(input: { id: string; slots: Slots; langs: readonly Lang[]; project: string; music?: Brief["music"]; bpm?: number }): Brief {
  const { slots } = input;
  const lines: Line[] = [];
  if (slots.tagline) {
    const text = Object.fromEntries(input.langs.filter((l) => !slots.taglineLang || slots.taglineLang === l).map((l) => [l, ref(slots.tagline!)]));
    if (Object.keys(text).length === input.langs.length) lines.push({ id: "tagline", text });
  }
  if (slots.commits) lines.push({ id: "pace", text: both(T.commitsBehind.en(slots.commits), T.commitsBehind.es(slots.commits)) });
  if (slots.install) lines.push({ id: "install", text: same(ref(slots.install)) });
  lines.push({ id: "brand", text: same(ref(slots.name)) });
  return {
    id: input.id,
    recipe: "KineticQuote",
    langs: [...input.langs],
    bpm: input.bpm ?? DEFAULT_BPM,
    fps: 30,
    project: input.project,
    hooks: [{ id: "kicker", text: slots.version ? both(T.whatsNew.en(slots.name, slots.version), T.whatsNew.es(slots.name, slots.version)) : same(ref(slots.name)) }],
    lines,
    ...(input.music ? { music: input.music } : {}),
    tags: ["facts"],
  };
}

/** The sentences a model could improve, listed so a report can offer them. */
export function polishable(brief: Brief): { line: string; lang: string; text: string; why: string }[] {
  const out: { line: string; lang: string; text: string; why: string }[] = [];
  for (const line of [...brief.hooks, ...brief.lines]) {
    const entries = Object.entries(line.text);
    const literal = entries.filter(([, t]) => !/\{\{fact:/.test(t));
    for (const [lang, text] of entries) {
      if (line.mode !== "type") out.push({ line: line.id, lang, text, why: "templated sentence" });
      else if (literal.length > 1 && literal.every(([, t]) => t === literal[0][1]) && entries.length > 1) out.push({ line: line.id, lang, text, why: "the same words in every language: a card that was not translated" });
    }
  }
  return out;
}
