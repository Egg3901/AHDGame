import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { getCountryConfig } from "@/lib/constants/countries";
import { bgRegions2027 } from "@/lib/countries/bg/data/bgRegions2027";
import { bgParties } from "@/lib/countries/bg/data/bgParties";
import { selectPartyRosterForPreset } from "@/lib/seeds/ensureDefaultParties";
import { seedBG2027 } from "./seedBG2027";

function mockDb() {
  const calls: Record<string, ReturnType<typeof vi.fn>> = {};
  const collection = (name: string) => {
    calls[name] ??= vi.fn();
    return {
      deleteMany: vi.fn().mockResolvedValue({}),
      bulkWrite: calls[name],
      updateOne: calls[name],
      insertOne: calls[name],
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      findOneAndUpdate: vi.fn().mockResolvedValue({ seq: 1 }),
    };
  };
  return { db: { collection } as unknown as Db, calls };
}

describe("BG 2027 political substrate", () => {
  it("uses six observed NSI regions, 240 seats, and the five 2026 seat-winning lists", () => {
    expect(bgRegions2027).toHaveLength(6);
    expect(bgRegions2027.reduce((sum, r) => sum + r.population, 0)).toBe(6_423_207);
    expect(bgRegions2027.reduce((sum, r) => sum + r.houseDistricts, 0)).toBe(240);
    expect(bgRegions2027.reduce((sum, r) => sum + r.gdp, 0)).toBe(204_907);
    expect(
      selectPartyRosterForPreset(bgParties, "2027-default").map((p) => p.abbreviation)
    ).toEqual(["PB", "GERB-SDS", "PP-DB", "DPS", "V"]);
    expect(
      selectPartyRosterForPreset(bgParties, "1979-default").map((p) => p.abbreviation)
    ).toEqual(["BKP"]);
    expect(getCountryConfig("BG", "2027-default").legislature.lowerChamber.seats).toBe(240);
    expect(getCountryConfig("BG", "1979-default").legislature.lowerChamber.seats).toBe(400);
  });

  it("actually writes regions and a pending 240-seat formation only for 2027", async () => {
    const { db, calls } = mockDb();
    await seedBG2027(db, true, () => {}, "2027-default");
    expect(calls.states!).toHaveBeenCalledTimes(1);
    expect(calls.states!.mock.calls[0]?.[0]).toHaveLength(6);
    const formation = calls.governmentFormations!.mock.calls[0]?.[1]?.$set;
    expect(formation).toMatchObject({
      countryId: "BG",
      totalSeats: 240,
      majorityThreshold: 121,
      status: "pending",
    });
    const cold = mockDb();
    await seedBG2027(cold.db, true, () => {}, "1979-default");
    expect(cold.calls.states).toBeUndefined();
  });
});
