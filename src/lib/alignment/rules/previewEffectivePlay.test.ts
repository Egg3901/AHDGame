import { describe, expect, it } from "vitest";
import { previewEffectivePlay } from "./previewEffectivePlay";
const input: Parameters<typeof previewEffectivePlay>[0] = {
  shares: { shares: { WEST: 22, EAST: 50 }, nonAligned: 28 },
  poles: ["WEST", "EAST"],
  poleId: "WEST",
  amountLocal: 1000,
  pointCostLocal: 100,
  playMaxPoints: 10,
  resistsAtHalfStrength: false,
  weight: 1,
  effectiveness: 1,
  turnCap: 5,
};
describe("previewEffectivePlay", () => {
  it("caps the displayed gain at the nation limit", () => {
    expect(previewEffectivePlay(input)).toBe(5);
    expect(previewEffectivePlay({ ...input, turnCap: 7.5 })).toBe(7.5);
    expect(previewEffectivePlay({ ...input, amountLocal: 1e12 })).toBe(5);
  });
  it("nets a rival's standing push before the cap (ticket 1371)", () => {
    // A max play (9.95 pts) against a rival landing 9.28 a turn leaves 0.67.
    const rival = { poleId: "EAST" as const, points: 9.28 };
    expect(previewEffectivePlay({ ...input, amountLocal: 995, rivalPressure: rival })).toBe(0.67);
    expect(
      previewEffectivePlay({
        ...input,
        amountLocal: 995,
        rivalPressure: { ...rival, poleId: "WEST" },
      })
    ).toBe(5);
  });
  it("includes channel strength and bloc strain", () => {
    expect(previewEffectivePlay({ ...input, weight: 0.5, effectiveness: 0.6 })).toBe(3);
  });
  it("applies resistance exactly once", () => {
    expect(
      previewEffectivePlay({
        ...input,
        shares: { shares: { WEST: 30, EAST: 30 }, nonAligned: 40 },
        resistsAtHalfStrength: true,
        pointCostLocal: 200,
        playMaxPoints: 5,
        amountLocal: 800,
      })
    ).toBe(4);
  });
  it("includes final share normalization", () => {
    expect(
      previewEffectivePlay({
        ...input,
        shares: { shares: { WEST: 26, EAST: 74 }, nonAligned: 0 },
        amountLocal: 100,
      })
    ).toBe(0.73);
  });
  it("returns zero for unpriceable or zero spends and locked targets", () => {
    expect(previewEffectivePlay({ ...input, pointCostLocal: 0 })).toBe(0);
    expect(previewEffectivePlay({ ...input, amountLocal: 0 })).toBe(0);
    expect(
      previewEffectivePlay({ ...input, shares: { shares: { WEST: 2, EAST: 90 }, nonAligned: 8 } })
    ).toBe(0);
  });

  it.each([NaN, Infinity, -Infinity, -1])("rejects invalid preview inputs (%s)", (value) => {
    for (const key of [
      "amountLocal",
      "pointCostLocal",
      "playMaxPoints",
      "weight",
      "effectiveness",
      "turnCap",
    ] as const) {
      expect(previewEffectivePlay({ ...input, [key]: value })).toBe(0);
    }
  });

  it("does not forecast movement toward an inactive pole", () => {
    expect(previewEffectivePlay({ ...input, poleId: "BEIJING" })).toBe(0);
  });
});
