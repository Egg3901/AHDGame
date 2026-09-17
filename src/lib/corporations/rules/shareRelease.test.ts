import { describe, expect, it } from "vitest";
import { resolveReleaseFloat, selectReleaseRows } from "./shareRelease";

describe("resolveReleaseFloat", () => {
  it("treats only undefined as a missing float", () => {
    expect(resolveReleaseFloat(undefined, 350)).toBe(350);
  });

  it("credits onto a zero float instead of treating it as missing", () => {
    expect(resolveReleaseFloat(0, 350)).toBe(350);
  });

  it("fails closed on null, non-numeric, non-finite, and negative floats", () => {
    for (const bad of [null, "100", Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      expect(() => resolveReleaseFloat(bad, 100)).toThrow(/Refusing share release/);
    }
  });
});

describe("selectReleaseRows holder keys", () => {
  it("ignores rows keyed only by another holder kind", () => {
    const wanted = new Set(["holder"]);
    for (const other of [
      { imperialCharacterId: "other" },
      { fundId: "other" },
      { nppId: "other" },
      { corporationId: "other" },
    ]) {
      const selection = selectReleaseRows(
        [
          { ...other, shares: 100 },
          { characterId: "holder", shares: 40 },
        ],
        "characterId",
        wanted
      );
      expect(selection).toEqual({ matchedIndexes: [1], sharesTotal: 40 });
    }
  });

  it("fails closed when an affected row carries any additional holder key", () => {
    const wanted = new Set(["holder"]);
    for (const extra of [
      { imperialCharacterId: "other" },
      { corporationId: "other" },
      { fundId: "other" },
      { nppId: "other" },
    ]) {
      expect(() =>
        selectReleaseRows([{ characterId: "holder", ...extra, shares: 100 }], "characterId", wanted)
      ).toThrow(/multiple holder keys/);
    }
  });
});
