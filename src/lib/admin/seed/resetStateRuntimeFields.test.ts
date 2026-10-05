import type { Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { resetStateRuntimeFields, STATE_RUNTIME_UNSET_FIELDS } from "./resetStateRuntimeFields";

describe("resetStateRuntimeFields", () => {
  it("clears campaign-owned fields and preserves authored region baselines", async () => {
    const rows: Record<string, unknown>[] = [
      {
        _id: "ENG",
        countryId: "UK",
        regionType: "nation",
        parentRegionId: "GBR",
        name: "England",
        population: 50_000_000,
        gdp: 1_000_000,
        houseDistricts: 533,
        stateSenateSeats: 0,
        region: "Midlands",
        bannerImage: "england.webp",
        sectorSpecializations: { primary: "manufacturing", secondary: "energy" },
        votingEligiblePopulation: 40_000_000,
        workingAgePopulation: 30_000_000,
        militaryServicePopulation: 500_000,
        capitalStock: 4_000_000,
        conflictCapacityApplied: [{ id: "war-1" }],
        outputGap: 8,
        sectorRealizedRevenue: 123,
        sectorRealizedRevenueTurn: 400,
        sectorRealizedRevenueUnit: "host",
        sectorRevenueEma: 111,
        sectorRevenueSnapshots: [{ turn: 390, value: 100 }],
        sectorOutputEma: 222,
        sectorOutputSnapshots: [{ turn: 390, value: 200 }],
        corpGrowthInvestmentAnchor: 7,
        corpGrowthInvestmentTurn: 400,
        topSectorsCache: { sectors: [{ sectorType: "energy" }] },
        admittedYear: 1959,
        votingSystem: "rcv",
        politicalLean: -3,
        cachedEconomicLean: -2,
        cachedSocialLean: 1,
        demographicsLastUpdated: new Date("1953-01-01"),
      },
    ];
    const collection = {
      updateMany: async (_filter: unknown, update: { $unset: Record<string, string> }) => {
        let modifiedCount = 0;
        for (const row of rows) {
          let modified = false;
          for (const path of Object.keys(update.$unset))
            modified = unsetPath(row, path) || modified;
          if (modified) modifiedCount += 1;
        }
        return { modifiedCount };
      },
    };
    const db = { collection: () => collection } as unknown as Db;

    const modified = await resetStateRuntimeFields(db);

    expect(modified).toBe(1);
    expect(rows[0]).toEqual({
      _id: "ENG",
      countryId: "UK",
      regionType: "nation",
      parentRegionId: "GBR",
      name: "England",
      population: 50_000_000,
      gdp: 1_000_000,
      houseDistricts: 533,
      stateSenateSeats: 0,
      region: "Midlands",
      bannerImage: "england.webp",
      sectorSpecializations: { primary: "manufacturing", secondary: "energy" },
    });
    expect(STATE_RUNTIME_UNSET_FIELDS).toContain("outputGap");
    expect(STATE_RUNTIME_UNSET_FIELDS).toContain("capitalStock");
    expect(STATE_RUNTIME_UNSET_FIELDS).toContain("topSectorsCache");
  });
});

function unsetPath(document: Record<string, unknown>, path: string): boolean {
  const parts = path.split(".");
  const leaf = parts.pop();
  let current: Record<string, unknown> | undefined = document;
  for (const part of parts) {
    const next = current?.[part];
    if (typeof next !== "object" || next === null || Array.isArray(next)) return false;
    current = next as Record<string, unknown>;
  }
  if (!leaf || !current || !(leaf in current)) return false;
  delete current[leaf];
  return true;
}
