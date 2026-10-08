import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { Bond } from "@/lib/db/types/bond";
import { BASE_DEMAND } from "@/lib/sovereignDefault/constants";
import { settleFundedSovereignBondMaturity } from "./sovereign";

vi.mock("@/lib/db/runRequiredTransaction", () => ({
  runRequiredTransaction: async (body: (session: unknown) => Promise<unknown>) => body({} as never),
}));

const NOW = new Date("2026-10-08T00:00:00Z");

function fixture(opts: { appetite?: number; treasuryCash: number }) {
  const memory = createInMemoryDb();
  memory.seed("federalBudget", [
    {
      _id: "federal",
      countryId: "US",
      currencyCode: "USD",
      treasuryBalance: 100_000,
      treasuryCashLocal: opts.treasuryCash,
      debt: { principal: 10_000 },
      spending: { total: 800, debtInterest: 800 },
      surplus: 0,
      revenue: { total: 100 },
      gdp: 100_000,
    },
  ]);
  memory.seed("centralBanks", [{ _id: "US", primeRate: 6 }]);
  memory.seed("bondMarketPools", [
    {
      _id: "USD",
      cashLocal: 50_000,
      ...(opts.appetite === undefined ? {} : { appetiteByCountry: { US: opts.appetite } }),
    },
  ]);
  const holderId = new ObjectId();
  memory.seed("characters", [{ _id: holderId, cashOnHand: 0 }]);
  const dueBond = {
    _id: new ObjectId(),
    corporationId: new ObjectId(),
    issuerName: "Fixture Treasury",
    issuerType: "sovereign",
    countryId: "US",
    currencyCode: "USD",
    totalIssued: 10_000,
    couponRate: 8,
    maturityTurn: 24,
    matured: false,
    defaulted: false,
    holders: [{ characterId: holderId, units: 2 }],
    publicFloat: 8,
  } as unknown as Bond;
  memory.seed("bonds", [dueBond] as unknown as Record<string, unknown>[]);
  const args = {
    bond: dueBond,
    turn: 30,
    dueTurn: 24,
    currencyCode: "USD" as const,
    treasuryLocalPerAnchor: 1,
    nonBankRepaymentLocal: 10_000,
    holderLegs: [
      {
        collection: "characters",
        filter: { _id: holderId },
        path: "cashOnHand",
        amount: 2_000,
        currencyCode: "USD" as const,
        localPerAnchor: 1,
        note: "Pay the original character holder",
      },
      {
        collection: "bondMarketPools",
        filter: { _id: "USD" },
        path: "cashLocal",
        amount: 8_000,
        currencyCode: "USD" as const,
        localPerAnchor: 1,
        note: "Pay public float",
      },
    ],
    now: NOW,
  };
  return { memory, dueBond, args };
}

function outstandingPrincipal(memory: ReturnType<typeof createInMemoryDb>): number {
  return memory
    .collection("bonds")
    .docs.filter((row) => row.matured === false && row.defaulted === false)
    .reduce((sum, row) => sum + Number(row.totalIssued), 0);
}

describe("unfunded sovereign maturity rolls the pool holding over", () => {
  it("rolls the pool at par when appetite refused and Treasury cash is short", async () => {
    const { memory, dueBond, args } = fixture({ treasuryCash: 2_000 });
    // Short of the full 10_000 claim, enough for the 2_000 non-pool residual.
    const result = await settleFundedSovereignBondMaturity(memory as unknown as Db, args);

    expect(result?.status).toBe("applied");
    const bonds = memory.collection("bonds").docs;
    expect(bonds).toHaveLength(2);
    const old = bonds.find((row) => String(row._id) === dueBond._id.toHexString())!;
    const next = bonds.find((row) => String(row._id) !== dueBond._id.toHexString())!;
    expect(old).toMatchObject({
      matured: true,
      sovereignMaturityClaim: {
        paid: true,
        publicFloatDisposition: { mode: "cash" },
        forcedRollover: { units: 8, faceLocal: 8_000 },
      },
    });
    expect(next).toMatchObject({
      totalIssued: 8_000,
      publicFloat: 8,
      holders: [],
      matured: false,
      defaulted: false,
      maturityTurn: 78,
      currencyCode: "USD",
    });
    // 6% prime plus the term and rating spreads: a market coupon, not the old 8.
    expect(next.couponRate).not.toBe(8);
    expect(memory.collection("characters").docs[0]?.cashOnHand).toBe(2_000);
    // Pool lost no cash and was paid none: it swapped units one for one.
    expect(memory.collection("bondMarketPools").docs[0]?.cashLocal).toBe(50_000);
    const budget = memory.collection("federalBudget").docs[0]!;
    expect(budget.treasuryCashLocal).toBe(0);
    expect((budget.debt as { principal: number }).principal).toBe(8_000);
    expect(outstandingPrincipal(memory)).toBe((budget.debt as { principal: number }).principal);
    // Interest ledger: old coupon retired on the redeemed 2_000, new coupon on 8_000.
    const expectedInterest = 800 - 0.08 * 10_000 + (Number(next.couponRate) / 100) * 8_000;
    expect((budget.spending as { debtInterest: number }).debtInterest).toBeCloseTo(
      expectedInterest,
      6
    );
  });

  it("rolls only the float left after a partial appetite novation", async () => {
    const { memory, dueBond, args } = fixture({
      treasuryCash: 2_000,
      appetite: BASE_DEMAND / 2,
    });
    const result = await settleFundedSovereignBondMaturity(memory as unknown as Db, args);

    expect(result?.status).toBe("applied");
    const bonds = memory.collection("bonds").docs;
    expect(bonds).toHaveLength(3);
    const rolled = bonds
      .filter((row) => String(row._id) !== dueBond._id.toHexString())
      .map((row) => Number(row.totalIssued))
      .sort();
    expect(rolled).toEqual([4_000, 4_000]);
    expect(bonds.find((row) => String(row._id) === dueBond._id.toHexString())).toMatchObject({
      matured: true,
      sovereignMaturityClaim: { paid: true },
    });
    const budget = memory.collection("federalBudget").docs[0]!;
    expect((budget.debt as { principal: number }).principal).toBe(8_000);
    expect(outstandingPrincipal(memory)).toBe(8_000);
    expect(budget.treasuryCashLocal).toBe(0);
    expect(memory.collection("bondMarketPools").docs[0]?.cashLocal).toBe(50_000);
  });

  it("is idempotent across retries", async () => {
    const { memory, args } = fixture({ treasuryCash: 2_000 });
    await settleFundedSovereignBondMaturity(memory as unknown as Db, args);
    const snapshot = JSON.stringify(memory.collection("bonds").docs);
    await settleFundedSovereignBondMaturity(memory as unknown as Db, args);
    expect(JSON.stringify(memory.collection("bonds").docs)).toBe(snapshot);
    expect(memory.collection("bonds").docs).toHaveLength(2);
    expect(memory.collection("characters").docs[0]?.cashOnHand).toBe(2_000);
  });

  it("keeps waiting, with the pool already rolled once, if even the residual is unaffordable", async () => {
    const { memory, args } = fixture({ treasuryCash: 500 });
    const first = await settleFundedSovereignBondMaturity(memory as unknown as Db, args);
    expect(first).toBeNull();
    expect(memory.collection("bonds").docs).toHaveLength(2);
    const second = await settleFundedSovereignBondMaturity(memory as unknown as Db, args);
    expect(second).toBeNull();
    // No second replacement bond, no second coupon delta.
    expect(memory.collection("bonds").docs).toHaveLength(2);
    // Funding later lets the original claim finish without another rollover.
    memory.collection("federalBudget").docs[0]!.treasuryCashLocal = 2_000;
    // The turn loop reads the bond fresh each turn.
    const fresh = memory
      .collection("bonds")
      .docs.find((row) => String(row._id) === args.bond._id.toHexString()) as unknown as Bond;
    const third = await settleFundedSovereignBondMaturity(memory as unknown as Db, {
      ...args,
      bond: fresh,
    });
    expect(third?.status).toBe("applied");
    expect(memory.collection("bonds").docs).toHaveLength(2);
    expect(outstandingPrincipal(memory)).toBe(8_000);
  });

  it("leaves a funded treasury on the ordinary cash path", async () => {
    const { memory, args } = fixture({ treasuryCash: 10_000 });
    const result = await settleFundedSovereignBondMaturity(memory as unknown as Db, args);
    expect(result?.status).toBe("applied");
    expect(memory.collection("bonds").docs).toHaveLength(1);
    expect(memory.collection("bondMarketPools").docs[0]?.cashLocal).toBe(58_000);
  });
});
