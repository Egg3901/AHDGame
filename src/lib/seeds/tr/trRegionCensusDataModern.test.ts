import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { seedTRDemographics } from "@/lib/admin/seed/seedTR";
import { trRegionCensusData } from "@/lib/seeds/tr/trRegionCensusData";
import { trRegionCensusData1953 } from "@/lib/seeds/tr/trRegionCensusData1953";
import { trRegionCensusDataModern } from "@/lib/seeds/tr/trRegionCensusDataModern";
import {
  TR_MODERN_AGE_SHARES,
  TR_MODERN_EDUCATION_SHARES,
  TR_MODERN_ETHNICITY_SHARES,
  TR_MODERN_URBANIZATION_SHARES,
} from "@/lib/seeds/tr/trRegionCensusDataModern";
import { getRegionCensusData } from "@/lib/seeds/regionCensusData";
import { TR_GEOGRAPHY } from "@/lib/countries/tr/geography";
import { trRegions } from "@/lib/seeds/tr/trRegions";
import { getTrModel } from "@/lib/countries/tr/layer1Model";

const ids = trRegions.map((region) => region._id);
const historicalPresets = [
  ["1953-default", trRegionCensusData1953],
  ["1979-default", trRegionCensusData],
  ["1991-default", trRegionCensusData],
  ["1999-default", trRegionCensusData],
  ["2007-default", trRegionCensusData],
] as const;
const modernPresets = ["2019-default", "2023-default", "2027-default"] as const;

function sum(values: object) {
  return Object.values(values).reduce((total, value) => total + Number(value), 0);
}

function dbWithDemographicCapture() {
  const stateRows = new Map<string, Record<string, unknown>>();
  const updates = vi.fn(async (filter: { _id: string }, update: { $set: object }) => {
    stateRows.set(filter._id, update.$set as Record<string, unknown>);
    return {
      acknowledged: true,
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 1,
    };
  });
  const collection = (name: string) =>
    name === "stateDemographics"
      ? { updateOne: updates, deleteMany: vi.fn() }
      : { updateOne: vi.fn(), deleteMany: vi.fn() };
  return {
    db: { collection } as unknown as Db,
    stateRows,
    updates,
  };
}

describe("Turkey modern Layer-1 source proxy profile", () => {
  it("uses eight existing IDs and finite, normalized dimensions", () => {
    expect(Object.keys(trRegionCensusDataModern)).toEqual(ids);
    for (const [regionId, profile] of Object.entries(trRegionCensusDataModern)) {
      for (const [dimension, shares] of Object.entries(profile)) {
        expect(Object.values(shares).every(Number.isFinite), `${regionId}/${dimension}`).toBe(true);
        expect(Object.values(shares).every((value) => value >= 0 && value <= 100)).toBe(true);
        expect(sum(shares), `${regionId}/${dimension}`).toBeCloseTo(100, 10);
      }
    }
  });

  it("pins adult-age inputs and normalizes rounded education rates without inventing vocational data", () => {
    expect(TR_MODERN_AGE_SHARES).toEqual({
      young: (15_520_699 / 63_166_343) * 100,
      mid: (19_161_049 / 63_166_343) * 100,
      mature: (19_761_789 / 63_166_343) * 100,
      senior: (8_722_806 / 63_166_343) * 100,
    });
    expect(sum(TR_MODERN_AGE_SHARES)).toBeCloseTo(100, 10);
    expect(TR_MODERN_EDUCATION_SHARES.vocational).toBe(0);
    expect(
      TR_MODERN_EDUCATION_SHARES.primary_or_below +
        TR_MODERN_EDUCATION_SHARES.secondary +
        TR_MODERN_EDUCATION_SHARES.university
    ).toBeCloseTo(100, 10);
    expect(TR_MODERN_URBANIZATION_SHARES).toEqual({
      urban: 67.9,
      suburban: 14.8,
      rural: 17.3,
    });
    expect(TR_MODERN_ETHNICITY_SHARES).toEqual({
      turkish: 80,
      kurdish: 14,
      other: 6,
    });
  });

  it("copies national proxies but carries region income shares forward explicitly", () => {
    for (const regionId of ids) {
      const modern = trRegionCensusDataModern[regionId]!;
      const legacy = trRegionCensusData[regionId]!;
      expect(modern.age).toEqual(TR_MODERN_AGE_SHARES);
      expect(modern.education).toEqual(TR_MODERN_EDUCATION_SHARES);
      expect(modern.urbanization).toEqual(TR_MODERN_URBANIZATION_SHARES);
      expect(modern.ethnicity).toEqual(TR_MODERN_ETHNICITY_SHARES);
      expect(modern.income).toEqual(legacy.income);
      expect(modern.income).not.toBe(legacy.income);
    }
  });

  it.each(historicalPresets)(
    "preserves effective historical generic census selection: %s",
    (preset, expected) => {
      expect(TR_GEOGRAPHY.censusBundles[preset]).toBe(expected);
      for (const regionId of ids) {
        expect(getRegionCensusData("TR", regionId, preset)).toBe(expected[regionId]);
      }
    }
  );

  it.each(modernPresets)(
    "routes generic and Layer-1 lookup to the modern source for %s",
    (preset) => {
      expect(TR_GEOGRAPHY.censusBundles[preset]).toBe(trRegionCensusDataModern);
      for (const regionId of ids) {
        expect(getRegionCensusData("TR", regionId, preset)).toBe(
          trRegionCensusDataModern[regionId]
        );
      }
      const era = preset.slice(0, 4) as "2019" | "2023" | "2027";
      const model = getTrModel(era);
      expect(Object.keys(model.census)).toEqual(ids);
      expect(model.positions).toBe(getTrModel("1979").positions);
      for (const regionId of ids) {
        expect(model.census[regionId]!.age).toEqual(TR_MODERN_AGE_SHARES);
        expect(model.census[regionId]!.income).toEqual(trRegionCensusData[regionId]!.income);
      }
    }
  );

  it("writes modern regional demographics through the actual seedTRDemographics path", async () => {
    const { db, stateRows, updates } = dbWithDemographicCapture();
    await seedTRDemographics(db, false, () => {}, "2027-default");
    expect(updates).toHaveBeenCalledTimes(ids.length);
    expect([...stateRows.keys()]).toEqual(ids);
    for (const regionId of ids) {
      const row = stateRows.get(regionId)!;
      expect(row.countryId).toBe("TR");
      const groups = row.groups as Record<string, { population: number }>;
      expect(Object.values(groups).reduce((n, group) => n + group.population, 0)).toBeCloseTo(
        100,
        1
      );
      expect(groups).toHaveProperty("kemalist_secular");
    }
  });
});
