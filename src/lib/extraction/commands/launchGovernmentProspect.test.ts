import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/extraction/contractIssuerAuth", () => ({
  isNationalIssuer: vi.fn(),
  isStateIssuer: vi.fn(),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/lib/budget/treasurySpend", () => ({ spendFromTreasury: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn() }));

const TURN = 100;
const NOW = new Date("2026-07-09T00:00:00Z");
const ACTOR = { characterId: new ObjectId(), userId: new ObjectId().toString(), isAdmin: false };

function register(db: MockDb) {
  db.collection("stateResourceCapacity");
  db.collection("prospectingSurveys");
  db.collection("federalBudget");
  db.collection("governorOfficeState");
  db.collection("stateBudgets");
}

function primeCommon(db: MockDb) {
  db.collectionMocks.stateResourceCapacity.findOne.mockResolvedValue({
    stateId: "TX",
    countryId: "US",
    resources: { oil: 1000 },
  });
  db.collectionMocks.prospectingSurveys.countDocuments.mockResolvedValue(0);
  db.collectionMocks.prospectingSurveys.findOne.mockResolvedValue(null);
  db.collectionMocks.prospectingSurveys.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
}

async function run(db: MockDb, level: "national" | "state", actor = ACTOR) {
  const { launchGovernmentProspect } = await import("./launchGovernmentProspect");
  return launchGovernmentProspect(
    db as unknown as Db,
    { countryId: "US", stateId: "TX", resource: "oil", level },
    actor,
    TURN,
    NOW
  );
}

describe("launchGovernmentProspect", () => {
  let db: MockDb;
  let issuerAuth: typeof import("@/lib/extraction/contractIssuerAuth");
  let treasury: typeof import("@/lib/budget/treasurySpend");

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    register(db);
    primeCommon(db);
    issuerAuth = await import("@/lib/extraction/contractIssuerAuth");
    treasury = await import("@/lib/budget/treasurySpend");
  });

  it("rejects when the resource is not enabled in the state", async () => {
    db.collectionMocks.stateResourceCapacity.findOne.mockResolvedValue({ resources: {} });
    vi.mocked(issuerAuth.isNationalIssuer).mockResolvedValue(true);
    const res = await run(db, "national");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
  });

  it("funds a national survey from the treasury", async () => {
    vi.mocked(issuerAuth.isNationalIssuer).mockResolvedValue(true);
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({ treasuryBalance: 5_000_000 });
    const res = await run(db, "national");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.costs.costLocal).toBe(500_000);
    expect(treasury.spendFromTreasury).toHaveBeenCalledWith(expect.anything(), "US", 500_000);
    expect(db.collectionMocks.prospectingSurveys.insertOne).toHaveBeenCalledOnce();
  });

  it("rejects a national survey when the caller is not authorized", async () => {
    vi.mocked(issuerAuth.isNationalIssuer).mockResolvedValue(false);
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({ treasuryBalance: 5_000_000 });
    const res = await run(db, "national");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
    expect(treasury.spendFromTreasury).not.toHaveBeenCalled();
  });

  it("funds a national survey even when the treasury is already in debt", async () => {
    // Same defect the German Question carried, inherited from this file: a
    // negative `treasuryBalance` IS the national debt, so `balance < cost`
    // refused every survey for an indebted country. `spendFromTreasury` is built
    // to borrow — it splits the spend into fromSurplus and addedToDebt.
    vi.mocked(issuerAuth.isNationalIssuer).mockResolvedValue(true);
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({ treasuryBalance: -1_000_000 });
    const res = await run(db, "national");
    expect(res.ok).toBe(true);
    expect(treasury.spendFromTreasury).toHaveBeenCalledWith(expect.anything(), "US", 500_000);
  });

  it("commissions a state survey by spending an action point and booking the cost", async () => {
    vi.mocked(issuerAuth.isStateIssuer).mockResolvedValue(true);
    db.collectionMocks.governorOfficeState.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    const res = await run(db, "state");
    expect(res.ok).toBe(true);
    expect(db.collectionMocks.governorOfficeState.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ gubernatorialActions: { $gte: 1 } }),
      expect.anything()
    );
    expect(db.collectionMocks.stateBudgets.updateOne).toHaveBeenCalledWith(
      { _id: "TX", countryId: "US" },
      expect.objectContaining({
        $inc: { "spending.resourceProspecting": 500_000, "spending.total": 500_000 },
      })
    );
  });

  it("rejects a state survey when no action points remain", async () => {
    vi.mocked(issuerAuth.isStateIssuer).mockResolvedValue(true);
    db.collectionMocks.governorOfficeState.updateOne.mockResolvedValue({
      modifiedCount: 0,
      matchedCount: 0,
    });
    const res = await run(db, "state");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(402);
    expect(db.collectionMocks.stateBudgets.updateOne).not.toHaveBeenCalled();
  });

  it("rejects a state survey when the caller is not the governor", async () => {
    vi.mocked(issuerAuth.isStateIssuer).mockResolvedValue(false);
    const res = await run(db, "state");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });
});
