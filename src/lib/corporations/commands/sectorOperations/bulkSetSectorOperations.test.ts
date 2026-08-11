import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { bulkSetSectorOperations } from "./bulkSetSectorOperations";

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
  growthCostFor: vi.fn().mockReturnValue(123),
  resolveCountryPrimeRate: vi.fn().mockResolvedValue(4),
}));
vi.mock("@/lib/corporations/economicActionLog", () => ({
  logEconomicAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(5) }));
vi.mock("@/lib/market/featureFlag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/market/featureFlag")>();
  return {
    ...actual,
    // Mode is mocked; the tier comparators keep their real semantics so
    // tier-gated guards (clearing posture, plants growth retirement) behave.
    getMarketSystemMode: vi.fn().mockResolvedValue("clearing"),
  };
});

let db: MockDb;
const corpId = new ObjectId();
const corp = { _id: corpId, name: "Energy Co", ceoId: new ObjectId(), countryId: "US" };

function energySector(state: string) {
  return {
    _id: new ObjectId(),
    corporationId: corpId,
    stateId: state,
    countryId: "US",
    sectorType: "energy",
    revenue: 1000,
    currentGrowthRate: 4,
    targetGrowthRate: 4,
    currentGrowthCost: 50,
    productionPolicy: 0,
  };
}

async function wire(sectors: unknown[]) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({ ok: true, user: { userId: "u1" } } as never);
  const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation: corp } as never);
  vi.mocked(requireCeo).mockReturnValue(null);
  db.collectionMocks.corporateSectors.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(sectors),
  });
}

function req(body: Record<string, unknown>) {
  return new Request("http://localhost/api/corporations/1/sectors/bulk", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
const params = Promise.resolve({ id: corpId.toString() });

describe("bulkSetSectorOperations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporateSectors");
  });

  it("By Type: filters by corporationId + countryId + sectorType", async () => {
    await wire([energySector("CA"), energySector("NY")]);
    await bulkSetSectorOperations(
      req({ countryId: "US", sectorType: "energy", targetGrowthRate: 8 }),
      { params }
    );
    expect(db.collectionMocks.corporateSectors.find).toHaveBeenCalledWith({
      corporationId: corpId,
      countryId: "US",
      sectorType: "energy",
    });
  });

  it("Corporate-Wide: omits sectorType from the filter", async () => {
    await wire([energySector("CA")]);
    await bulkSetSectorOperations(req({ countryId: "US", productionPolicy: 10 }), { params });
    expect(db.collectionMocks.corporateSectors.find).toHaveBeenCalledWith({
      corporationId: corpId,
      countryId: "US",
    });
  });

  it("applies one bulkWrite op per matching holding", async () => {
    await wire([energySector("CA"), energySector("NY"), energySector("TX")]);
    await bulkSetSectorOperations(
      req({ countryId: "US", sectorType: "energy", targetGrowthRate: 8 }),
      { params }
    );
    const ops = db.collectionMocks.corporateSectors.bulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(3);
    expect(ops[0].updateOne.update.$set.targetGrowthRate).toBe(8);
  });

  it("growth-only leaves productionPolicy untouched", async () => {
    await wire([energySector("CA")]);
    await bulkSetSectorOperations(
      req({ countryId: "US", sectorType: "energy", targetGrowthRate: 8 }),
      { params }
    );
    const set =
      db.collectionMocks.corporateSectors.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(set).not.toHaveProperty("productionPolicy"); // pragma: allowlist secret
    expect(set.targetGrowthRate).toBe(8);
    expect(set.currentGrowthCost).toBe(123);
  });

  it("clamps production policy to [-25, 25]", async () => {
    await wire([energySector("CA")]);
    await bulkSetSectorOperations(req({ countryId: "US", productionPolicy: 25 }), { params });
    const set =
      db.collectionMocks.corporateSectors.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(set.productionPolicy).toBe(25);
  });

  it("preview: persists nothing and returns projected cost", async () => {
    await wire([energySector("CA"), energySector("NY")]);
    const res = await bulkSetSectorOperations(
      req({ countryId: "US", sectorType: "energy", targetGrowthRate: 8, preview: true }),
      { params }
    );
    expect(db.collectionMocks.corporateSectors.bulkWrite).not.toHaveBeenCalled();
    const json = await res.json();
    expect(json.preview).toBe(true);
    expect(json.matchedCount).toBe(2);
    expect(json.growth.projectedTotalCostPerTurn).toBe(246); // 123 * 2
  });

  it("matchedCount 0 when no holdings match (no bulkWrite, no error)", async () => {
    await wire([]);
    const res = await bulkSetSectorOperations(
      req({ countryId: "US", sectorType: "energy", productionPolicy: 5 }),
      { params }
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.matchedCount).toBe(0);
    expect(db.collectionMocks.corporateSectors.bulkWrite).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-CEO", async () => {
    const { NextResponse } = await import("next/server");
    await wire([energySector("CA")]);
    const { requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(requireCeo).mockReturnValue(NextResponse.json({ error: "Not CEO" }, { status: 403 }));
    const res = await bulkSetSectorOperations(req({ countryId: "US", productionPolicy: 5 }), {
      params,
    });
    expect(res.status).toBe(403);
  });

  it("logs exactly one economic action per apply", async () => {
    const { logEconomicAction } = await import("@/lib/corporations/economicActionLog");
    await wire([energySector("CA"), energySector("NY")]);
    await bulkSetSectorOperations(
      req({ countryId: "US", sectorType: "energy", targetGrowthRate: 8 }),
      { params }
    );
    expect(vi.mocked(logEconomicAction)).toHaveBeenCalledTimes(1);
  });

  it("applies pricingPosture across matched holdings", async () => {
    await wire([energySector("CA"), energySector("NY")]);
    await bulkSetSectorOperations(
      req({ countryId: "US", sectorType: "energy", pricingPosture: -0.1 }),
      { params }
    );
    const ops = db.collectionMocks.corporateSectors.bulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(2);
    expect(ops[0].updateOne.update.$set.pricingPosture).toBe(-0.1);
    expect(ops[1].updateOne.update.$set.pricingPosture).toBe(-0.1);
  });

  it("pricing-only leaves growth and output policy untouched", async () => {
    await wire([energySector("CA")]);
    await bulkSetSectorOperations(req({ countryId: "US", pricingPosture: 0.05 }), { params });
    const set =
      db.collectionMocks.corporateSectors.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(set.pricingPosture).toBe(0.05);
    expect(set).not.toHaveProperty("productionPolicy"); // pragma: allowlist secret
    expect(set).not.toHaveProperty("targetGrowthRate");
  });

  it("sets pricingPosture null for Auto", async () => {
    await wire([energySector("CA")]);
    await bulkSetSectorOperations(req({ countryId: "US", pricingPosture: null }), { params });
    const set =
      db.collectionMocks.corporateSectors.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(set.pricingPosture).toBeNull();
  });

  it("returns 400 when pricing is requested but clearing is off", async () => {
    const { getMarketSystemMode } = await import("@/lib/market/featureFlag");
    vi.mocked(getMarketSystemMode).mockResolvedValueOnce("off" as never);
    await wire([energySector("CA")]);
    const res = await bulkSetSectorOperations(req({ countryId: "US", pricingPosture: 0 }), {
      params,
    });
    expect(res.status).toBe(400);
    expect(db.collectionMocks.corporateSectors.bulkWrite).not.toHaveBeenCalled();
  });
  it("returns 400 for growth targets on a plants world (growth is retired)", async () => {
    const { getMarketSystemMode } = await import("@/lib/market/featureFlag");
    vi.mocked(getMarketSystemMode).mockResolvedValueOnce("plants" as never);
    await wire([energySector("CA")]);
    const res = await bulkSetSectorOperations(req({ countryId: "US", targetGrowthRate: 8 }), {
      params,
    });
    expect(res.status).toBe(400);
    expect(db.collectionMocks.corporateSectors.bulkWrite).not.toHaveBeenCalled();
  });
});
