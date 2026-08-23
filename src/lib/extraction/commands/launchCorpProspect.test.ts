import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types/corporation";

vi.mock("@/lib/currency/corporationCapital", () => ({
  getCorpFxRate: vi.fn().mockResolvedValue(1),
  anchorToCorpLiquidCapital: (a: number) => a,
  resolveCorpLiquidCurrencyCode: () => "USD",
}));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn(), emitTxBulk: vi.fn() }));

const TURN = 100;
const NOW = new Date("2026-07-09T00:00:00Z");

function makeCorp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
    type: "extraction",
    liquidCapital: 10_000_000,
    liquidCurrencyCode: "USD",
    userId: new ObjectId(),
    countryId: "US",
    name: "Acme Extraction",
    rdScore: 100,
    ...overrides,
  } as unknown as Corporation;
}

function register(db: MockDb) {
  db.collection("corporateSectors");
  db.collection("stateResourceCapacity");
  db.collection("prospectingSurveys");
  db.collection("corporations");
}

/** Wire the happy-path collection responses; individual tests override. */
function primeEligible(
  db: MockDb,
  opts: { active?: number; priorSuccess?: number; dup?: unknown } = {}
) {
  db.collectionMocks.corporateSectors.findOne.mockResolvedValue({ countryId: "US" });
  db.collectionMocks.stateResourceCapacity.findOne.mockResolvedValue({
    stateId: "TX",
    countryId: "US",
    resources: { oil: 1000 },
  });
  db.collectionMocks.prospectingSurveys.countDocuments.mockImplementation(
    (filter: { status?: string }) => {
      if (filter.status === "active") return Promise.resolve(opts.active ?? 0);
      if (filter.status === "succeeded") return Promise.resolve(opts.priorSuccess ?? 0);
      return Promise.resolve(0);
    }
  );
  db.collectionMocks.prospectingSurveys.findOne.mockResolvedValue(opts.dup ?? null);
  db.collectionMocks.prospectingSurveys.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
  db.collectionMocks.corporations.updateOne.mockResolvedValue({
    modifiedCount: 1,
    matchedCount: 1,
  });
}

async function run(db: MockDb, corp: Corporation) {
  const { launchCorpProspect } = await import("./launchCorpProspect");
  return launchCorpProspect(
    db as unknown as Db,
    corp,
    { stateId: "TX", resource: "oil" },
    TURN,
    NOW
  );
}

describe("launchCorpProspect", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    register(db);
  });

  it("rejects a non-extraction corporation", async () => {
    primeEligible(db);
    const res = await run(db, makeCorp({ type: "technology" } as Partial<Corporation>));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
  });

  it("allows a corporation with extraction as its secondary sector", async () => {
    primeEligible(db);
    const res = await run(db, makeCorp({ type: "retail", secondaryType: "extraction" }));
    expect(res.ok).toBe(true);
    expect(db.collectionMocks.prospectingSurveys.insertOne).toHaveBeenCalledOnce();
  });

  it("rejects when the corp has no sector in the state", async () => {
    primeEligible(db);
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue(null);
    const res = await run(db, makeCorp());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
  });

  it("rejects when the resource is not enabled in the state", async () => {
    primeEligible(db);
    db.collectionMocks.stateResourceCapacity.findOne.mockResolvedValue({ resources: {} });
    const res = await run(db, makeCorp());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
  });

  it("rejects when the corp already runs the max active surveys", async () => {
    primeEligible(db, { active: 3 });
    const res = await run(db, makeCorp());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(409);
  });

  it("rejects a duplicate active survey for the same state+resource", async () => {
    primeEligible(db, { dup: { _id: new ObjectId() } });
    const res = await run(db, makeCorp());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(409);
  });

  it("launches on the happy path at the base cost", async () => {
    primeEligible(db);
    const res = await run(db, makeCorp());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.costs.costAnchor).toBe(500_000);
      expect(res.costs.costMultiplier).toBe(1);
      expect(res.survey.status).toBe("active");
      expect(res.survey.completesTurn).toBe(TURN + 12);
      expect(res.survey.rdScoreAtStart).toBe(100);
    }
    expect(db.collectionMocks.corporations.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ liquidCapital: { $gte: 500_000 } }),
      expect.anything()
    );
    expect(db.collectionMocks.prospectingSurveys.insertOne).toHaveBeenCalledOnce();
  });

  it("escalates the cost after prior successes", async () => {
    primeEligible(db, { priorSuccess: 2 });
    const res = await run(db, makeCorp());
    expect(res.ok).toBe(true);
    // min(4, 1 + 0.5*2) = 2 → 1,000,000.
    if (res.ok) {
      expect(res.costs.costMultiplier).toBe(2);
      expect(res.costs.costAnchor).toBe(1_000_000);
    }
  });

  it("rejects with 402 when the corp cannot afford the survey", async () => {
    primeEligible(db);
    db.collectionMocks.corporations.updateOne.mockResolvedValue({
      modifiedCount: 0,
      matchedCount: 0,
    });
    const res = await run(db, makeCorp());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(402);
    expect(db.collectionMocks.prospectingSurveys.insertOne).not.toHaveBeenCalled();
  });
});
