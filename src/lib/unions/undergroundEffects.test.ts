import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  UNDERGROUND_DENSITY_CAP,
  UNDERGROUND_SLOWDOWN_MAX,
  countryUndergroundIntensity,
  loadUndergroundStrengthByCountrySector,
  undergroundDensityAfterBanTurn,
  undergroundOutputFactor,
  undergroundSectorKey,
} from "./undergroundEffects";

describe("underground sector effects", () => {
  it("keeps density alive below 35 and never gains at the legal rate", () => {
    expect(undergroundDensityAfterBanTurn(0, 0)).toBe(0);
    expect(undergroundDensityAfterBanTurn(0, 35)).toBe(0.6);
    expect(undergroundDensityAfterBanTurn(20, 35)).toBe(20.6);
    expect(undergroundDensityAfterBanTurn(40, 100)).toBe(37);
    expect(undergroundDensityAfterBanTurn(35, 100)).toBe(UNDERGROUND_DENSITY_CAP);
    expect(undergroundDensityAfterBanTurn(3, Number.NaN)).toBe(0);
  });

  it("caps passive slowdown well below a full strike", () => {
    expect(undergroundOutputFactor(0)).toBe(1);
    expect(undergroundOutputFactor(15)).toBe(1);
    expect(undergroundOutputFactor(25)).toBeCloseTo(0.96);
    expect(undergroundOutputFactor(10_000)).toBe(1 - UNDERGROUND_SLOWDOWN_MAX);
  });

  it("uses the strongest cell per industry and ignores other countries", async () => {
    const rows = [
      {
        _id: new ObjectId(),
        countryId: "US",
        sectorType: "manufacturing",
        undergroundStrength: 12,
      },
      {
        _id: new ObjectId(),
        countryId: "US",
        sectorType: "manufacturing",
        undergroundStrength: 30,
      },
      { _id: new ObjectId(), countryId: "US", sectorType: "logistics", undergroundStrength: 8 },
      {
        _id: new ObjectId(),
        countryId: "UK",
        sectorType: "manufacturing",
        undergroundStrength: 100,
      },
    ];
    const find = vi.fn().mockReturnValue({ toArray: async () => rows });
    const db = { collection: () => ({ find }) } as unknown as Db;
    const strength = await loadUndergroundStrengthByCountrySector(db, new Set(["US"]));
    expect(strength.get(undergroundSectorKey("US", "manufacturing"))).toBe(30);
    expect(strength.get(undergroundSectorKey("US", "logistics"))).toBe(8);
    expect(strength.has(undergroundSectorKey("UK", "manufacturing"))).toBe(false);
    expect(find).toHaveBeenCalledWith(
      { countryId: { $in: ["US"] }, undergroundStrength: { $gt: 0 } },
      { projection: { countryId: 1, sectorType: 1, undergroundStrength: 1 } }
    );
    expect(await countryUndergroundIntensity(db, "US")).toBeCloseTo(30 / 35);
  });
});
