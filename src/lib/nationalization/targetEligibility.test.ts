import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Corporation } from "@/lib/db/types";

vi.mock("./strategicSectors", () => ({
  getDesignatedSectorTypes: vi.fn().mockResolvedValue(new Set<string>()),
  corpHasStrategicSector: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/corporations/marketShare", () => ({
  fetchMarketSharePercentForSectors: vi.fn().mockResolvedValue(new Map<string, number>()),
}));

function cursor<T>(rows: T[]) {
  return { toArray: vi.fn().mockResolvedValue(rows), sort: vi.fn().mockReturnThis() };
}

describe("resolveCorpEligibility", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const n of ["bonds", "corporateSectors"]) db.collection(n);
    db.collectionMocks.bonds.distinct.mockResolvedValue([]);
    db.collectionMocks.corporateSectors.find.mockReturnValue(cursor([]));
  });

  it("classifies an NPC corp as executively takeable", async () => {
    const { resolveCorpEligibility } = await import("./targetEligibility");
    const corp = {
      _id: new ObjectId(),
      liquidCapital: 100,
      userId: null,
    } as unknown as Corporation;
    const r = await resolveCorpEligibility(db as unknown as Db, "US", corp, 100);
    expect(r.ownerKind).toBe("npc");
    expect(r.result.eligible).toBe(true);
    expect(r.executivelyTakeable).toBe(true);
  });

  it("a solvent player corp is eligible-gated: NOT executively takeable", async () => {
    const { resolveCorpEligibility } = await import("./targetEligibility");
    const corp = {
      _id: new ObjectId(),
      liquidCapital: 1000,
      userId: new ObjectId(),
    } as unknown as Corporation;
    const r = await resolveCorpEligibility(db as unknown as Db, "US", corp, 100);
    expect(r.ownerKind).toBe("player");
    expect(r.executivelyTakeable).toBe(false);
  });

  it("a long-insolvent player corp (past the grace window) is distressed → executively takeable", async () => {
    const { resolveCorpEligibility } = await import("./targetEligibility");
    // distress started turn 0, currentTurn 100 ⇒ 100 turns ≥ 72-turn grace
    const corp = {
      _id: new ObjectId(),
      liquidCapital: -50,
      userId: new ObjectId(),
      financialDistressSinceTurn: 0,
    } as unknown as Corporation;
    const r = await resolveCorpEligibility(db as unknown as Db, "US", corp, 100);
    expect(r.result.isDistressed).toBe(true);
    expect(r.executivelyTakeable).toBe(true);
  });

  it("a freshly-insolvent player corp (within the grace window) is NOT yet executively takeable", async () => {
    const { resolveCorpEligibility } = await import("./targetEligibility");
    // distress started turn 90, currentTurn 100 ⇒ 10 turns < 72-turn grace
    const corp = {
      _id: new ObjectId(),
      liquidCapital: -50,
      userId: new ObjectId(),
      financialDistressSinceTurn: 90,
    } as unknown as Corporation;
    const r = await resolveCorpEligibility(db as unknown as Db, "US", corp, 100);
    expect(r.result.isDistressed).toBe(false);
    expect(r.executivelyTakeable).toBe(false);
  });

  it("an insolvent player corp with no distress clock yet is NOT takeable (treated as in-grace)", async () => {
    const { resolveCorpEligibility } = await import("./targetEligibility");
    const corp = {
      _id: new ObjectId(),
      liquidCapital: -50,
      userId: new ObjectId(),
    } as unknown as Corporation;
    const r = await resolveCorpEligibility(db as unknown as Db, "US", corp, 100);
    expect(r.executivelyTakeable).toBe(false);
  });

  it("batch: resolves a whole pool with one sectors query and no per-corp bond counts", async () => {
    const { resolveCorpEligibilityBatch } = await import("./targetEligibility");
    const { fetchMarketSharePercentForSectors } = await import("@/lib/corporations/marketShare");

    const npcId = new ObjectId();
    const playerId = new ObjectId();
    const sectorId = new ObjectId();
    // NPC corp has a defaulted bond and one sector at 42% share.
    db.collectionMocks.bonds.distinct.mockResolvedValue([npcId]);
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        {
          _id: sectorId,
          corporationId: npcId,
          countryId: "US",
          stateId: "CA",
          sectorType: "tech",
          revenue: 10,
        },
      ])
    );
    vi.mocked(fetchMarketSharePercentForSectors).mockResolvedValue(
      new Map([[String(sectorId), 42]])
    );

    const corps = [
      { _id: npcId, liquidCapital: 100, userId: null },
      { _id: playerId, liquidCapital: 1000, userId: new ObjectId() },
    ] as unknown as Corporation[];
    const out = await resolveCorpEligibilityBatch(db as unknown as Db, "US", corps, 100);

    expect(out.size).toBe(2);
    const npc = out.get(String(npcId))!;
    expect(npc.ownerKind).toBe("npc");
    expect(npc.executivelyTakeable).toBe(true);
    expect(npc.sectorCount).toBe(1);
    const player = out.get(String(playerId))!;
    expect(player.ownerKind).toBe("player");
    expect(player.executivelyTakeable).toBe(false);
    expect(player.sectorCount).toBe(0);

    // Fixed query plan: one batched sectors find, one bonds distinct, no
    // per-corp countDocuments round-trips.
    expect(db.collectionMocks.corporateSectors.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.bonds.distinct).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.bonds.countDocuments).not.toHaveBeenCalled();
    expect(fetchMarketSharePercentForSectors).toHaveBeenCalledTimes(1);
  });

  it("batch: returns an empty map without querying when given no corps", async () => {
    const { resolveCorpEligibilityBatch } = await import("./targetEligibility");
    const out = await resolveCorpEligibilityBatch(db as unknown as Db, "US", [], 100);
    expect(out.size).toBe(0);
    expect(db.collectionMocks.corporateSectors.find).not.toHaveBeenCalled();
    expect(db.collectionMocks.bonds.distinct).not.toHaveBeenCalled();
  });
});
