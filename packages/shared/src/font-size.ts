/**
 * Reading font size for chat transcript and composer (D343 / ADR 0180).
 *
 * The product `--text-base` is 14px. Users may pick a nearby integer px; the
 * renderer scales the `--text-*` ramp inside `.thread-wrap` and `.composer-dock`
 * from that base. Window zoom is independent and still scales chrome.
 */

/** Matches the design-system `--text-base` token. */
export const DEFAULT_READING_FONT_SIZE = 14;
export const MIN_READING_FONT_SIZE = 12;
export const MAX_READING_FONT_SIZE = 24;

/** Named Appearance presets; any integer in the min/max range is also valid. */
export const READING_FONT_SIZE_PRESETS = [12, 14, 16, 18] as const;

export type ReadingFontSizePreset = (typeof READING_FONT_SIZE_PRESETS)[number];

/** Normalize the user-configured reading size at the renderer edge. */
export function normalizeReadingFontSize(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_READING_FONT_SIZE ||
    value > MAX_READING_FONT_SIZE
  ) {
    return DEFAULT_READING_FONT_SIZE;
  }
  return value;
}

export function isReadingFontSize(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_READING_FONT_SIZE &&
    value <= MAX_READING_FONT_SIZE
  );
}
