import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { BankCharter, DepositInsuranceFund } from "@/lib/db/types/bank";
import type { Corporation } from "@/lib/db/types";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import { getGdpAnchorRate } from "@/lib/currency/gdpAnchorRate";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  BASE_PREMIUM_ANNUAL,
  DEPOSIT_INSURANCE_SPENDING_KEY,
  INSURED_CAP_REFERENCE_USD,
  computeInsurancePremium,
  computeReserveRatioActual,
  ensureFund,
  getInsuredCap,
  resolveFailedBankDepositors,
  sumInsuredPlayerDeposits,
} from "../insurance";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function makeCharter(overrides: Partial<BankCharter> = {}): BankCharter {
  return {
    type: "retail",
    status: "failed",
    currency: "USD",
    charteredTurn: 1,
    postedCapital: 100_000,
    depositOffset: 0,
    lendingOffset: 0,
    totalDeposits: 0,
    npcDeposits: 0,
    failedTurn: 50,
    blacklist: {},
    ...overrides,
  };
}

function makeCorp(
  charter: BankCharter,
  overrides: Partial<Corporation> & { _id?: ObjectId } = {}
): Corporation {
  const { _id, ...rest } = overrides;
  return {
    _id: _id ?? new ObjectId(),
    name: "Failed Bank",
    type: "financial",
    liquidCapital: 0,
    liquidCurrencyCode: "USD",
    countryId: "US",
    ceoId: new ObjectId(),
    userId: new ObjectId(),
    headquartersState: "CA",
    bankCharter: charter,
    ...rest,
  } as unknown as Corporation;
}

function findCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
}

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
    let bankId: ObjectId;
    let liveCorp: Corporation;
    let fundState: DepositInsuranceFund;
    let characters: {
      _id: ObjectId;
      savings: number;
      holder: string;
    }[];
    let cbExternal: number;
    let treasuryBalance: number;
    let spendingInsurance: number;

    beforeEach(() => {
      bankId = new ObjectId();
      liveCorp = makeCorp(makeCharter({ postedCapital: 200_000, npcDeposits: 50_000 }), {
        _id: bankId,
        liquidCapital: 100_000,
      });
      fundState = {
        _id: "USD",
        balance: 0,
        insuredCap: 5_000_000,
        premiumsCollectedLifetime: 0,
        payoutsLifetime: 0,
        treasuryBackstopLifetime: 0,
      };
      characters = [];
      cbExternal = 1_000_000;
      treasuryBalance = 10_000_000;
      spendingInsurance = 0;

      db.collectionMocks.corporations!.findOne.mockImplementation(
        async (filter: { _id?: ObjectId }) => {
          if (filter?._id && bankId.equals(filter._id)) {
            return {
              ...liveCorp,
              bankCharter: liveCorp.bankCharter ? { ...liveCorp.bankCharter } : undefined,
            };
          }
          return null;
        }
      );
      // The resolution now CLAIMS its idempotency key atomically before it
      // touches a depositor, so a crash mid-resolution cannot let a retry
      // haircut everyone twice. The mock models that claim: first caller wins
      // and gets the BEFORE document, later callers get null.
      db.collectionMocks.corporations!.findOneAndUpdate.mockImplementation(
        async (filter: { _id?: ObjectId }, update: { $set?: Record<string, unknown> }) => {
          if (!filter?._id || !bankId.equals(filter._id)) return null;
          if (liveCorp.bankCharter?.status !== "failed") return null;
          if (liveCorp.bankCharter?.depositorsResolvedTurn != null) return null;
          const before = {
            ...liveCorp,
            bankCharter: liveCorp.bankCharter ? { ...liveCorp.bankCharter } : undefined,
          };
          const stamp = update?.$set?.["bankCharter.depositorsResolvedTurn"];
          if (liveCorp.bankCharter && typeof stamp === "number") {
            liveCorp.bankCharter.depositorsResolvedTurn = stamp;
          }
          return before;
        }
      );
      db.collectionMocks.corporations!.updateOne.mockImplementation(async (filter, update) => {
        const f = filter as { _id?: ObjectId; "bankCharter.status"?: string };
        if (!f._id || !bankId.equals(f._id)) return { matchedCount: 0, modifiedCount: 0 };
        const u = update as { $set?: Record<string, unknown> };
        if (u.$set) {
          if (typeof u.$set.liquidCapital === "number") {
            liveCorp.liquidCapital = u.$set.liquidCapital as number;
          }
          for (const [key, value] of Object.entries(u.$set)) {
            if (key.startsWith("bankCharter.") && liveCorp.bankCharter) {
              const field = key.slice("bankCharter.".length);
              (liveCorp.bankCharter as unknown as Record<string, unknown>)[field] = value;
            }
          }
        }
        return { matchedCount: 1, modifiedCount: 1 };
      });

      db.collectionMocks.characters!.find.mockImplementation((filter: Record<string, unknown>) => {
        const holderKey = "currencyBalances.savingsHolder.USD";
        if (filter[holderKey] === bankId.toString()) {
          return findCursor(
            characters
              .filter((c) => c.holder === bankId.toString())
              .map((c) => ({
                _id: c._id,
                currencyBalances: {
                  savings: { USD: c.savings },
                  savingsHolder: { USD: c.holder },
                },
              }))
          );
        }
        return findCursor([]);
      });
      db.collectionMocks.characters!.bulkWrite.mockImplementation(async (ops: unknown[]) => {
        for (const op of ops as {
          updateOne: {
            filter: { _id: ObjectId };
            update: { $set?: Record<string, unknown>; $inc?: Record<string, number> };
          };
        }[]) {
          const ch = characters.find((c) => c._id.equals(op.updateOne.filter._id));
          if (!ch) continue;
          const set = op.updateOne.update.$set ?? {};
          const inc = op.updateOne.update.$inc ?? {};
          if (typeof set["currencyBalances.savingsHolder.USD"] === "string") {
            ch.holder = set["currencyBalances.savingsHolder.USD"] as string;
          }
          if (typeof inc["currencyBalances.savings.USD"] === "number") {
            ch.savings += inc["currencyBalances.savings.USD"];
          }
        }
        return { modifiedCount: ops.length, matchedCount: ops.length };
      });

      db.collectionMocks.depositInsuranceFunds!.updateOne.mockImplementation(
        async (filter, update) => {
          const id = String((filter as { _id: string })._id);
          if (id !== "USD") return { matchedCount: 0, modifiedCount: 0 };
          const u = update as {
            $setOnInsert?: Partial<DepositInsuranceFund>;
            $inc?: Record<string, number>;
          };
          if (u.$setOnInsert) {
            // first-touch shape already in fundState
          }
          if (u.$inc) {
            for (const [k, v] of Object.entries(u.$inc)) {
              (fundState as unknown as Record<string, number>)[k] =
                ((fundState as unknown as Record<string, number>)[k] ?? 0) + v;
            }
          }
          return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
        }
      );
      db.collectionMocks.depositInsuranceFunds!.findOne.mockImplementation(async () => ({
        ...fundState,
      }));

      db.collectionMocks.centralBanks!.updateOne.mockImplementation(async (_f, update) => {
        const inc = (update as { $inc?: { externalBroadMoney?: number } }).$inc;
        if (typeof inc?.externalBroadMoney === "number") {
          cbExternal += inc.externalBroadMoney;
        }
        return { matchedCount: 1, modifiedCount: 1 };
      });

      db.collectionMocks.federalBudget!.updateOne.mockImplementation(async (_f, update) => {
        const inc = (update as { $inc?: Record<string, number> }).$inc ?? {};
        if (typeof inc.treasuryBalance === "number") treasuryBalance += inc.treasuryBalance;
        if (typeof inc[`spending.byCategory.${DEPOSIT_INSURANCE_SPENDING_KEY}`] === "number") {
          spendingInsurance += inc[`spending.byCategory.${DEPOSIT_INSURANCE_SPENDING_KEY}`];
        }
        return { matchedCount: 1, modifiedCount: 1 };
      });
    });

    it("conserves: kept + haircuts == original deposits; fund+recovery+treasury == kept re-backed", async () => {
      const cap = await getInsuredCap(db as unknown as Db, "USD");
      // One depositor under cap, one with excess above cap.
      const under = {
        _id: new ObjectId(),
        savings: Math.floor(cap / 2),
        holder: bankId.toString(),
      };
      const over = {
        _id: new ObjectId(),
        savings: cap + 400_000,
        holder: bankId.toString(),
      };
      characters = [under, over];
      const originalPlayer = under.savings + over.savings;
      const originalNpc = 50_000;
      liveCorp.bankCharter!.npcDeposits = originalNpc;
      // Recovery = 100k liquid + 200k posted = 300k; insured gap uses recovery first.
      fundState.balance = 80_000;

      const recoveryPool = 100_000 + 200_000;
      const result = await resolveFailedBankDepositors(db as unknown as Db, bankId, 77);

      expect(result.resolved).toBe(true);
      expect(under.holder).toBe("centralBank");
      expect(over.holder).toBe("centralBank");

      const keptPlayer = under.savings + over.savings;
      const haircuts = result.haircutsApplied;
      expect(keptPlayer + haircuts).toBeCloseTo(originalPlayer, 6);
      expect(result.npcReturned).toBe(originalNpc);

      const totalKept = keptPlayer + originalNpc;
      // recoveryUsed + insurancePaid (fund+treasury) covers totalKept
      expect(result.recoveryUsed + result.insurancePaid).toBeCloseTo(totalKept, 6);
      expect(result.recoveryUsed).toBeLessThanOrEqual(recoveryPool);
      expect(liveCorp.liquidCapital).toBe(0);
      expect(liveCorp.bankCharter!.postedCapital).toBe(0);
      expect(liveCorp.bankCharter!.npcDeposits).toBe(0);
      expect(liveCorp.bankCharter!.depositorsResolvedTurn).toBe(77);
      expect(cbExternal).toBe(1_000_000 + originalNpc);
    });

    it("a retry after a crash cannot haircut the same depositors twice", async () => {
      // The idempotency key used to be stamped at the END, after the haircuts.
      // On a database with no transactions that leaves a window where a crash
      // between the two lets a retry confiscate player money a second time,
      // with no record it happened. The claim is now taken FIRST.
      const { resolveFailedBankDepositors } = await import("../insurance");

      // A depositor with a balance above the insured cap, and no recovery pool
      // to pay the excess from, so the excess actually takes a haircut. That
      // haircut is the money a retry would confiscate a second time, so a
      // fixture with no depositors or with recovery covering everything would
      // prove nothing.
      const cap = await getInsuredCap(db as unknown as Db, "USD");
      characters = [{ _id: new ObjectId(), savings: cap + 400_000, holder: bankId.toString() }];
      liveCorp.liquidCapital = 0;
      liveCorp.bankCharter!.postedCapital = 0;
      liveCorp.bankCharter!.npcDeposits = 0;

      const first = await resolveFailedBankDepositors(db as unknown as Db, bankId, 77);
      expect(first.resolved).toBe(true);
      const haircutOnce = first.haircutsApplied;
      const savingsAfterFirst = characters.map((c) => c.savings);

      const second = await resolveFailedBankDepositors(db as unknown as Db, bankId, 78);

      expect(second.resolved).toBe(false);
      expect(second.haircutsApplied).toBe(0);
      expect(characters.map((c) => c.savings)).toEqual(savingsAfterFirst);
      // And the stamp still records the turn the resolution actually ran on.
      expect(liveCorp.bankCharter!.depositorsResolvedTurn).toBe(77);
      expect(haircutOnce).toBeGreaterThan(0);
    });

    it("cap boundary: balance exactly at cap takes no haircut", async () => {
      const cap = await getInsuredCap(db as unknown as Db, "USD");
      characters = [{ _id: new ObjectId(), savings: cap, holder: bankId.toString() }];
      liveCorp.liquidCapital = 0;
      liveCorp.bankCharter!.postedCapital = 0;
      liveCorp.bankCharter!.npcDeposits = 0;
      fundState.balance = cap;

      const result = await resolveFailedBankDepositors(db as unknown as Db, bankId, 10);
      expect(result.haircutsApplied).toBe(0);
      expect(characters[0].savings).toBe(cap);
      expect(characters[0].holder).toBe("centralBank");
    });

    it("returns NPC deposits in full to externalBroadMoney", async () => {
      characters = [];
      liveCorp.liquidCapital = 0;
      liveCorp.bankCharter!.postedCapital = 0;
      liveCorp.bankCharter!.npcDeposits = 250_000;
      fundState.balance = 250_000;

      const before = cbExternal;
      const result = await resolveFailedBankDepositors(db as unknown as Db, bankId, 11);
      expect(result.npcReturned).toBe(250_000);
      expect(cbExternal).toBe(before + 250_000);
      expect(liveCorp.bankCharter!.npcDeposits).toBe(0);
    });

    it("drained fund hits Treasury spending line and treasuryBalance", async () => {
      const cap = await getInsuredCap(db as unknown as Db, "USD");
      characters = [{ _id: new ObjectId(), savings: 100_000, holder: bankId.toString() }];
      liveCorp.liquidCapital = 0;
      liveCorp.bankCharter!.postedCapital = 0;
      liveCorp.bankCharter!.npcDeposits = 0;
      fundState.balance = 10_000;

      const result = await resolveFailedBankDepositors(db as unknown as Db, bankId, 12);
      expect(result.treasuryBackstop).toBe(90_000);
      expect(result.insurancePaid).toBe(100_000);
      expect(fundState.balance).toBe(0);
      expect(fundState.treasuryBackstopLifetime).toBe(90_000);
      expect(treasuryBalance).toBe(10_000_000 - 90_000);
      expect(spendingInsurance).toBe(90_000);
      expect(characters[0].savings).toBe(100_000);
      expect(cap).toBeGreaterThan(100_000);
    });

    it("is idempotent: second resolution is a no-op", async () => {
      characters = [{ _id: new ObjectId(), savings: 10_000, holder: bankId.toString() }];
      liveCorp.liquidCapital = 10_000;
      liveCorp.bankCharter!.postedCapital = 0;
      liveCorp.bankCharter!.npcDeposits = 0;
      fundState.balance = 0;

      const first = await resolveFailedBankDepositors(db as unknown as Db, bankId, 13);
      expect(first.resolved).toBe(true);
      const fundAfter = fundState.payoutsLifetime;
      const savAfter = characters[0].savings;

      const second = await resolveFailedBankDepositors(db as unknown as Db, bankId, 14);
      expect(second.resolved).toBe(false);
      expect(second.insurancePaid).toBe(0);
      expect(fundState.payoutsLifetime).toBe(fundAfter);
      expect(characters[0].savings).toBe(savAfter);
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
