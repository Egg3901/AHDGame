import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { State } from "@/lib/db/types";
import { seedTRRegions } from "@/lib/admin/seed/seedTR";
import { TR_GEOGRAPHY } from "../geography";
import { trRegions } from "./trRegions";
import { trRegions1953 } from "./trRegions1953";
import { trRegions1991 } from "./trRegions1991";
import { trRegions2013 } from "./trRegions2013";
import {
  TR_2023_OBSERVED_POPULATION,
  TR_2023_SOURCE_POPULATION,
  TR_MODERN_GAME_GDP,
  TR_MODERN_GAME_POPULATION,
  TR_MODERN_HOUSE_SEATS,
  trRegionsModern,
} from "./trRegionsModern";

function rowWithoutId(region: State): Omit<State, "_id"> {
  const { _id, ...row } = region;
  void _id;
  return row;
}

function makeDb() {
  const states = {
    bulkWrite: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
  };
  const db = { collection: vi.fn(() => states) } as unknown as Db;
  return { db, states };
}

async function writtenRows(preset: string) {
  const { db, states } = makeDb();
  await seedTRRegions(db, false, () => {}, preset);
  const operations = states.bulkWrite.mock.calls[0]![0] as Array<{
    updateOne: {
      filter: { _id: string };
      update: { $set: Record<string, unknown> };
    };
  }>;
  return operations.map((operation) => ({
    id: operation.updateOne.filter._id,
    row: operation.updateOne.update.$set,
  }));
}

describe("Turkey modern regional population source and seed routes", () => {
  it("allocates the 2023 source weights to the fixed game anchors", () => {
    expect(Object.values(TR_2023_SOURCE_POPULATION).reduce((sum, value) => sum + value, 0)).toBe(
      TR_2023_OBSERVED_POPULATION
    );
    expect(trRegionsModern.map((region) => region._id)).toEqual(
      trRegions.map((region) => region._id)
    );
    expect(trRegionsModern.reduce((sum, region) => sum + region.population, 0)).toBe(
      TR_MODERN_GAME_POPULATION
    );
    expect(trRegionsModern.reduce((sum, region) => sum + region.gdp, 0)).toBe(TR_MODERN_GAME_GDP);
    expect(trRegionsModern.reduce((sum, region) => sum + region.houseDistricts, 0)).toBe(
      TR_MODERN_HOUSE_SEATS
    );
    expect(trRegionsModern.every((region) => region.stateSenateSeats === 0)).toBe(true);
    expect(trRegionsModern.map((region) => region.houseDistricts)).toEqual([
      197, 41, 77, 76, 52, 43, 66, 48,
    ]);
    expect(trRegionsModern.map((region) => region.population)).toEqual([
      27_414_237, 5_669_403, 10_693_874, 10_600_394, 7_291_366, 5_928_337, 9_193_208, 6_609_181,
    ]);
  });

  it.each(["2019-default", "2023-default", "2027-default"])(
    "uses the same explicit modern geography in registry and seed writes for %s",
    async (preset) => {
      expect(TR_GEOGRAPHY.regionBundles[preset as keyof typeof TR_GEOGRAPHY.regionBundles]).toBe(
        trRegionsModern
      );
      const written = await writtenRows(preset);
      expect(written).toHaveLength(trRegionsModern.length);
      expect(written.map(({ id }) => id)).toEqual(trRegionsModern.map((region) => region._id));
      written.forEach(({ id, row }, index) => {
        expect(row, `${preset}/${id}`).toEqual(rowWithoutId(trRegionsModern[index]!));
      });
    }
  );

  it.each([
    ["1953-default", trRegions1953],
    ["1979-default", trRegions],
    ["1991-default", trRegions1991],
  ] as const)(
    "preserves historical region identity and writes for %s",
    async (preset, expected) => {
      expect(TR_GEOGRAPHY.regionBundles[preset]).toBe(expected);
      const written = await writtenRows(preset);
      expect(written).toHaveLength(expected.length);
      written.forEach(({ id, row }, index) => {
        expect(id).toBe(expected[index]!._id);
        expect(row, `${preset}/${id}`).toEqual(rowWithoutId(expected[index]!));
      });
    }
  );

  it.each(["1999-default", "2007-default"])(
    "keeps the existing 2013-proxy writer rows while explicitly aligning the registry for %s",
    async (preset) => {
      // Direct seeding already fell back to the old 2013-weighted bundle. The
      // geography registry used to point at trRegions (1979); this patch
      // intentionally reconciles that reader mismatch without changing writer rows.
      expect(TR_GEOGRAPHY.regionBundles[preset]).toBe(trRegions2013);
      const written = await writtenRows(preset);
      expect(written).toHaveLength(trRegions2013.length);
      written.forEach(({ id, row }, index) => {
        expect(id).toBe(trRegions2013[index]!._id);
        expect(row, `${preset}/${id}`).toEqual(rowWithoutId(trRegions2013[index]!));
      });
    }
  );
});
