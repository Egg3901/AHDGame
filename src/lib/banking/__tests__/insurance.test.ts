import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { DepositInsuranceFund } from "@/lib/db/types/bank";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import { getGdpAnchorRate } from "@/lib/currency/gdpAnchorRate";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  BASE_PREMIUM_ANNUAL,
  INSURED_CAP_REFERENCE_USD,
  computeInsurancePremium,
  computeReserveRatioActual,
  ensureFund,
  getInsuredCap,
  resolveFailedBankDepositors,
  sumInsuredPlayerDeposits,
} from "../insurance";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("deposit insurance", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collection("gameState");
    db.collection("depositInsuranceFunds");
    db.collection("corporations");
    db.collection("characters");
    db.collection("centralBanks");
    db.collection("federalBudget");

    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      preset: "2019-default",
      currentTurn: 1,
    });
  });

  describe("getInsuredCap", () => {
    it("era/FX-anchors via era unit scale and gdpAnchorRate", async () => {
      const cap = await getInsuredCap(db as unknown as Db, "USD");
      const scale = getEraUnitScale("2019-default");
      const rate = getGdpAnchorRate("US", "2019-default");
      expect(cap).toBe(Math.max(1, Math.round(INSURED_CAP_REFERENCE_USD / scale / rate)));

      // Non-parity currency must convert (not a flat worldwide number).
      const jpy = await getInsuredCap(db as unknown as Db, "JPY");
      const jpyRate = getGdpAnchorRate("JP", "2019-default");
      expect(jpyRate).not.toBe(1);
      expect(jpy).toBe(Math.max(1, Math.round(INSURED_CAP_REFERENCE_USD / scale / jpyRate)));
      expect(jpy).not.toBe(cap);
    });

    it("deflates for a 1953 world via era unit scale", async () => {
      db.collectionMocks.gameState!.findOne.mockResolvedValue({
        _id: "current",
        preset: "1953-default",
        currentTurn: 1,
      });
      const cap = await getInsuredCap(db as unknown as Db, "USD");
      const scale = getEraUnitScale("1953-default");
      expect(scale).toBeGreaterThan(1);
      expect(cap).toBe(Math.max(1, Math.round(INSURED_CAP_REFERENCE_USD / scale)));
      expect(cap).toBeLessThan(INSURED_CAP_REFERENCE_USD);
    });
  });

  describe("computeInsurancePremium", () => {
    it("applies risk weight: thin reserves pay more; bounds hold", () => {
      const deposits = 1_000_000;
      const required = 0.1;
      const base = (deposits * BASE_PREMIUM_ANNUAL) / TURNS_PER_YEAR;

      const atParity = computeInsurancePremium(deposits, required, required);
      expect(atParity).toBeCloseTo(base * 1, 10);

      const thin = computeInsurancePremium(deposits, required * 0.25, required);
      expect(thin).toBeGreaterThan(atParity);

      const thick = computeInsurancePremium(deposits, required * 4, required);
      expect(thick).toBeLessThan(atParity);

      // actual=0 → weight 2; over-reserved → clamp 0.5
      expect(computeInsurancePremium(deposits, 0, required)).toBeCloseTo(base * 2, 10);
      expect(computeInsurancePremium(deposits, 1, required)).toBeCloseTo(base * 0.5, 10);
    });

    it("returns 0 for non-positive insured deposits", () => {
      expect(computeInsurancePremium(0, 0.1, 0.1)).toBe(0);
      expect(computeInsurancePremium(-10, 0.1, 0.1)).toBe(0);
    });
  });

  describe("ensureFund", () => {
    it("upserts with era-anchored insuredCap on first touch", async () => {
      const funds = new Map<string, DepositInsuranceFund>();
      db.collectionMocks.depositInsuranceFunds!.updateOne.mockImplementation(
        async (filter, update) => {
          const id = String((filter as { _id: string })._id);
          const onInsert = (update as { $setOnInsert?: DepositInsuranceFund }).$setOnInsert;
          if (!funds.has(id) && onInsert) {
            funds.set(id, { ...onInsert, _id: id as DepositInsuranceFund["_id"] });
          }
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
        }
      );
      db.collectionMocks.depositInsuranceFunds!.findOne.mockImplementation(
        async (filter: { _id?: string }) => funds.get(String(filter._id)) ?? null
      );

      const fund = await ensureFund(db as unknown as Db, "USD");
      const expectedCap = await getInsuredCap(db as unknown as Db, "USD");
      expect(fund.insuredCap).toBe(expectedCap);
      expect(fund.balance).toBe(0);
      expect(funds.get("USD")?.insuredCap).toBe(expectedCap);
    });
  });

  describe("resolveFailedBankDepositors", () => {
    /**
     * Rewritten against a real in-memory store rather than a call-recording
     * mock. The failure this suite has to catch is money that stops adding up
     * across several writes, and a mock that replays each write in isolation
     * cannot see that.
     *
     * The model also changed, deliberately. Player savings are a POINTER: the
     * balance never left the character, so a failed bank neither holds it nor
     * can lose it. The old resolution haircut those balances (money destroyed
     * with no counterparty) and then had the insurance fund pay for the ones it
     * did not haircut (money created that reached nobody). Both legs are gone.
     * Deposit insurance now stands behind the household book, which is the part
     * that is actually made of cash.
     */
    let bankId: ObjectId;
    let memory: InMemoryDb;

    function build(options: {
      cashReserves?: number;
      npcDeposits?: number;
      fundBalance?: number;
      playerSavings?: number[];
    }) {
      bankId = new ObjectId();
      memory = createInMemoryDb();
      memory.seed("corporations", [
        {
          _id: bankId,
          name: "Failed Bank",
          countryId: "US",
          liquidCapital: 100_000,
          bankCharter: {
            type: "retail",
            status: "failed",
            currency: "USD",
            charteredTurn: 1,
            postedCapital: 200_000,
            depositOffset: 0,
            lendingOffset: 0,
            cashReserves: options.cashReserves ?? 100_000,
            npcDeposits: options.npcDeposits ?? 50_000,
            totalDeposits: options.npcDeposits ?? 50_000,
            failedTurn: 50,
          },
        },
      ]);
      memory.seed("centralBanks", [{ _id: "US", externalBroadMoney: 1_000_000 }]);
      memory.seed("depositInsuranceFunds", [
        {
          _id: "USD",
          balance: options.fundBalance ?? 0,
          insuredCap: 5_000_000,
          premiumsCollectedLifetime: 0,
          payoutsLifetime: 0,
          treasuryBackstopLifetime: 0,
        },
      ]);
      memory.seed("federalBudget", [
        {
          _id: "federal",
          treasuryBalance: 10_000_000,
          spending: { total: 0, byCategory: {} },
          surplus: 0,
        },
      ]);
      memory.seed("gameState", [{ _id: "current", preset: "2019-default", currentTurn: 50 }]);
      memory.seed(
        "characters",
        (options.playerSavings ?? []).map((savings) => ({
          _id: new ObjectId(),
          name: "Saver",
          currencyBalances: {
            savings: { USD: savings },
            savingsHolder: { USD: bankId.toString() },
          },
        }))
      );
      return memory;
    }

    function charterNow() {
      return (memory.collection("corporations").docs[0] as { bankCharter: Record<string, number> })
        .bankCharter;
    }

    function cbNow() {
      return (memory.collection("centralBanks").docs[0] as { externalBroadMoney: number })
        .externalBroadMoney;
    }

    function fundNow() {
      return memory.collection("depositInsuranceFunds").docs[0] as {
        balance: number;
        payoutsLifetime: number;
        treasuryBackstopLifetime: number;
      };
    }

    it("returns the household book in full and leaves player principal alone", async () => {
      build({ cashReserves: 100_000, npcDeposits: 50_000, playerSavings: [2_000_000, 9_000_000] });

      const result = await resolveFailedBankDepositors(memory as unknown as Db, bankId, 77);

      expect(result.resolved).toBe(true);
      expect(result.npcReturned).toBe(50_000);
      expect(result.recoveryUsed).toBe(50_000);
      expect(result.haircutsApplied).toBe(0);
      expect(cbNow()).toBe(1_050_000);
      expect(charterNow().npcDeposits).toBe(0);
      expect(charterNow().depositorsResolvedTurn).toBe(77);

      const savers = memory.collection("characters").docs as {
        currencyBalances: { savings: { USD: number }; savingsHolder: { USD: string } };
      }[];
      expect(savers.map((c) => c.currencyBalances.savings.USD)).toEqual([2_000_000, 9_000_000]);
      expect(savers.every((c) => c.currencyBalances.savingsHolder.USD === "centralBank")).toBe(
        true
      );
    });

    it("a retry cannot run the payout a second time", async () => {
      build({ cashReserves: 20_000, npcDeposits: 50_000, playerSavings: [100_000] });

      const first = await resolveFailedBankDepositors(memory as unknown as Db, bankId, 77);
      expect(first.resolved).toBe(true);
      const cbAfterFirst = cbNow();

      const second = await resolveFailedBankDepositors(memory as unknown as Db, bankId, 78);

      expect(second.resolved).toBe(false);
      expect(cbNow()).toBe(cbAfterFirst);
      // And the stamp still records the turn the resolution actually ran on.
      expect(charterNow().depositorsResolvedTurn).toBe(77);
    });

    it("draws the fund before the treasury and books both", async () => {
      build({ cashReserves: 0, npcDeposits: 100_000, fundBalance: 10_000 });

      const result = await resolveFailedBankDepositors(memory as unknown as Db, bankId, 12);

      expect(result.treasuryBackstop).toBe(90_000);
      expect(result.insurancePaid).toBe(100_000);
      expect(fundNow().balance).toBe(0);
      expect(fundNow().treasuryBackstopLifetime).toBe(90_000);

      const budget = memory.collection("federalBudget").docs[0] as {
        treasuryBalance: number;
        spending: { total: number };
      };
      expect(budget.treasuryBalance).toBe(10_000_000 - 90_000);
      expect(budget.spending.total).toBe(90_000);
      expect(cbNow()).toBe(1_100_000);
    });

    it("is idempotent: a second resolution is a no-op", async () => {
      build({ cashReserves: 10_000, npcDeposits: 10_000, playerSavings: [10_000] });

      const first = await resolveFailedBankDepositors(memory as unknown as Db, bankId, 13);
      expect(first.resolved).toBe(true);
      const payoutsAfter = fundNow().payoutsLifetime;

      const second = await resolveFailedBankDepositors(memory as unknown as Db, bankId, 14);
      expect(second.resolved).toBe(false);
      expect(second.insurancePaid).toBe(0);
      expect(fundNow().payoutsLifetime).toBe(payoutsAfter);
    });
  });

  describe("helpers", () => {
    it("sumInsuredPlayerDeposits caps each balance", () => {
      expect(sumInsuredPlayerDeposits([100, 500, 50], 200)).toBe(100 + 200 + 50);
    });

    it("computeReserveRatioActual is liquid/deposits", () => {
      expect(computeReserveRatioActual(50, 200)).toBe(0.25);
      expect(computeReserveRatioActual(50, 0)).toBe(1);
    });
  });
});
