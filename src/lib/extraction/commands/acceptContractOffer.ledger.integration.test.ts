import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Corporation } from "@/lib/db/types/corporation";
import type { ExtractionContract } from "@/lib/db/types/extractionContract";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";

vi.mock("@/lib/currency/corporationCapital", () => ({
  getCorpFxRate: vi.fn().mockResolvedValue(1),
  anchorToCorpLiquidCapital: (amount: number) => amount,
  resolveCorpLiquidCurrencyCode: () => "USD",
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map([["USD", 1]])),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn() }));

const TURN = 4;
const NOW = new Date("2026-10-04T00:00:00Z");
const CORP_ID = new ObjectId("650000000000000000000040");
const CONTRACT_ID = new ObjectId("650000000000000000000041");

function setup() {
  const db = createInMemoryDb();
  db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
  db.seed("gameState", [{ _id: "current", currentTurn: TURN, preset: "2019-default" }]);
  db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
  db.seed("federalBudget", [
    {
      _id: "US",
      countryId: "US",
      currencyCode: "USD",
      treasuryCashLocal: 100,
      treasuryBalance: -50,
    },
  ]);
  db.seed("corporations", [
    {
      _id: CORP_ID,
      liquidCapital: 100,
      liquidCurrencyCode: "USD",
      name: "Fixture Corp",
    },
  ]);
  const contract: ExtractionContract = {
    _id: CONTRACT_ID,
    stateId: "TX",
    countryId: "US",
    corporationId: CORP_ID,
    resource: "oil",
    share: 0.5,
    grantedTurn: 3,
    grantedBy: "US",
    grantedByLevel: "national",
    status: "offered",
    signingFeeAnchor: 20,
    royaltyRatePerTurn: 0.01,
    termTurns: 48,
    offerExpiresTurn: TURN + 10,
    updatedAt: NOW,
  };
  db.seed("extractionContracts", [contract as unknown as Record<string, unknown>]);
  return {
    db,
    contract,
    corporation: db.collection("corporations").docs[0] as unknown as Corporation,
  };
}

describe("funded national contract signing fee", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["corporate payer debit", "corporations", "liquidCapital", -20],
    ["Treasury credit", "federalBudget", "treasuryCashLocal", 20],
  ])(
    "resumes a crash after the %s leg without paying twice",
    async (_name, collection, path, value) => {
      const { db, contract, corporation } = setup();
      const fault = withInjectedCrash(db, {
        collection,
        op: "updateOne",
        afterWrite: true,
        onCall: 1,
        matches: (args) => {
          const update = args[1] as { $inc?: Record<string, number> };
          return update.$inc?.[path] === value;
        },
      });

      const { acceptContractOffer } = await import("./acceptContractOffer");
      await expect(
        acceptContractOffer(fault.db, contract, corporation, TURN, NOW, true)
      ).rejects.toThrow("crash after");
      fault.disarm();

      const savedContract = db.collection("extractionContracts")
        .docs[0] as unknown as ExtractionContract;
      const retryCorp = db.collection("corporations").docs[0] as unknown as Corporation;
      const retried = await acceptContractOffer(
        fault.db,
        savedContract,
        retryCorp,
        TURN,
        new Date(NOW.getTime() + 1000),
        true
      );

      expect(retried).toMatchObject({ ok: true, signingFeeLocal: 20 });
      expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(80);
      expect(db.collection("federalBudget").docs[0]).toMatchObject({
        treasuryCashLocal: 120,
        treasuryBalance: -30,
      });
      expect(db.collection("bankMoneyMoves").docs).toHaveLength(1);
      expect(db.collection("bankMoneyMoves").docs[0]).toMatchObject({ status: "applied" });
    }
  );
});
