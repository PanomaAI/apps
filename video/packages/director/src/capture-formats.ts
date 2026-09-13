/* A selected canvas needs its matching product layout, never an unrelated take. */
import type { FormatId } from "@panoma/video-core";
import { DESKTOP_TAKE, MOBILE_TAKE, type SessionLog } from "@panoma/video-capture";

export function selectedFormats(value: readonly FormatId[] | undefined): readonly FormatId[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length || value.some(format => !["h", "v", "s"].includes(format)) || new Set(value).size !== value.length) {
    throw new Error("Select each production format once: h, v or s.");
  }
  return [...value];
}

export function captureTakes(formats?: readonly FormatId[]) {
  return [DESKTOP_TAKE, MOBILE_TAKE].filter(take => !formats || formats.some(format => (format === "v" ? MOBILE_TAKE.id : DESKTOP_TAKE.id) === take.id));
}

export function selectedTakes(takes: readonly SessionLog[], formats?: readonly FormatId[]): SessionLog[] {
  if (!formats) return [...takes];
  const required = captureTakes(formats);
  return takes.filter(take => required.some(expected => expected.id === take.take));
}

export function hasCaptureTakes(takes: readonly SessionLog[], formats?: readonly FormatId[]): boolean {
  return captureTakes(formats).every(expected => takes.some(take => take.take === expected.id));
}
