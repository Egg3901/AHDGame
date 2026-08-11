import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { setSectorGrowth } from "./setSectorGrowth";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/corporations/marketShare", () => ({
  fetchSectorMarketSharePercent: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/corporations/sectorGrowthCost", () => ({
  growthCostFor: vi.fn((_rev: number, rate: number) => rate * 100),
  resolveCountryPrimeRate: vi.fn().mockResolvedValue(4),
}));
vi.mock("@/lib/corporations/economicActionLog", () => ({
  logEconomicAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(5) }));

let db: MockDb;
const corpId = new ObjectId();
const sectorId = new ObjectId();
const corp = { _id: corpId, name: "Test1", ceoId: new ObjectId(), countryId: "CN" };
const sector = {
  _id: sectorId,
  corporationId: corpId,
  stateId: "DB",
  countryId: "CN",
  sectorType: "energy",
  revenue: 1000,
  currentGrowthRate: 4,
  currentGrowthCost: 400,
};

async function wire() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({ ok: true, user: { userId: "u1" } } as never);
  const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation: corp } as never);
  vi.mocked(requireCeo).mockReturnValue(null);
  db.collectionMocks.corporateSectors.findOne.mockResolvedValue(sector);
}

function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/corporations/1/sectors/2/growth", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
const params = Promise.resolve({ id: corpId.toString(), sectorId: sectorId.toString() });

describe("setSectorGrowth — preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporateSectors");
  });

  it("preview returns projected/current/delta and writes nothing", async () => {
    await wire();
    const res = await setSectorGrowth(req({ targetGrowthRate: 8, preview: true }), { params });
    const json = await res.json();
    expect(db.collectionMocks.corporateSectors.updateOne).not.toHaveBeenCalled();
    expect(json.preview).toBe(true);
    expect(json.targetGrowthRate).toBe(8);
    expect(json.projectedCostPerTurn).toBe(800); // growthCostFor mock: target 8 * 100
    expect(json.currentCostPerTurn).toBe(400); // sector.currentGrowthCost
    expect(json.costDeltaPerTurn).toBe(400); // 800 - 400
  });

  it("non-preview still writes and returns the legacy shape", async () => {
    await wire();
    const res = await setSectorGrowth(req({ targetGrowthRate: 8 }), { params });
    const json = await res.json();
    expect(db.collectionMocks.corporateSectors.updateOne).toHaveBeenCalledTimes(1);
    expect(json.success).toBe(true);
    expect(json.targetGrowthRate).toBe(8);
    expect(json).not.toHaveProperty("preview");
  });
});
