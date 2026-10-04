import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import {
  ABSENT_COUNTRY_REGION_COLLECTIONS,
  absentCountryIds,
  purgeAbsentCountryRegions,
} from "./purgeAbsentCountryRegions";

function fakeDb(counts: Record<string, number>) {
  const handles = new Map<string, { deleteMany: ReturnType<typeof vi.fn> }>();
  const db = {
    collection: (name: string) => {
      const handle = {
        deleteMany: vi.fn(async (_filter: unknown) => ({ deletedCount: counts[name] ?? 0 })),
      };
      handles.set(name, handle);
      return handle;
    },
  };
  return { db: db as unknown as Db, handles };
}

describe("absentCountryIds", () => {
  it("lists the republics a 1991 world models only as Soviet regions", () => {
    const ids = absentCountryIds("1991-default");
    expect(ids).toEqual(expect.arrayContaining(["UKR", "BLR", "BAL"]));
    expect(ids).not.toContain("UK");
    expect(ids).not.toContain("RU");
  });

  it("keeps the republics in the Cold War presets where they are seeded as latent", () => {
    expect(absentCountryIds("1979-default")).not.toContain("UKR");
    expect(absentCountryIds("1953-default")).not.toContain("UKR");
  });

  it("treats an unknown preset as having no absent countries", () => {
    expect(absentCountryIds("custom-preset")).toEqual([]);
  });
});

describe("purgeAbsentCountryRegions", () => {
  it("deletes only absent-country rows and reports per-collection counts", async () => {
    const { db, handles } = fakeDb({ states: 3, stateDemographics: 3 });
    const result = await purgeAbsentCountryRegions(db, "1991-default");
    expect(result.deleted).toEqual({ states: 3, stateDemographics: 3 });
    expect([...handles.keys()].sort()).toEqual([...ABSENT_COUNTRY_REGION_COLLECTIONS].sort());
    const filter = (handles.get("states")!.deleteMany as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as { countryId: { $in: string[] } };
    expect(filter.countryId.$in).toEqual(expect.arrayContaining(["UKR", "BLR", "BAL"]));
    expect(filter.countryId.$in).not.toContain("UK");
  });

  it("touches nothing when the preset has no absent countries", async () => {
    const { db, handles } = fakeDb({ states: 9 });
    const result = await purgeAbsentCountryRegions(db, "custom-preset");
    expect(result).toEqual({ countryIds: [], deleted: {} });
    expect(handles.size).toBe(0);
  });
});
