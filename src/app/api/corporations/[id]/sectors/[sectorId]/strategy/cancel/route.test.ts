import { describe, it, expect, vi, beforeEach } from "vitest";
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

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  // Pre-register collections so collectionMocks are accessible
  db.collection("corporations");
  db.collection("corporateSectors");
  db.collection("gameState");
  vi.mocked((await import("@/lib/api/rateLimit")).checkRateLimit).mockReturnValue({
    ok: true,
  } as never);
});

describe("POST /strategy/cancel", () => {
  it("returns 404 when sector not found", async () => {
    await wireDb();
    await wireAuth();
    const { POST } = await import("./route");

    db.collectionMocks["corporations"]!.findOne.mockResolvedValue({
      _id: new ObjectId(corpId),
      userId,
      ceoId: userId,
      ceoVacant: false,
      liquidCapital: 1_000_000,
      countryId: "US",
    });
    db.collectionMocks["corporateSectors"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 100,
    });

    const res = await POST(new Request("http://localhost/api/test", { method: "POST" }), {
      params: Promise.resolve({ id: corpId, sectorId }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when no transition in progress", async () => {
    await wireDb();
    await wireAuth();
    const { POST } = await import("./route");

    db.collectionMocks["corporations"]!.findOne.mockResolvedValue({
      _id: new ObjectId(corpId),
      userId,
      ceoId: userId,
      ceoVacant: false,
      liquidCapital: 1_000_000,
      countryId: "US",
    });
    db.collectionMocks["corporateSectors"]!.findOne.mockResolvedValue({
      _id: new ObjectId(sectorId),
      corporationId: new ObjectId(corpId),
      strategyId: "standard",
      transitionFromStrategyId: null,
      revenue: 100_000,
    });
    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 100,
    });

    const res = await POST(new Request("http://localhost/api/test", { method: "POST" }), {
      params: Promise.resolve({ id: corpId, sectorId }),
    });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/no transition/i);
  });

  it("returns 400 when already reversing", async () => {
    await wireDb();
    await wireAuth();
    const { POST } = await import("./route");

    db.collectionMocks["corporations"]!.findOne.mockResolvedValue({
      _id: new ObjectId(corpId),
      userId,
      ceoId: userId,
      ceoVacant: false,
      liquidCapital: 1_000_000,
      countryId: "US",
    });
    db.collectionMocks["corporateSectors"]!.findOne.mockResolvedValue({
      _id: new ObjectId(sectorId),
      corporationId: new ObjectId(corpId),
      strategyId: "standard",
      transitionFromStrategyId: "oil_gas",
      transitionStartTurn: 90,
      isReversing: true,
      revenue: 100_000,
    });
    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 100,
    });

    const res = await POST(new Request("http://localhost/api/test", { method: "POST" }), {
      params: Promise.resolve({ id: corpId, sectorId }),
    });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/already reversing/i);
  });

  it("returns 400 when insufficient funds", async () => {
    await wireDb();
    await wireAuth();
    const { POST } = await import("./route");

    db.collectionMocks["corporations"]!.findOne.mockResolvedValue({
      _id: new ObjectId(corpId),
      userId,
      ceoId: userId,
      ceoVacant: false,
      liquidCapital: 0,
      countryId: "US",
    });
    db.collectionMocks["corporateSectors"]!.findOne.mockResolvedValue({
      _id: new ObjectId(sectorId),
      corporationId: new ObjectId(corpId),
      strategyId: "oil_gas",
      transitionFromStrategyId: "standard",
      transitionStartTurn: 94, // elapsed=6, progress=0.5, cost=5000
      revenue: 100_000,
    });
    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 100,
    });

    const res = await POST(new Request("http://localhost/api/test", { method: "POST" }), {
      params: Promise.resolve({ id: corpId, sectorId }),
    });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/insufficient/i);
  });

  it("flips transition and charges scaled cost on success", async () => {
    await wireDb();
    await wireAuth();
    const { POST } = await import("./route");

    // 6 turns elapsed out of 12 → progress = 0.5
    // cost = round(0.5 × 0.1 × 100_000) = 5_000
    // reversalTurns = max(1, round(0.5 × 12)) = 6
    // newTransitionStartTurn = 100 - (12 - 6) = 94
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue({
      _id: new ObjectId(corpId),
      userId,
      ceoId: userId,
      ceoVacant: false,
      liquidCapital: 100_000,
      countryId: "US",
    });
    db.collectionMocks["corporateSectors"]!.findOne.mockResolvedValue({
      _id: new ObjectId(sectorId),
      corporationId: new ObjectId(corpId),
      strategyId: "oil_gas",
      transitionFromStrategyId: "standard",
      transitionStartTurn: 94,
      revenue: 100_000,
    });
    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 100,
    });
    db.collectionMocks["corporations"]!.updateOne.mockResolvedValue({ modifiedCount: 1 } as never);
    db.collectionMocks["corporateSectors"]!.updateOne.mockResolvedValue({
      modifiedCount: 1,
    } as never);

    const res = await POST(new Request("http://localhost/api/test", { method: "POST" }), {
      params: Promise.resolve({ id: corpId, sectorId }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.cancelCost).toBe(5_000);
    expect(body.reversalTurns).toBe(6);
    expect(body.newStrategyId).toBe("standard");

    // Verify sector update flips fields and sets isReversing
    const sectorUpdate = db.collectionMocks["corporateSectors"]!.updateOne.mock.calls[0][1].$set;
    expect(sectorUpdate.strategyId).toBe("standard");
    expect(sectorUpdate.transitionFromStrategyId).toBe("oil_gas");
    expect(sectorUpdate.isReversing).toBe(true);
    expect(sectorUpdate.transitionStartTurn).toBe(94);
  });

  it("charges zero cost and minimum 1 reversal turn when transition just started", async () => {
    await wireDb();
    await wireAuth();
    const { POST } = await import("./route");

    // 0 turns elapsed → progress = 0 → cost = 0
    // reversalTurns = max(1, round(0 × 12)) = 1 (minimum enforced)
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue({
      _id: new ObjectId(corpId),
      userId,
      ceoId: userId,
      ceoVacant: false,
      liquidCapital: 100_000,
      countryId: "US",
    });
    db.collectionMocks["corporateSectors"]!.findOne.mockResolvedValue({
      _id: new ObjectId(sectorId),
      corporationId: new ObjectId(corpId),
      strategyId: "oil_gas",
      transitionFromStrategyId: "standard",
      transitionStartTurn: 100, // elapsed=0
      revenue: 100_000,
    });
    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 100,
    });
    db.collectionMocks["corporations"]!.updateOne.mockResolvedValue({ modifiedCount: 1 } as never);
    db.collectionMocks["corporateSectors"]!.updateOne.mockResolvedValue({
      modifiedCount: 1,
    } as never);

    const res = await POST(new Request("http://localhost/api/test", { method: "POST" }), {
      params: Promise.resolve({ id: corpId, sectorId }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.cancelCost).toBe(0);
    expect(body.reversalTurns).toBe(1);
  });
});
