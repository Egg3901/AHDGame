import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/collections", () => ({
  getStateDemographicTurnoutCollection: vi.fn(),
}));

const findOne = vi.fn();

async function setTurnoutDoc(doc: unknown) {
  findOne.mockResolvedValue(doc);
  const { getStateDemographicTurnoutCollection } = await import("@/lib/db/collections");
  vi.mocked(getStateDemographicTurnoutCollection).mockResolvedValue({ findOne } as never);
}

describe("buildRegionTurnoutResponse", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queries by _id only (no countryId filter) so legacy country-less US docs resolve", async () => {
    // Live US turnout docs predate the countryId field; the page must still find them.
    await setTurnoutDoc({
      _id: "MO",
      modifiers: { race: { white: 7 } },
      lastUpdated: new Date("2026-06-07T21:00:00.000Z"),
      lastDecayApplied: new Date("2026-06-07T21:00:00.000Z"),
    });

    const { buildRegionTurnoutResponse } = await import("./regionTurnout");
    const res = await buildRegionTurnoutResponse("MO", "US");

    // The filter must not constrain countryId — that is what broke the tab.
    expect(findOne).toHaveBeenCalledWith({ _id: "MO" });
    expect(res.turnout.race.white).toEqual({ baseline: 63, modifier: 7, actual: 70 });
    // Untouched groups still carry baselines with a zero modifier.
    expect(res.turnout.race.black).toEqual({ baseline: 60, modifier: 0, actual: 60 });
    expect(res.lastUpdated).toBe("2026-06-07T21:00:00.000Z");
  });

  it("returns US baselines with zero modifiers when no doc exists (e.g. DC)", async () => {
    await setTurnoutDoc(null);

    const { buildRegionTurnoutResponse } = await import("./regionTurnout");
    const res = await buildRegionTurnoutResponse("DC", "US");

    expect(res.turnout.race.white).toEqual({ baseline: 63, modifier: 0, actual: 63 });
    expect(res.turnout.age.senior).toEqual({ baseline: 76, modifier: 0, actual: 76 });
    expect(res.lastUpdated).toBeNull();
    expect(res.lastDecayApplied).toBeNull();
  });

  it("returns the voter-group bucket (not US Layer-1) for an archetype country", async () => {
    await setTurnoutDoc({
      _id: "JP-13",
      countryId: "JP",
      modifiers: { jp_voterGroups: { komeito_faithful: 3 } },
    });

    const { buildRegionTurnoutResponse } = await import("./regionTurnout");
    const res = await buildRegionTurnoutResponse("JP-13", "JP");

    expect(res.turnout.jp_voterGroups).toBeDefined();
    expect(res.turnout.race).toBeUndefined();
    expect(res.turnout.jp_voterGroups.komeito_faithful).toEqual({
      baseline: 72,
      modifier: 3,
      actual: 75,
    });
  });

  it("returns voter-group baselines with zero modifiers when an archetype region has no doc", async () => {
    await setTurnoutDoc(null);

    const { buildRegionTurnoutResponse } = await import("./regionTurnout");
    const res = await buildRegionTurnoutResponse("JP-99", "JP");

    expect(res.turnout.jp_voterGroups).toBeDefined();
    const firstGroup = Object.values(res.turnout.jp_voterGroups)[0];
    expect(firstGroup.modifier).toBe(0);
    expect(firstGroup.actual).toBe(firstGroup.baseline);
  });
});
