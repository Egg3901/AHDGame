import { describe, it, expect } from "vitest";
import { loadCookPvi } from "./loadCookPvi";

describe("loadCookPvi", () => {
  it("returns null when the requested n does not match the file's district count", () => {
    // CA has 52 districts in the modern file; asking for 3 (e.g. a 1991 apportionment) ⇒ null
    expect(loadCookPvi("CA", 3)).toBeNull();
  });

  it("returns a PVI array of length n when counts match", () => {
    // WY is at-large: exactly 1 district in the file.
    const result = loadCookPvi("WY", 1);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(typeof result![0] === "number" || result![0] === null).toBe(true);
  });

  it("returns null for an unknown state", () => {
    expect(loadCookPvi("ZZ", 1)).toBeNull();
  });
});
