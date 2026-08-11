import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(), getMongoClient: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn().mockResolvedValue(null),
}));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("corporateSectors");
  db.collection("corporations");
  db.collection("exchangeRates");
  db.collection("states");
  db.collection("unownedSectors");
});

describe("POST /api/corporations/[id]/sectors/[sectorId]/abandon", () => {
  it("returns the deleted sector revenue to the unowned pool before deleting it", async () => {
    const corpId = new ObjectId();
    const sectorId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as import("mongodb").Db);

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: "user-1" },
    } as never);

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: { _id: corpId },
    } as never);
    vi.mocked(requireCeo).mockReturnValue(null);

    // The command now CLAIMS the sector via findOneAndDelete (atomic guard against
    // a concurrent double-refund) rather than a plain findOne, so only the winning
    // request refunds. The returned doc drives the rest of the handler.
    db.collectionMocks.corporateSectors.findOneAndDelete.mockResolvedValue({
      _id: sectorId,
      corporationId: corpId,
      countryId: "US",
      stateId: "MN",
      sectorType: "energy",
      revenue: 1_543_872,
    });
    db.collectionMocks.corporations.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: async () => [{ _id: corpId, countryId: "US", liquidCurrencyCode: "USD" }],
      }),
    });
    db.collectionMocks.unownedSectors.findOneAndUpdate.mockResolvedValue(null);
    db.collectionMocks.corporateSectors.deleteMany.mockResolvedValue({ deletedCount: 1 });
    db.collectionMocks.states.findOne.mockResolvedValue({ _id: "MN", name: "Minnesota" });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/corporations/1/sectors/1/abandon"),
      {
        params: Promise.resolve({ id: "1", sectorId: sectorId.toString() }),
      }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.message).toContain("returned to the unowned pool");
    expect(db.collectionMocks.unownedSectors.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.corporateSectors.deleteMany).toHaveBeenCalledWith({
      _id: {
        $in: [sectorId],
      },
    });
  });
});
