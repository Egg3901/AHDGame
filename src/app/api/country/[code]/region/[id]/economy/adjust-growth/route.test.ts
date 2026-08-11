import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));

let db: MockDb;
const CHAR_ID = new ObjectId();
const CORP_ID = new ObjectId();
const SECTOR_ID = new ObjectId();

function makeRequest() {
  return new Request("http://localhost/api/country/US/region/TX/economy/adjust-growth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sectorId: SECTOR_ID.toString(), direction: "expand" }),
  });
}

const ctx = { params: Promise.resolve({ code: "US", id: "TX" }) };

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("corporations");
  db.collection("corporateSectors");
  db.collection("gameConfig");
  db.collection("centralBanks");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString(), character: { _id: CHAR_ID } },
  } as never);

  db.collectionMocks.corporations.findOne.mockResolvedValue({
    _id: CORP_ID,
    liquidCapital: 1_000_000_000,
  });
  db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
    _id: SECTOR_ID,
    corporationId: CORP_ID,
    stateId: "TX",
    revenue: 1_000_000,
    targetGrowthRate: 0,
  });
});

describe("POST .../economy/adjust-growth — the growth slider is dead under plants", () => {
  it("refuses to charge for growth under plants and names the real lever", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "plants",
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), ctx);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toMatch(/build capacity/i);
    // The whole point: no capital was moved. The turn processor zeroes
    // targetGrowthRate every plants turn, so charging here is a pure money sink.
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporateSectors.updateOne).not.toHaveBeenCalled();
  });

  it("still adjusts growth below plants", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "capital",
    });
    db.collectionMocks.centralBanks.findOne.mockResolvedValue({ _id: "US", primeRate: 5 });

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), ctx);

    expect(response.status).toBe(200);
    // Capital actually moved, which is what makes the plants case a regression.
    expect(db.collectionMocks.corporations.updateOne).toHaveBeenCalled();
  });
});
