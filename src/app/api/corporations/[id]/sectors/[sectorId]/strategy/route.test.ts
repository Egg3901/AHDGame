import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));

let db: MockDb;
const corpId = new ObjectId().toHexString();
const sectorId = new ObjectId().toHexString();
const userId = new ObjectId().toHexString();

async function wireDb() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
}

async function wireAuth() {
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId, isAdmin: false },
  } as never);
}

function jsonRequest(strategyId: string) {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ strategyId }),
  });
}

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("corporations");
  db.collection("corporateSectors");
  db.collection("gameState");
  db.collection("stateResourceCapacity");
  vi.mocked((await import("@/lib/api/rateLimit")).checkRateLimit).mockReturnValue({
    ok: true,
  } as never);
});

describe("POST /strategy", () => {
  it("rejects extraction strategies with no matching resource deposits", async () => {
    await wireDb();
    await wireAuth();
    const { POST } = await import("./route");

    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: new ObjectId(corpId),
      userId: new ObjectId(userId),
      ceoVacant: false,
      liquidCapital: 1_000_000,
      countryId: "US",
    });
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: new ObjectId(sectorId),
      corporationId: new ObjectId(corpId),
      stateId: "CA",
      sectorType: "extraction",
      strategyId: "standard",
      revenue: 100_000,
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 100,
    });
    db.collectionMocks.stateResourceCapacity.findOne.mockResolvedValue({
      stateId: "CA",
      resources: { timber: 10_000 },
    });

    const res = await POST(jsonRequest("iron_mining"), {
      params: Promise.resolve({ id: corpId, sectorId }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/no matching resource deposits/i);
    expect(db.collectionMocks.corporateSectors.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("allows multi-resource extraction strategies when at least one output has deposits", async () => {
    await wireDb();
    await wireAuth();
    const { POST } = await import("./route");

    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: new ObjectId(corpId),
      userId: new ObjectId(userId),
      ceoVacant: false,
      liquidCapital: 1_000_000,
      countryId: "US",
    });
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: new ObjectId(sectorId),
      corporationId: new ObjectId(corpId),
      stateId: "PA",
      sectorType: "extraction",
      strategyId: "standard",
      transitionFromStrategyId: null,
      revenue: 100_000,
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 100,
    });
    db.collectionMocks.stateResourceCapacity.findOne.mockResolvedValue({
      stateId: "PA",
      resources: { natural_gas: 1_200_000 },
    });

    const res = await POST(jsonRequest("oil_gas"), {
      params: Promise.resolve({ id: corpId, sectorId }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.strategyId).toBe("oil_gas");
    expect(db.collectionMocks.corporateSectors.updateOne).toHaveBeenCalled();
    expect(db.collectionMocks.corporateSectors.updateOne.mock.calls[0][1].$set.strategyId).toBe(
      "oil_gas"
    );
  });
});
