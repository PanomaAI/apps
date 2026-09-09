/*
  One client for everything ElevenLabs gives us. The key comes from the environment and
  from nowhere else — this repository is destined to be public and a key in a file is a
  key in the git history forever.

  The endpoint worth knowing about is `with-timestamps`: the same TTS call also returns
  character-level timing, which is what kinetic captions are made of. The old pipeline
  round-tripped through speech-to-text to recover timing the API had already offered.
*/

import { reserveAppCall } from "@panoma/video-brain";

const API = "https://api.elevenlabs.io/v1";

/*
  The voice the automatic path uses when the caller names none.

  A tutorial capability that only speaks for someone who already knows a voice id is
  a capability nobody uses. This one is multilingual — the same instrument reads the
  English and the Spanish track, which is what keeps a two-language matrix sounding
  like one piece — and it is the voice this repository's own tutorial ships with. A
  caller who wants another passes it; a caller who wants none passes "none".
*/
export const DEFAULT_VOICE = "gOupLcAkjEnguROwi4oS";

function key(): string {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new Error("ELEVENLABS_API_KEY is not set. Set it explicitly in the environment.");
  return k;
}

async function post(path: string, body: unknown, model: string): Promise<Response> {
  const apiKey = key();
  reserveAppCall("elevenlabs", model);
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res;
}

export type Word = { text: string; start: number; end: number };

export type VoiceRequest = {
  text: string;
  voiceId: string;
  modelId?: string;
  /** Text of the previous line, to keep prosody continuous across separate calls. */
  previousText?: string;
  /*
    0.7 to 1.2, where 1 is the voice's own pace.

    It exists for one reason: a tutorial's captions are read by someone who is also
    decoding an unfamiliar interface, and this voice reads at about 190 words a
    minute, which puts a third of the caption cards over the twenty characters a
    second that a subtitle may demand. The narration is not too fast for a listener;
    it is too fast for a reader who is doing something else at the same time.
  */
  speed?: number;
  settings?: { stability?: number; similarity_boost?: number; style?: number; use_speaker_boost?: boolean };
};

/** Speech plus the word timing that captions need, in one API call. */
export async function speakWithTimestamps(req: VoiceRequest): Promise<{ audio: Buffer; words: Word[] }> {
  const res = await post(`/text-to-speech/${req.voiceId}/with-timestamps?output_format=mp3_44100_192`, {
    text: req.text,
    model_id: req.modelId ?? "eleven_multilingual_v2",
    previous_text: req.previousText,
    voice_settings: {
      ...(req.settings ?? { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true }),
      ...(req.speed === undefined ? {} : { speed: req.speed }),
    },
  }, req.modelId ?? "eleven_multilingual_v2");
  const json = (await res.json()) as {
    audio_base64: string;
    alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
  };
  return { audio: Buffer.from(json.audio_base64, "base64"), words: wordsFromCharacters(json.alignment) };
}

/** Collapse character-level alignment into words, splitting on whitespace. */
export function wordsFromCharacters(a: {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}): Word[] {
  const words: Word[] = [];
  let text = "";
  let start = 0;
  for (let i = 0; i < a.characters.length; i++) {
    const ch = a.characters[i];
    if (/\s/.test(ch)) {
      if (text) words.push({ text, start, end: a.character_end_times_seconds[i - 1] });
      text = "";
    } else {
      if (!text) start = a.character_start_times_seconds[i];
      text += ch;
    }
  }
  if (text) words.push({ text, start, end: a.character_end_times_seconds[a.characters.length - 1] });
  return words;
}

/** A music bed. Prompts should say what must NOT happen (hits, risers) — negatives work. */
export async function music(req: { prompt: string; lengthMs: number }): Promise<Buffer> {
  const res = await post("/music", { prompt: req.prompt, music_length_ms: req.lengthMs }, "eleven_music");
  return Buffer.from(await res.arrayBuffer());
}

/** A short sound effect (whoosh, tick, impact). Half a second of these sells a cut. */
export async function soundEffect(req: { prompt: string; seconds?: number }): Promise<Buffer> {
  const res = await post("/sound-generation", {
    text: req.prompt,
    duration_seconds: req.seconds,
  }, "eleven_sound");
  return Buffer.from(await res.arrayBuffer());
}

/** Transcribe existing audio (e.g. a founder clip) into the same Word shape. */
export async function transcribe(audio: Buffer, filename = "audio.mp3"): Promise<Word[]> {
  const form = new FormData();
  form.append("model_id", "scribe_v1");
  form.append("file", new Blob([new Uint8Array(audio)]), filename);
  const apiKey = key();
  reserveAppCall("elevenlabs", "scribe_v1");
  const res = await fetch(`${API}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });
  if (!res.ok) throw new Error(`/speech-to-text: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { words?: { text: string; start: number; end: number; type: string }[] };
  return (json.words ?? []).filter((w) => w.type === "word").map((w) => ({ text: w.text, start: w.start, end: w.end }));
}
