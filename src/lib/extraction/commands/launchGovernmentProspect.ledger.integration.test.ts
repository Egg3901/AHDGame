import { ObjectId, type Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";

vi.mock("@/lib/extraction/contractIssuerAuth", () => ({
  isNationalIssuer: vi.fn().mockResolvedValue(true),
  isStateIssuer: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map([["USD", 1]])),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn() }));

const TURN = 100;
const NOW = new Date("2026-10-04T00:00:00Z");
const ACTOR = { characterId: new ObjectId(), userId: "admin", isAdmin: true };

function setup() {
  const db = createInMemoryDb();
  db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
  db.seed("gameState", [{ _id: "current", currentTurn: TURN, preset: "2019-default" }]);
  db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
  db.seed("stateResourceCapacity", [
    { _id: "TX", countryId: "US", stateId: "TX", resources: { oil: 1000 } },
  ]);
  db.seed("federalBudget", [
    {
      _id: "US",
      countryId: "US",
      currencyCode: "USD",
      treasuryCashLocal: 5_000_000,
      treasuryBalance: 0,
    },
  ]);
  db.seed("prospectingSurveys", []);
  return db;
}

describe("funded national government prospect", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resumes the frozen national Treasury debit after a crash, without repricing or charging twice", async () => {
    const db = setup();
    const fault = withInjectedCrash(db, {
      collection: "federalBudget",
      op: "updateOne",
      afterWrite: true,
      onCall: 1,
      matches: (args) => {
        const update = args[1] as { $inc?: Record<string, number> };
        return update.$inc?.treasuryCashLocal === -500_000;
      },
    });
    const { launchGovernmentProspect } = await import("./launchGovernmentProspect");
    const args = { countryId: "US", stateId: "TX", resource: "oil", level: "national" as const };

    await expect(launchGovernmentProspect(fault.db, args, ACTOR, TURN, NOW, true)).rejects.toThrow(
      "crash after"
    );
    expect(db.collection("federalBudget").docs[0]?.treasuryCashLocal).toBe(4_500_000);
    const frozenClaim = db.collection("prospectingSurveys").docs[0];
    expect(frozenClaim).toMatchObject({
      status: "funding",
      costLocal: 500_000,
      fundingKey: expect.any(String),
    });

    fault.disarm();
    const retried = await launchGovernmentProspect(
      fault.db,
      args,
      ACTOR,
      TURN + 1,
      new Date(NOW.getTime() + 60_000),
      true
    );
    expect(retried.ok).toBe(true);
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 4_500_000,
      treasuryBalance: -500_000,
    });
    expect(db.collection("prospectingSurveys").docs[0]).toMatchObject({
      status: "active",
      costLocal: 500_000,
    });
    expect(db.collection("bankMoneyMoves").docs).toHaveLength(1);
    expect(db.collection("bankMoneyMoves").docs[0]).toMatchObject({ status: "applied" });
  });
});
