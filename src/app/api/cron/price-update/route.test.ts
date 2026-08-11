import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/api/requireCron", () => ({ requireCron: vi.fn() }));
vi.mock("@/lib/api/requestLog", () => ({ logRequest: vi.fn() }));
vi.mock("@/lib/corporations/orderFlowEngine", () => ({
  computeOrderFlowMultiplier: vi.fn().mockReturnValue(1.0),
}));

function makeCursor<T>(docs: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    project: vi.fn().mockReturnThis(),
  };
}

describe("GET /api/cron/price-update", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
    db.collection("corporateSectors");
    db.collection("sentimentPulses");
    db.collectionMocks["sentimentPulses"].createIndex = vi.fn().mockResolvedValue("ttl_createdAt");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ isActive: true, isProcessing: false } as never);

    const { requireCron } = await import("@/lib/api/requireCron");
    vi.mocked(requireCron).mockReturnValue(true);
  });

  it("uses operating sector geography when applying sector-scoped pulses", async () => {
    const domesticCorpId = new ObjectId();
    const unaffectedCorpId = new ObjectId();
    const foreignOperatorCorpId = new ObjectId();

    db.collectionMocks["corporations"].find.mockReturnValue(
      makeCursor([
        {
          _id: domesticCorpId,
          countryId: "US",
          type: "technology",
          fundamentalSharePrice: 100,
          sharePrice: 100,
          publicFloat: 1_000,
          totalShares: 10_000,
        },
        {
          _id: unaffectedCorpId,
          countryId: "UK",
          type: "technology",
          fundamentalSharePrice: 100,
          sharePrice: 100,
          publicFloat: 1_000,
          totalShares: 10_000,
        },
        {
          _id: foreignOperatorCorpId,
          countryId: "UK",
          type: "technology",
          fundamentalSharePrice: 100,
          sharePrice: 100,
          publicFloat: 1_000,
          totalShares: 10_000,
        },
      ])
    );
    db.collectionMocks["corporateSectors"].find.mockReturnValue(
      makeCursor([
        { corporationId: domesticCorpId, countryId: "US", sectorType: "technology" },
        { corporationId: unaffectedCorpId, countryId: "UK", sectorType: "technology" },
        { corporationId: foreignOperatorCorpId, countryId: "US", sectorType: "technology" },
      ])
    );
    db.collectionMocks["sentimentPulses"].find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          scope: "sector",
          countryId: "US",
          sectorType: "technology",
          initialImpact: 0.1,
          decayRate: 0.8,
          createdAt: new Date(),
          eventType: "tariff_passed",
        },
      ])
    );

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/cron/price-update"));

    expect(response.status).toBe(200);
    expect(db.collectionMocks["corporations"].bulkWrite).toHaveBeenCalledTimes(1);
    const ops = db.collectionMocks["corporations"].bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { filter: { _id: ObjectId }; update: { $set: { sharePrice: number } } };
    }>;
    const priceByCorpId = new Map(
      ops.map((op) => [op.updateOne.filter._id.toString(), op.updateOne.update.$set.sharePrice])
    );

    expect(priceByCorpId.get(domesticCorpId.toString())).toBe(110);
    expect(priceByCorpId.get(foreignOperatorCorpId.toString())).toBe(110);
    expect(priceByCorpId.get(unaffectedCorpId.toString())).toBe(100);
  });

  it("skips when a turn is in progress with a fresh heartbeat", async () => {
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({
      isActive: true,
      isProcessing: true,
      processingHeartbeatAt: new Date(),
    } as never);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/cron/price-update"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ skipped: true });
    expect(db.collectionMocks["corporations"].bulkWrite).not.toHaveBeenCalled();
  });

  it("proceeds when isProcessing is true but the lock heartbeat is stale", async () => {
    // Mirrors the in-process cron stale-lock takeover. Without this, a stuck
    // isProcessing flag would also dead-end this HTTP cron path.
    const staleHeartbeat = new Date(Date.now() - 25 * 60 * 1000);
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({
      isActive: true,
      isProcessing: true,
      processingHeartbeatAt: staleHeartbeat,
    } as never);
    db.collectionMocks["corporations"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["corporateSectors"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["sentimentPulses"].find.mockReturnValue(makeCursor([]));

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/cron/price-update"));
    const body = await response.json();

    expect(response.status).toBe(200);
    // Stale lock → proceeded → returns the per-tick stats (no `skipped` flag)
    expect(body).not.toMatchObject({ skipped: true });
  });

  it("guards each per-corp update with a CAS on fundamentalSharePrice (race protection, bug #0449)", async () => {
    // Even after the consolidate route writes a scaled fundamentalSharePrice,
    // a cron pass that read pre-split corp state could still bulkWrite a
    // stale-fundamental-derived sharePrice and clobber the split. The cron's
    // updateOne filter must include fundamentalSharePrice so an intervening
    // writer's value-change makes the filter miss and the update no-ops.
    const corpId = new ObjectId();
    db.collectionMocks["corporations"].find.mockReturnValue(
      makeCursor([
        {
          _id: corpId,
          countryId: "US",
          type: "technology",
          fundamentalSharePrice: 80,
          sharePrice: 100,
          publicFloat: 1_000,
          totalShares: 10_000,
        },
      ])
    );
    db.collectionMocks["corporateSectors"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["sentimentPulses"].find.mockReturnValue(makeCursor([]));

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/cron/price-update"));

    expect(response.status).toBe(200);
    const ops = db.collectionMocks["corporations"].bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { filter: { _id: ObjectId; fundamentalSharePrice: number } };
    }>;
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.filter).toEqual({
      _id: corpId,
      fundamentalSharePrice: 80,
    });
  });
});
