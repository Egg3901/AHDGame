import { describe, expect, it } from "vitest";
import { normaliseCaucusSlug } from "./caucusLookup";

describe("normaliseCaucusSlug", () => {
  it("lowercases and replaces non-alphanumerics with dashes", () => {
    expect(normaliseCaucusSlug("Main Street Republicans")).toBe("main-street-republicans");
  });

  it("collapses multiple separators", () => {
    expect(normaliseCaucusSlug("Freedom   Caucus -- 2026")).toBe("freedom-caucus-2026");
  });

  it("trims leading and trailing dashes", () => {
    expect(normaliseCaucusSlug("  Hello!  ")).toBe("hello");
  });

  it("strips diacritics-adjacent punctuation but keeps ascii letters", () => {
    expect(normaliseCaucusSlug("Pro-Worker Bloc!")).toBe("pro-worker-bloc");
  });

  it("caps the slug at 60 characters", () => {
    const longInput = "a".repeat(80);
    expect(normaliseCaucusSlug(longInput)).toBe("a".repeat(60));
  });

  it("throws on empty input", () => {
    expect(() => normaliseCaucusSlug("")).toThrow(/empty/i);
    expect(() => normaliseCaucusSlug("   ")).toThrow(/empty/i);
  });

  it("throws when nothing alphanumeric survives", () => {
    expect(() => normaliseCaucusSlug("!!!---***")).toThrow(/derive/i);
  });
});
