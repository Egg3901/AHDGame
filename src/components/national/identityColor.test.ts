import { describe, it, expect } from "vitest";
import { hexToRgba, lightenHex } from "./identityColor";

describe("hexToRgba", () => {
  it("converts a 6-digit hex to rgba", () => {
    expect(hexToRgba("#d8b25e", 0.5)).toBe("rgba(216, 178, 94, 0.5)");
  });

  it("handles hex without a leading #", () => {
    expect(hexToRgba("ffffff", 1)).toBe("rgba(255, 255, 255, 1)");
  });

  it("is case-insensitive", () => {
    expect(hexToRgba("#E3DCD0", 0.92)).toBe("rgba(227, 220, 208, 0.92)");
  });

  it("returns the input unchanged when not a 6-digit hex", () => {
    expect(hexToRgba("rgb(1,2,3)", 0.5)).toBe("rgb(1,2,3)");
    expect(hexToRgba("#fff", 0.5)).toBe("#fff");
  });
});

describe("lightenHex", () => {
  it("adds the default channel deltas", () => {
    expect(lightenHex("#000000")).toBe("rgb(30, 18, 18)");
  });

  it("clamps each channel at 255", () => {
    expect(lightenHex("#ffffff")).toBe("rgb(255, 255, 255)");
  });

  it("accepts custom deltas", () => {
    expect(lightenHex("#101010", 5, 5, 5)).toBe("rgb(21, 21, 21)");
  });

  it("returns the input unchanged when not a 6-digit hex", () => {
    expect(lightenHex("nope")).toBe("nope");
  });
});
