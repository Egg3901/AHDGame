import { describe, it, expect } from "vitest";
import { directionMark, directionToneClass, verdictToneClass } from "./ledgerFormat";

describe("directionMark", () => {
  it("marks surplus, deficit, and balance", () => {
    expect(directionMark(5)).toBe("▲");
    expect(directionMark(-5)).toBe("▼");
    expect(directionMark(0)).toBe("—");
  });
});

describe("directionToneClass", () => {
  it("maps sign to semantic tone tokens", () => {
    expect(directionToneClass(5)).toBe("text-success");
    expect(directionToneClass(-5)).toBe("text-error");
    expect(directionToneClass(0)).toBe("text-muted");
  });
});

describe("verdictToneClass", () => {
  it("gold for imbalanced, success for balanced", () => {
    expect(verdictToneClass("IMBALANCED")).toBe("text-primary");
    expect(verdictToneClass("BALANCED")).toBe("text-success");
  });
});
