/*
  Provenance: what a rendered file is made of, written beside it.

  A finished video mixes things with different truth values — footage recorded from the
  real product, sentences expanded from facts with sources, a voice no person spoke, a
  music bed no one composed, a cursor no hand moved, and perhaps b-roll a model dreamed.
  Two audiences need that mixture spelled out. A person, later, asking "was this screen
  real?" — the answer is the commit and the take. And a regulator or platform: the EU AI
  Act's Article 50(2) requires synthetic audio and video to be marked as artificially
  generated in a machine-readable form, in force since 2 August 2026, and YouTube asks
  the uploader to disclose realistic altered content and AI-generated music at upload.
  A tool that assembled all of this and wrote nothing down would leave the disclosure
  to whoever uploads, which in the automatic path is nobody.

  So every render gets a `.provenance.json` with stable key order (two renders of the
  same thing diff clean), and every delivered mp4 carries a one-sentence `comment` that
  says only what is true of that file. The sentence never claims a disclosure the file
  does not need, and never omits one it does: a synthetic cursor alone is a drawing, not
  synthetic media, and is mentioned without triggering the flag.
  https://artificialintelligenceact.eu/article/50/
*/

export type Provenance = {
  compositionId: string;
  renderedAt: string;
  /** The engine commit that rendered it. */
  engine: string;
  project: { id: string; root: string; head?: string };
  /** Every sentence the video states, with the fact ids that vouch for it. */
  claims: { line: string; text: string; facts: string[] }[];
  /** Every recording the video plays, with the commit of the product it shows. */
  takes: { session: string; take: string; recordedAt: string; head?: string; url: string; viewport: { width: number; height: number };
    /** The measured encoder origin; session times already include this correction. */
    videoClock?: { source: "screencast"; version: 1; originMs: number; offsetMs: number };
  }[];
  voice?: { provider: "elevenlabs"; voiceId: string; model: string; speed?: number };
  music?: {
    source: "procedural" | "file" | "elevenlabs";
    file?: string;
    license: string;
    /** A brought track: its measured tempo, and the stretch that put it on the grid (1 = untouched). */
    bpm?: number;
    stretch?: number;
    /** The conformed intermediate the mix actually played, when `file` is the track as brought. */
    conformed?: string;
  };
  /** The EU AI Act Art. 50 / YouTube disclosure inputs. */
  synthetic: { voice: boolean; music: boolean; cursor: boolean; broll: boolean };
  review: { status: string; file: string };
};

/* ---------- JSON with a stable key order ---------- */

/*
  Keys come out in the order the type declares them, per object, so the file reads like
  the type and two renders of one composition diff only where they differ. A key this
  table does not know — a future field — goes after the known ones, alphabetically, so
  the order is still total.
*/
const ORDER: Record<string, readonly string[]> = {
  "": ["compositionId", "renderedAt", "engine", "project", "claims", "takes", "voice", "music", "synthetic", "review"],
  project: ["id", "root", "head"],
  claims: ["line", "text", "facts"],
  takes: ["session", "take", "recordedAt", "head", "url", "viewport", "videoClock"],
  videoClock: ["source", "version", "originMs", "offsetMs"],
  viewport: ["width", "height"],
  voice: ["provider", "voiceId", "model", "speed"],
  music: ["source", "file", "license", "bpm", "stretch", "conformed"],
  synthetic: ["voice", "music", "cursor", "broll"],
  review: ["status", "file"],
};

function ordered(value: unknown, key: string): unknown {
  if (Array.isArray(value)) return value.map((v) => ordered(v, key));
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const known = ORDER[key] ?? [];
  const rest = Object.keys(record).filter((k) => !known.includes(k)).sort();
  const out: Record<string, unknown> = {};
  for (const k of [...known, ...rest]) if (k in record && record[k] !== undefined) out[k] = ordered(record[k], k);
  return out;
}

/** Two-space JSON, keys in declaration order, trailing newline. */
export function provenanceJson(p: Provenance): string {
  return JSON.stringify(ordered(p, ""), null, 2) + "\n";
}

/* ---------- Disclosure ---------- */

/**
 * Whether the file must be marked as synthetic media: a voice nobody spoke, music from
 * a generator, or generated footage. The cursor is excluded on purpose — an animated
 * pointer over a real recording is a drawing, the same as an arrow, and marking it
 * would put the flag on every screen recording panoma video makes and drain it of meaning.
 * Procedural music counts: it is not a model, but Article 50 says "artificially
 * generated", and over-marking a bed is cheaper than arguing about one.
 */
export function needsDisclosure(p: Provenance): boolean {
  return p.synthetic.voice || p.synthetic.music || p.synthetic.broll;
}

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * One English sentence for the file's `comment` metadata, built only from what is
 * true: "Synthetic voice and procedural music; recorded from the real product at
 * commit abc123; made with panoma video." A wordless cut with no recording says just
 * "Made with panoma video."
 */
export function disclosureText(p: Provenance): string {
  const synthetic: string[] = [];
  if (p.synthetic.voice) synthetic.push("synthetic voice");
  if (p.synthetic.music) synthetic.push(p.music?.source === "procedural" ? "procedural music" : "AI-generated music");
  if (p.synthetic.broll) synthetic.push("AI-generated b-roll");
  if (p.synthetic.cursor) synthetic.push("a synthetic cursor");

  const parts: string[] = [];
  if (synthetic.length > 0) parts.push(list(synthetic));
  if (p.takes.length > 0) {
    const head = p.takes.find((t) => t.head)?.head ?? p.project.head;
    parts.push(head ? `recorded from the real product at commit ${head.slice(0, 7)}` : "recorded from the real product");
  }
  parts.push("made with panoma video");

  const sentence = parts.join("; ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
}

/**
 * The ffmpeg arguments that stamp the sentence into the container. `comment` is one
 * of the keys the mp4 muxer writes without `-movflags use_metadata_tags`, which is
 * why the sentence and not a custom key carries the disclosure.
 */
export function disclosureMetadataArgs(p: Provenance): string[] {
  return ["-metadata", `comment=${disclosureText(p)}`];
}
