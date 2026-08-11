import { describe, expect, it } from "vitest";
import { Long } from "mongodb";
import { coerceStoredNumber } from "./coerceStoredNumber";

describe("coerceStoredNumber", () => {
  it("returns finite numbers as-is", () => {
    expect(coerceStoredNumber(42.5, 0)).toBe(42.5);
    expect(coerceStoredNumber(0, 99)).toBe(0);
  });

  it("uses fallback for non-finite numbers", () => {
    expect(coerceStoredNumber(Number.NaN, 3)).toBe(3);
    expect(coerceStoredNumber(Number.POSITIVE_INFINITY, 3)).toBe(3);
  });

  it("coerces numeric strings", () => {
    expect(coerceStoredNumber("12.25", 0)).toBe(12.25);
    expect(coerceStoredNumber("", 7)).toBe(7);
  });

  it("coerces BSON Long instances", () => {
    expect(coerceStoredNumber(Long.fromInt(55), 0)).toBe(55);
  });

  it("coerces JSON shape of BSON Long", () => {
    const serialized = JSON.parse(JSON.stringify({ organization: Long.fromInt(88) })).organization;
    expect(coerceStoredNumber(serialized, 0)).toBe(88);
  });

  it("handles nullish", () => {
    expect(coerceStoredNumber(null, 1)).toBe(1);
    expect(coerceStoredNumber(undefined, 1)).toBe(1);
  });
});
