import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb, bulkOps } from "@/lib/test-utils/mockDb";

/** Länder that belong to the GDR (DD) in the divided-Germany presets. */
const EASTERN_LAENDER = ["BB", "MV", "SN", "ST", "TH"] as const;

function macroWriteIds(db: MockDb): string[] {
  return bulkOps(db.collectionMocks.macroMetrics!.bulkWrite).map(
    (call) => (call[0] as { _id: string })._id
  );
}

describe("seedDEStateMetrics — writes only the regions DE governs in the preset", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  // Regression: DE seeded the modern 16-Land metrics bundle into a 1953 world.
  // `macroMetrics` is keyed by the bare region code with no country namespace,
  // so those five rows overwrote the GDR's own economy and left East Germany
  // running West German income, growth and urbanization.
  it("does not write the eastern Länder in 1953, where they belong to DD", async () => {
    const { seedDEStateMetrics } = await import("@/lib/admin/seed/seedDE");
    await seedDEStateMetrics(db as unknown as Db, false, () => {}, "1953-default");

    const written = macroWriteIds(db);
    for (const land of EASTERN_LAENDER) {
      expect(written).not.toContain(land);
    }
    expect(written).toContain("BW");
  });

  it("writes the eastern Länder in 2019, where Germany is reunified", async () => {
    const { seedDEStateMetrics } = await import("@/lib/admin/seed/seedDE");
    await seedDEStateMetrics(db as unknown as Db, false, () => {}, "2019-default");

    const written = macroWriteIds(db);
    for (const land of EASTERN_LAENDER) {
      expect(written).toContain(land);
    }
  });

  it("writes one metrics row per region it seeds as a state", async () => {
    const { seedDEStateMetrics, seedDERegions } = await import("@/lib/admin/seed/seedDE");

    const statesDb = createMockDb();
    await seedDERegions(statesDb as unknown as Db, false, () => {}, "1953-default");
    const stateIds = bulkOps(statesDb.collectionMocks.states!.bulkWrite).map(
      (call) => (call[0] as { _id: string })._id
    );

    await seedDEStateMetrics(db as unknown as Db, false, () => {}, "1953-default");
    expect(macroWriteIds(db).sort()).toEqual([...stateIds].sort());
  });

  it("scopes the reset delete to the preset roster, not the modern bundle", async () => {
    const { seedDEStateMetrics } = await import("@/lib/admin/seed/seedDE");
    await seedDEStateMetrics(db as unknown as Db, true, () => {}, "1953-default");

    const deleted = db.collectionMocks.macroMetrics!.deleteMany.mock.calls[0]![0] as {
      _id: { $in: string[] };
    };
    for (const land of EASTERN_LAENDER) {
      expect(deleted._id.$in).not.toContain(land);
    }
  });
});
