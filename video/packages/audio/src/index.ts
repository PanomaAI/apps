export { speakWithTimestamps, music, soundEffect, transcribe, wordsFromCharacters, DEFAULT_VOICE } from "./eleven.ts";
export type { Word, VoiceRequest } from "./eleven.ts";
export { renderBed, writeBed, bedName, type BedOptions, type BedStyle } from "./bed.ts";
export { makeSfx, ensureSfx, SFX, EDITORIAL_SFX, renderInteractionSound, renderEditorialSound } from "./sfx.ts";
export type { SfxName, InteractionSound, EditorialSound } from "./sfx.ts";
export { master, loudness, masterChain, TARGET as MASTER_TARGET, CEILING_DBFS } from "./master.ts";
export { analyseTrack, decodeMono, gridTempo, conformTrack, envelopeAt, tempoOf, beatsOf, refineTempo, downbeatOf, ENVELOPE_HZ, ANALYSIS_RATE } from "./beat.ts";
export type { TrackAnalysis } from "./beat.ts";
