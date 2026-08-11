import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function mockModifiers(db: MockDb, docs: unknown[]) {
  // Collection mocks are lazily created on first `db.collection(name)` call —
  // touch it before reaching into `collectionMocks` (see ahd-test-patterns).
  db.collection("countryModifiers");
  db.collectionMocks.countryModifiers!.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(docs),
  });
}

describe("loadActiveSectorDemandModifierPctMap", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("sums multiple active modifiers for the same country+sector", async () => {
    mockModifiers(db, [
      { countryId: "UK", sectorType: "entertainment", pct: 8, expiresAtTurn: 100 },
      { countryId: "UK", sectorType: "entertainment", pct: 5, expiresAtTurn: 100 },
    ]);

    const { loadActiveSectorDemandModifierPctMap } = await import("./sectorDemandModifierMap");
    const map = await loadActiveSectorDemandModifierPctMap(db as unknown as Db, 10);

    expect(map.get("UK:entertainment")).toBe(13);
  });

  it("clamps a stacked total to the total cap", async () => {
    mockModifiers(db, [
      { countryId: "US", sectorType: "technology", pct: 15, expiresAtTurn: 100 },
      { countryId: "US", sectorType: "technology", pct: 15, expiresAtTurn: 100 },
    ]);

    const { loadActiveSectorDemandModifierPctMap, SECTOR_DEMAND_MODIFIER_TOTAL_CAP_PCT } =
      await import("./sectorDemandModifierMap");
    const map = await loadActiveSectorDemandModifierPctMap(db as unknown as Db, 10);

    expect(map.get("US:technology")).toBe(SECTOR_DEMAND_MODIFIER_TOTAL_CAP_PCT);
  });

  it("clamps a stacked negative total to the negative cap", async () => {
    mockModifiers(db, [
      { countryId: "DE", sectorType: "manufacturing", pct: -15, expiresAtTurn: 100 },
      { countryId: "DE", sectorType: "manufacturing", pct: -15, expiresAtTurn: 100 },
    ]);

    const { loadActiveSectorDemandModifierPctMap, SECTOR_DEMAND_MODIFIER_TOTAL_CAP_PCT } =
      await import("./sectorDemandModifierMap");
    const map = await loadActiveSectorDemandModifierPctMap(db as unknown as Db, 10);

    expect(map.get("DE:manufacturing")).toBe(-SECTOR_DEMAND_MODIFIER_TOTAL_CAP_PCT);
  });

  it("keeps unrelated country+sector keys isolated", async () => {
    mockModifiers(db, [
      { countryId: "UK", sectorType: "entertainment", pct: 8, expiresAtTurn: 100 },
      { countryId: "US", sectorType: "technology", pct: 6, expiresAtTurn: 100 },
    ]);

    const { loadActiveSectorDemandModifierPctMap } = await import("./sectorDemandModifierMap");
    const map = await loadActiveSectorDemandModifierPctMap(db as unknown as Db, 10);

    expect(map.get("UK:entertainment")).toBe(8);
    expect(map.get("US:technology")).toBe(6);
  });

  it("returns an empty map when no modifiers are active", async () => {
    const { loadActiveSectorDemandModifierPctMap } = await import("./sectorDemandModifierMap");
    const map = await loadActiveSectorDemandModifierPctMap(db as unknown as Db, 10);

    expect(map.size).toBe(0);
  });
});
