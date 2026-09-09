/*
  How an agent changes words without touching structure.

  A brief the director wrote is regenerated from templates whenever the facts change,
  and a sentence an agent improved must survive that. So edits are not made to the
  brief; they are made to a PATCH keyed by the ids the agent already has — hook ids,
  line ids, languages — and the patch is re-applied after every regeneration. The
  patch can rewrite text and labels, drop a line, add one, and change the voice or
  the tempo. It cannot rename an id or reorder steps: order comes from the marks, and
  a patch that argued with the recording would be the bug this design removes.
*/
import type { Brief, Line } from "./brief.ts";

export type LinePatch = {
  readonly text?: Record<string, string>;
  readonly label?: Record<string, string>;
  readonly result?: Record<string, string>;
  readonly mark?: string;
  readonly mode?: Line["mode"];
};

export type BriefPatch = {
  readonly hooks?: Record<string, LinePatch>;
  readonly lines?: Record<string, LinePatch>;
  /** Line ids to remove. A hook cannot be dropped below one. */
  readonly drop?: readonly string[];
  /** Lines to append (after the steps, before the closing card is fine: the recipe orders by mark). */
  readonly add?: readonly Line[];
  /*
    Hooks to append. A hook is a whole cut of the matrix — hooks × languages ×
    formats — so this is how a brain or an agent turns one idea into the three
    openings the feed gets to vote on. An id already taken by a hook or a line is
    skipped: on disk the two would be one file.
  */
  readonly addHooks?: readonly Line[];
  readonly bpm?: number;
  readonly voice?: string;
  readonly voiceSpeed?: number;
};

function patchLine(line: Line, patch: LinePatch | undefined): Line {
  if (!patch) return line;
  return {
    ...line,
    ...(patch.text ? { text: { ...line.text, ...patch.text } } : {}),
    ...(patch.label ? { label: { ...(line.label ?? {}), ...patch.label } } : {}),
    ...(patch.result ? { result: { ...(line.result ?? {}), ...patch.result } } : {}),
    ...(patch.mark !== undefined ? { mark: patch.mark } : {}),
    ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
  };
}

/** Which ids a patch names that the brief does not have — reported, never silently ignored. */
export function unknownPatchIds(brief: Brief, patch: BriefPatch): string[] {
  const hooks = new Set(brief.hooks.map((h) => h.id));
  const lines = new Set(brief.lines.map((l) => l.id));
  const out: string[] = [];
  for (const id of Object.keys(patch.hooks ?? {})) if (!hooks.has(id)) out.push(`hooks.${id}`);
  for (const id of Object.keys(patch.lines ?? {})) if (!lines.has(id)) out.push(`lines.${id}`);
  for (const id of patch.drop ?? []) if (!lines.has(id) && !hooks.has(id)) out.push(`drop.${id}`);
  return out;
}

export function applyPatch(brief: Brief, patch: BriefPatch | undefined): Brief {
  if (!patch) return brief;
  const dropped = new Set(patch.drop ?? []);
  const kept = brief.hooks.map((h) => patchLine(h, patch.hooks?.[h.id])).filter((h) => !dropped.has(h.id));
  const lines = [...brief.lines.map((l) => patchLine(l, patch.lines?.[l.id])).filter((l) => !dropped.has(l.id)), ...(patch.add ?? [])];
  const taken = new Set([...kept, ...lines].map((l) => l.id));
  const added = (patch.addHooks ?? []).filter((h) => {
    if (taken.has(h.id)) return false;
    taken.add(h.id);
    return true;
  });
  const hooks = [...kept, ...added];
  return {
    ...brief,
    hooks: hooks.length > 0 ? hooks : brief.hooks.slice(0, 1),
    lines,
    ...(patch.bpm !== undefined ? { bpm: patch.bpm } : {}),
    ...(patch.voice !== undefined ? { voice: patch.voice } : {}),
    ...(patch.voiceSpeed !== undefined ? { voiceSpeed: patch.voiceSpeed } : {}),
  };
}
