import { describe, expect, it } from "vitest";
import {
  DEFAULT_READING_FONT_SIZE,
  MAX_READING_FONT_SIZE,
  MIN_READING_FONT_SIZE,
  normalizeReadingFontSize,
} from "./font-size.js";

describe("reading font size", () => {
  it("defaults absent and invalid values to 14", () => {
    expect(normalizeReadingFontSize(undefined)).toBe(DEFAULT_READING_FONT_SIZE);
    expect(normalizeReadingFontSize(null)).toBe(DEFAULT_READING_FONT_SIZE);
    expect(normalizeReadingFontSize(14.5)).toBe(DEFAULT_READING_FONT_SIZE);
    expect(normalizeReadingFontSize("16")).toBe(DEFAULT_READING_FONT_SIZE);
    expect(normalizeReadingFontSize(11)).toBe(DEFAULT_READING_FONT_SIZE);
    expect(normalizeReadingFontSize(25)).toBe(DEFAULT_READING_FONT_SIZE);
  });

  it("keeps integers inside the supported range", () => {
    expect(normalizeReadingFontSize(MIN_READING_FONT_SIZE)).toBe(12);
    expect(normalizeReadingFontSize(14)).toBe(14);
    expect(normalizeReadingFontSize(16)).toBe(16);
    expect(normalizeReadingFontSize(MAX_READING_FONT_SIZE)).toBe(24);
  });
});
