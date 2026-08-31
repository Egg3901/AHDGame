import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/corporations/commands/privatization/openVoteGuard", () => ({
  hasOpenPrivatizationVote: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/wireEvent", () => ({
  logWireEvent: vi.fn(),
  wireHeadlineDividend: vi.fn().mockReturnValue("headline"),
}));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));

describe("POST corporation dividends", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
    const corporation = {
      _id: new ObjectId(),
      sequentialId: 7,
      name: "Acme",
      userId: new ObjectId(),
      dividendRate: 5,
    };
    const { getDb } = await import("@/lib/mongodb");
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: corporation.userId.toString() },
    } as never);
    vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation } as never);
  });

  it("allows only one concurrent request to claim the cooldown", async () => {
    db.collectionMocks.corporations.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/corporations/7/dividends", {
        method: "POST",
        body: JSON.stringify({ dividendRate: 10 }),
      }),
      { params: Promise.resolve({ id: "7" }) }
    );

    expect(response.status).toBe(429);
    const filter = db.collectionMocks.corporations.updateOne.mock.calls[0][0];
    expect(filter.$or).toEqual([
      { lastDividendChange: { $exists: false } },
      { lastDividendChange: { $lte: expect.any(Date) } },
    ]);
  });
});
