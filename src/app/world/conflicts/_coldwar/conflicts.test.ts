import { describe, it, expect } from "vitest";
import { leanColor, sevStyle } from "./conflicts";

describe("conflicts helpers", () => {
  it("maps lean to bloc color by threshold", () => {
    expect(leanColor(42)).toBe("#3b82f6"); // <=42 West blue
    expect(leanColor(50)).toBe("#d4af37"); // <55 contested gold
    expect(leanColor(70)).toBe("#dc2626"); // East red
  });
  it("returns severity styling", () => {
    expect(sevStyle("CRITICAL").c).toBe("#ff5a3c");
    expect(sevStyle("MAJOR").c).toBe("#ff9d6b");
    expect(sevStyle("ANYTHING_ELSE").c).toBe("#86d978");
  });
});
