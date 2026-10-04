import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { settleInsurancePremiumForTurn } from "@/lib/banking/insurancePremium";
import { InjectedCrash, withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";

const BANK_ID = new ObjectId("66d000000000000000000001");
const TURN = 481;

function world(): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("gameState", [{ _id: "current", preset: "2019-default", currentTurn: TURN }]);
  db.seed("gameConfig", [{ _id: "default", ledgerShadow: false }]);
  db.seed("corporations", [
    {
      _id: BANK_ID,
      countryId: "US",
      liquidCurrencyCode: "USD",
      bankCharter: {
        status: "active",
        currency: "USD",
        charteredTurn: 17,
        cashReserves: 500,
      },
    },
  ]);
  db.seed("depositInsuranceFunds", [
    {
      _id: "USD",
      balance: 10,
      insuredCap: 5_000_000,
      premiumsCollectedLifetime: 0,
      insuredDepositExposureTurnsLifetime: 0,
      pricingEvidenceStartTurn: TURN,
      measuredPaidClaimsSincePricingStart: 0,
      measuredGrossClaimsSincePricingStart: 0,
      measuredRecoveriesSincePricingStart: 0,
    },
  ]);
  return db;
}

const original = {
  bankId: BANK_ID,
  countryId: "US",
  charteredTurn: 17,
  currency: "USD" as const,
  turn: TURN,
  insuredDeposits: 1_000_000,
  cashReserves: 500,
  reserveRatioActual: 0.1,
  reserveRatioRequired: 0.1,
};

describe("insurance premium durable quote replay", () => {
  it("resumes the frozen premium after debit-before-credit crash even when cash and exposure now read zero", async () => {
    const memory = world();
    const faulty = withInjectedCrash(memory, {
      collection: "corporations",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
    });

    await expect(settleInsurancePremiumForTurn(faulty.db, original)).rejects.toBeInstanceOf(
      InjectedCrash
    );
    faulty.disarm();

    const corporation = memory.collection("corporations").docs[0] as {
      bankCharter: { cashReserves: number };
    };
    const fund = memory.collection("depositInsuranceFunds").docs[0] as {
      balance: number;
      insuredDepositExposureTurnsLifetime: number;
      premiumsCollectedLifetime: number;
      measuredPaidClaimsSincePricingStart: number;
    };
    const frozen = memory.collection("bankMoneyMoves").docs[0] as {
      event: { meta: { premiumPaid: number; premiumDue: number; insuredDeposits: number } };
      legs: { amount: number }[];
    };
    const originalPaid = frozen.event.meta.premiumPaid;
    expect(originalPaid).toBeGreaterThan(0);
    expect(frozen.event.meta.premiumDue).toBe(originalPaid);
    expect(frozen.event.meta.insuredDeposits).toBe(original.insuredDeposits);
    expect(corporation.bankCharter.cashReserves).toBe(500 - originalPaid);

    // Current evidence and liquidity drift after the frozen source debit.
    corporation.bankCharter.cashReserves = 0;
    fund.balance = 1_000_000;
    fund.measuredPaidClaimsSincePricingStart = 9;
    const retry = await settleInsurancePremiumForTurn(memory as unknown as Db, {
      ...original,
      insuredDeposits: 0,
      cashReserves: 0,
      reserveRatioActual: 0,
      reserveRatioRequired: 0.2,
    });

    expect(retry).toEqual({
      insuredDeposits: original.insuredDeposits,
      premiumPaid: originalPaid,
      premiumDue: originalPaid,
      cashDebited: 0,
      cashReservesAfter: 0,
      shortfall: 0,
      applied: true,
    });
    expect(corporation.bankCharter.cashReserves).toBe(0);
    expect(fund.balance).toBe(1_000_000 + originalPaid);
    expect(fund.insuredDepositExposureTurnsLifetime).toBe(original.insuredDeposits);
    expect(fund.premiumsCollectedLifetime).toBe(originalPaid);
    expect(memory.collection("bankMoneyMoves").docs).toHaveLength(1);
    expect(frozen.legs.map((leg) => leg.amount)).toEqual([originalPaid, originalPaid]);
  });

  it("refreshes the original charter cash when retry applies the not-yet-landed debit", async () => {
    const memory = world();
    const faulty = withInjectedCrash(memory, {
      collection: "corporations",
      op: "updateOne",
      onCall: 1,
    });
    await expect(settleInsurancePremiumForTurn(faulty.db, original)).rejects.toBeInstanceOf(
      InjectedCrash
    );
    faulty.disarm();

    const before = memory.collection("corporations").docs[0] as {
      bankCharter: { cashReserves: number };
    };
    expect(before.bankCharter.cashReserves).toBe(500);
    const frozen = memory.collection("bankMoneyMoves").docs[0] as {
      event: { meta: { premiumPaid: number } };
    };
    const originalPaid = frozen.event.meta.premiumPaid;

    const retry = await settleInsurancePremiumForTurn(memory as unknown as Db, {
      ...original,
      insuredDeposits: 0,
      cashReserves: 500,
    });

    expect(retry).toEqual({
      insuredDeposits: original.insuredDeposits,
      premiumPaid: originalPaid,
      premiumDue: originalPaid,
      cashDebited: 0,
      cashReservesAfter: 500 - originalPaid,
      shortfall: 0,
      applied: true,
    });
    expect(before.bankCharter.cashReserves).toBe(500 - originalPaid);
    expect(
      (memory.collection("depositInsuranceFunds").docs[0] as { balance: number }).balance
    ).toBe(10 + originalPaid);
    expect(memory.collection("bankMoneyMoves").docs).toHaveLength(1);
  });
});
