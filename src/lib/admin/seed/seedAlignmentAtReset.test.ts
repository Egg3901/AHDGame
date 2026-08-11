import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getPresetById } from "@/lib/constants/historicalSeats";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

/**
 * The core seed must plant opening alignments for the preset it is seeding, and
 * must do so REGARDLESS of the feature gate — flipping the gate on a live world
 * has to reveal a populated map, not blank rows.
 */
describe("core seed → country alignments", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    // Existing entityIds are read once up front, not probed per entity.
    db.collection("countryAlignments").find().toArray.mockResolvedValue([]);
  });

  // Rows are staged and written as one insertMany; flatten back to per-row.
  const inserted = () =>
    (db.collectionMocks.countryAlignments?.insertMany.mock.calls ?? []).flatMap(
      (c) => c[0] as { entityId: string; eraKey: string }[]
    );

  it("seeds every country in the 1953 preset", async () => {
    const { seedCountryAlignments } = await import("@/lib/alignment/seedAlignment");
    const preset = "1953-default";
    const countries = getPresetById(preset)!.countries;

    const n = await seedCountryAlignments(db as unknown as Db, preset, countries);

    // Every playable country, PLUS the sphere-macro entities alignment now owns.
    expect(n).toBeGreaterThan(countries.length);
    expect(inserted().map((r) => r.entityId)).toEqual(expect.arrayContaining([...countries]));
    for (const row of inserted()) expect(row.eraKey).toBe("cold-war");
  });

  it("seeds the modern preset in its own era", async () => {
    const { seedCountryAlignments } = await import("@/lib/alignment/seedAlignment");
    const preset = "2019-default";
    const countries = getPresetById(preset)!.countries;

    await seedCountryAlignments(db as unknown as Db, preset, countries);

    // 2019 has no sphere-macro tier, so the playable roster is nearly the whole
    // set — plus Nigeria, which is not playable in 2019 but sits in the
    // Commonwealth, and every org member is owed a row.
    const keys = inserted().map((r) => r.entityId);
    expect(keys).toEqual(expect.arrayContaining([...countries]));
    expect(keys).toContain("NG");
    expect(inserted()).toHaveLength(countries.length + 1);
    for (const row of inserted()) expect(row.eraKey).toBe("post-cold-war");
  });

  it("does not consult the feature gate — seeding is deliberately gate-independent", async () => {
    // No gameState is mocked at all. If seeding read the flag it would throw or
    // silently skip; it must plant rows either way.
    const { seedCountryAlignments } = await import("@/lib/alignment/seedAlignment");
    const countries = getPresetById("1953-default")!.countries;
    const n = await seedCountryAlignments(db as unknown as Db, "1953-default", countries);
    expect(n).toBeGreaterThanOrEqual(countries.length);
  });

  it("plants nothing for the empty preset", async () => {
    // An unknown preset resolves its YEAR from the default, which is how org
    // rosters first leaked in here: a world meant to contain nothing was handed
    // a 2019 calendar and seated all of NATO.
    const { seedCountryAlignments } = await import("@/lib/alignment/seedAlignment");
    const n = await seedCountryAlignments(db as unknown as Db, "empty", []);
    expect(n).toBe(0);
    expect(inserted()).toEqual([]);
  });
});
