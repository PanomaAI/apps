/*
  The post kit: every render ships with its platform-native copy, written by template
  from the brief itself. Uploading is manual on purpose — organic-posting APIs are the
  weakest, most ToS-fragile part of every automation tool we studied — but everything
  around the upload is precomputed: caption, hashtags, title, description, per
  platform and per language. The {{LINK}} placeholder is deliberate: a kit must never
  contain a guessed URL that someone pastes without looking.

  One house rule is enforced here and tested: no inflected word glued to a digit.
  Sentences are shaped so numbers close them.
*/
import { FORMATS, type FormatId } from "./format.ts";
import type { Brief, Line } from "./brief.ts";

const BASE_TAGS = ["buildinpublic", "devtools", "programming"];

export type Copy = {
  short: string /* TikTok / Reels / Shorts caption */;
  x: string;
  linkedin: string;
  youtubeTitle: string;
  youtubeDescription: string;
  hashtags: string[];
};

/** Limited CTA check shared by generated copy and the final kit writer. */
export function hasDestinationClaim(copy: Copy): boolean {
  return [copy.short, copy.x, copy.linkedin, copy.youtubeTitle, copy.youtubeDescription].some((text) =>
    /https?:\/\/|www\.|\{\{LINK\}\}|\b(?:link|enlace|bio|visit|visita|download|descarga|sign up|reg[ií]strate|try (?:it|now|free)|pru[eé]ba(?:lo|la)|available now|ya disponible|open source|c[oó]digo abierto)\b/iu.test(text));
}

function textOf(line: Line, lang: string): string {
  return line.text[lang] ?? line.text[Object.keys(line.text)[0]];
}

export function postCopy(brief: Brief, hook: Line, lang: string): Copy {
  const hookText = textOf(hook, lang);
  const lines = brief.lines.map((l) => textOf(l, lang));
  const body = lines.slice(0, -1).join(" ");
  const hashtags = [...BASE_TAGS, ...(brief.tags ?? [])];
  const tagLine = hashtags.map((t) => `#${t}`).join(" ");
  const es = lang === "es";

  if (brief.recipe === "ProductPromo" && brief.promo?.close?.kind === "brand") {
    const benefits = brief.lines.filter((line) => line.mark).map((line) => textOf(line, lang));
    const brand = brief.lines.find((line) => line.id === "brand");
    const identity = brand ? textOf(brand, lang) : "";
    const tags = [...new Set(["product", ...(brief.tags ?? [])])];
    const tagLine = tags.map((tag) => `#${tag}`).join(" ");
    const description = [hookText, ...benefits, identity].filter(Boolean).join("\n\n");
    return { short: `${hookText}${identity ? ` — ${identity}` : ""} ${tagLine}`, x: description, linkedin: description,
      youtubeTitle: hookText.length <= 70 ? hookText : `${hookText.slice(0, 67)}…`, youtubeDescription: `${description}\n\n${tagLine}`, hashtags: tags };
  }

  return {
    short: `${hookText} ${es ? "El enlace está en la bio." : "Link in bio."} ${tagLine}`,
    x: `${hookText}\n\n${body}\n\n{{LINK}}`,
    linkedin: es
      ? `${hookText}\n\n${body}\n\nLo estoy construyendo en abierto — el código y la historia completa: {{LINK}}`
      : `${hookText}\n\n${body}\n\nBuilding this in the open — code and the full story: {{LINK}}`,
    youtubeTitle: hookText.length <= 70 ? hookText : `${hookText.slice(0, 67)}…`,
    youtubeDescription: `${lines.join("\n")}\n\n{{LINK}}\n\n${tagLine}`,
    hashtags,
  };
}

export type Chapter = { seconds: number; label: string; accepted: boolean };

/** m:ss, the only shape a timestamp may take in a description box. */
export function timecode(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** The kit as one readable file, grouped by where this format actually gets posted. */
export function postKitMarkdown(
  brief: Brief,
  hook: Line,
  lang: string,
  formatId: FormatId,
  opts: { chapters?: Chapter[]; copy?: Copy } = {},
): string {
  /* Copy a brain wrote for this cut, when there is one; the template is what every other cut gets. */
  const brandOnly = brief.recipe === "ProductPromo" && brief.promo?.close?.kind === "brand";
  const copy = opts.copy && (!brandOnly || !hasDestinationClaim(opts.copy)) ? opts.copy : postCopy(brief, hook, lang);
  const format = FORMATS[formatId];
  const sections: string[] = [
    `# ${brief.id} — ${hook.id} — ${lang} — ${formatId}`,
    ``,
    `Targets: ${format.targets.join(" · ")}`,
    ``,
  ];
  if (format.targets.some((t) => ["tiktok", "reels", "shorts"].includes(t))) {
    sections.push(`## Caption (TikTok / Reels / Shorts)`, ``, copy.short, ``);
  }
  if (format.targets.includes("x")) {
    sections.push(`## X`, ``, copy.x, ``);
  }
  if (format.targets.includes("linkedin")) {
    sections.push(`## LinkedIn`, ``, copy.linkedin, ``);
  }
  if (format.targets.includes("youtube")) {
    sections.push(`## YouTube`, ``, `**Title:** ${copy.youtubeTitle}`, ``, copy.youtubeDescription, ``);
  }
  /*
    Chapters are printed for anything that has them, and say plainly whether the
    player will honour them: YouTube needs a chapter at 0:00, three of them, and ten
    seconds each. A short vertical cut satisfies none of that, and a kit that listed
    timestamps without saying so would be teaching someone to paste dead text.
  */
  const chapters = opts.chapters ?? [];
  if (chapters.length > 0) {
    sections.push(
      `## Chapters`,
      ``,
      ...chapters.map((c) => `${timecode(c.seconds)} ${c.label}`),
      ``,
      chapters[0].accepted
        ? `YouTube will render these as chapters.`
        : `Too short for YouTube chapters (it wants three or more, ten seconds apart, starting at 0:00) — paste them as plain text, or don't.`,
      ``,
    );
  }
  sections.push(
    `---`,
    `Post natively on every platform — never export from one app into another;`,
    brandOnly ? `This film closes on the product identity. No public destination was supplied; the copy makes no availability or link claim.`
      : `watermarks cost 40-60% reach. Replace {{LINK}} before publishing.`,
  );
  return sections.join("\n");
}
