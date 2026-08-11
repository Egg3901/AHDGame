import { describe, it, expect } from "vitest";
import { isRedistrictingEnabled } from "./flag";

describe("isRedistrictingEnabled", () => {
  it("defaults to false when missing or null", () => {
    expect(isRedistrictingEnabled(undefined)).toBe(false);
    expect(isRedistrictingEnabled(null)).toBe(false);
    expect(isRedistrictingEnabled({})).toBe(false);
  });
  it("returns true only when explicitly enabled", () => {
    expect(isRedistrictingEnabled({ redistrictingEnabled: true })).toBe(true);
    expect(isRedistrictingEnabled({ redistrictingEnabled: false })).toBe(false);
  });
});
