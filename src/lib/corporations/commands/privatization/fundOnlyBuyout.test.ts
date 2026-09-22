import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { executeFundOnlyBuyout } from "./fundOnlyBuyout";

vi.mock("@/lib/indexFunds/fundRedemptionLiquidity", () => ({
  sellFundHoldingShares: vi.fn(),
}));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/banking/policy", () => ({ loadBankingPolicy: vi.fn() }));

import { sellFundHoldingShares } from "@/lib/indexFunds/fundRedemptionLiquidity";

const CEO_ID = new ObjectId();
const CORP_ID = new ObjectId();
const FUND_ID = new ObjectId();

function makeCorp(overrides: Record<string, unknown> = {}) {
  return {
    _id: CORP_ID,
    ceoId: CEO_ID,
    name: "TestCorp",
    sharePrice: 1.0,
    totalShares: 10_000_000,
    publicFloat: 0,
    liquidCapital: 1_000_000,
    liquidCurrencyCode: "USD",
    shareholders: [
      { characterId: CEO_ID, shares: 9_990_000 },
      { fundId: FUND_ID, shares: 10_000 },
    ],
    ...overrides,
  };
}

/**
 * Mock db: `indexFunds` supports find().toArray(); `corporations` supports
 * findOne() (the post-buyback re-read) and updateOne() (the finalize).
 */
function makeDb({ funds, afterCorp }: { funds: unknown[]; afterCorp: unknown }) {
  const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
  const corporations = {
    findOne: vi.fn().mockResolvedValue(afterCorp),
    updateOne,
  };
  const indexFunds = {
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(funds) }),
  };
  const db = {
    collection: vi.fn((name: string) => (name === "indexFunds" ? indexFunds : corporations)),
  } as unknown as Db;
  return { db, updateOne, corporations };
}

// The corp state after the fund has been bought back into float: the fund's
// shareholder entry is gone, its shares now sit in publicFloat.
const afterAllBoughtBack = {
  _id: CORP_ID,
  ceoId: CEO_ID,
  name: "TestCorp",
  shareholders: [{ characterId: CEO_ID, shares: 9_990_000 }],
  publicFloat: 10_000,
};

describe("executeFundOnlyBuyout", () => {
  beforeEach(() => vi.clearAllMocks());

  it("buys the fund out from the treasury, retires the float, and goes private", async () => {
    vi.mocked(sellFundHoldingShares).mockResolvedValue({
      cashRaisedAnchor: 10_000,
      sharesSold: 10_000,
      salesExecuted: 1,
    });
    const { db, updateOne } = makeDb({
      funds: [
        { _id: FUND_ID, name: "Broad", holdings: [{ corporationId: CORP_ID, shares: 10_000 }] },
      ],
      afterCorp: afterAllBoughtBack,
    });

    const result = await executeFundOnlyBuyout(db, makeCorp() as never, 1000);

    expect(result.ok).toBe(true);
    // Bought the fund's whole stake back via the tested corp-funded sellback.
    expect(vi.mocked(sellFundHoldingShares)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sellFundHoldingShares)).toHaveBeenCalledWith(
      db,
      expect.anything(),
      CORP_ID,
      10_000,
      expect.anything()
    );
    // Finalize: single CEO shareholder, float retired, totalShares == CEO shares, private.
    expect(updateOne).toHaveBeenCalledTimes(1);
    const setDoc = updateOne.mock.calls[0][1].$set;
    expect(setDoc.isPrivate).toBe(true);
    expect(setDoc.publicFloat).toBe(0);
    expect(setDoc.totalShares).toBe(9_990_000);
    expect(setDoc.shareholders).toHaveLength(1);
    expect(setDoc.shareholders[0].characterId).toBe(CEO_ID);
    // #2114: approved-but-unissued float is void once private; a surviving
    // flag would block future share proposals as "awaiting market placement".
    expect(updateOne.mock.calls[0][1].$unset.pendingShareIssuance).toBe("");
  });

  it("blocks (and moves no money) when the treasury cannot cover the buyout", async () => {
    const { db, updateOne } = makeDb({ funds: [], afterCorp: afterAllBoughtBack });
    // 10,000 shares × $1 × 1.05 buffer = 10,500 needed; treasury has 5,000.
    const result = await executeFundOnlyBuyout(
      db,
      makeCorp({ liquidCapital: 5_000 }) as never,
      1000
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/treasury is too low/i);
    expect(vi.mocked(sellFundHoldingShares)).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled(); // never went private
  });

  it("aborts without going private when a sellback cannot complete in full", async () => {
    vi.mocked(sellFundHoldingShares).mockResolvedValue({
      cashRaisedAnchor: 4_000,
      sharesSold: 4_000, // only 4k of the 10k could be bought back
      salesExecuted: 1,
    });
    const { db, updateOne } = makeDb({
      funds: [
        { _id: FUND_ID, name: "Broad", holdings: [{ corporationId: CORP_ID, shares: 10_000 }] },
      ],
      afterCorp: afterAllBoughtBack,
    });

    const result = await executeFundOnlyBuyout(db, makeCorp() as never, 1000);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/could not buy back all/i);
    expect(updateOne).not.toHaveBeenCalled(); // corp stays public — safe
  });

  describe("executeFundOnlyBuyout — bank-NAV floor (issue #1750 residual)", () => {
    beforeEach(() => vi.clearAllMocks());

    const BANK_CASH = 60_000_000;
    const BANK_DEPOSITS = 7_700_000;
    const BANK_EQUITY = BANK_CASH - BANK_DEPOSITS; // 52.3M
    const TOTAL_SHARES = 10_000_000;
    const FUND_SHARES = 10_000;
    const MARKET_PRICE = 1.0;
    // Market execution pays 10k x $1 = $10k; the floor is 52.3M / 10M = $5.23
    // per share, so the top-up is 10k x $4.23 = $42,300.
    const BASE_TOP_UP = 42_300;

    function makeCharter(overrides: Record<string, unknown> = {}) {
      return {
        type: "retail",
        status: "active",
        currency: "USD",
        charteredTurn: 150,
        postedCapital: 50_000_000,
        cashReserves: BANK_CASH,
        npcDeposits: BANK_DEPOSITS,
        playerDeposits: 0,
        totalDeposits: BANK_DEPOSITS,
        totalLoans: 0,
        propBookMarkValue: 0,
        discountWindowDebt: 0,
        discountWindowArrears: 0,
        cbMarginDebt: 0,
        cbMarginArrears: 0,
        interbankDebt: 0,
        ...overrides,
      };
    }

    function makeBankCorp(
      charter: Record<string, unknown>,
      overrides: Record<string, unknown> = {}
    ) {
      return makeCorp({
        sharePrice: MARKET_PRICE,
        totalShares: TOTAL_SHARES,
        liquidCapital: 1_000_000_000,
        bankCharter: charter,
        ...overrides,
      });
    }

    /**
     * Mock db with separate spies per collection: `indexFunds` serves the fund
     * load (find) and the top-up credit (updateOne); `exchangeRates` serves the
     * FX load (empty ⇒ USD identity); `corporations` serves the post-buyback
     * re-read (findOne) plus the top-up debit and the finalize (updateOne).
     */
    function makeBankDb({ afterCorp }: { afterCorp: unknown }) {
      const fundUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
      const corpUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
      const db = {
        collection: vi.fn((name: string) => {
          if (name === "indexFunds") {
            return {
              find: vi
                .fn()
                .mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ _id: FUND_ID }]) }),
              updateOne: fundUpdateOne,
            };
          }
          if (name === "exchangeRates") {
            return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
          }
          return {
            findOne: vi.fn().mockResolvedValue(afterCorp),
            updateOne: corpUpdateOne,
          };
        }),
      } as unknown as Db;
      return { db, fundUpdateOne, corpUpdateOne };
    }

    async function mockPointerPolicy() {
      const { loadBankingPolicy } = await import("@/lib/banking/policy");
      vi.mocked(loadBankingPolicy).mockResolvedValue({
        savingsAccounts: "pointer",
        savingsReadCurrencies: [],
      } as never);
    }

    // Market leg pays $1/share for the 10k fund stake; the floor binds above it.
    function mockMarketSellback(cashRaisedAnchor = FUND_SHARES * MARKET_PRICE) {
      vi.mocked(sellFundHoldingShares).mockResolvedValue({
        cashRaisedAnchor,
        sharesSold: FUND_SHARES,
        salesExecuted: 1,
      });
    }

    it("tops the fund up to realizable bank NAV (cash net of deposits) before going private", async () => {
      await mockPointerPolicy();
      mockMarketSellback();
      const { db, fundUpdateOne, corpUpdateOne } = makeBankDb({ afterCorp: afterAllBoughtBack });

      const result = await executeFundOnlyBuyout(db, makeBankCorp(makeCharter()) as never, 1000);

      expect(result.ok).toBe(true);
      // Market sellback ran, then a treasury top-up closed the NAV shortfall.
      expect(vi.mocked(sellFundHoldingShares)).toHaveBeenCalledTimes(1);
      expect(fundUpdateOne).toHaveBeenCalledTimes(1);
      expect(fundUpdateOne.mock.calls[0][1]).toMatchObject({ $inc: { cashAnchor: BASE_TOP_UP } });
      // Corp debit (top-up) + finalize (go private): still privatizes.
      expect(corpUpdateOne).toHaveBeenCalledTimes(2);
      expect(corpUpdateOne.mock.calls[0][1]).toMatchObject({
        $inc: { liquidCapital: -BASE_TOP_UP },
      });
      expect(corpUpdateOne.mock.calls[1][1].$set.isPrivate).toBe(true);
    });

    it("counts the marked bond/prop book in the floor", async () => {
      await mockPointerPolicy();
      mockMarketSellback();
      const propBookMarkValue = 10_000_000;
      const nav = BANK_EQUITY + propBookMarkValue;
      const expectedTopUp =
        Math.round((nav / TOTAL_SHARES - MARKET_PRICE) * FUND_SHARES * 100) / 100;
      const { db, fundUpdateOne } = makeBankDb({ afterCorp: afterAllBoughtBack });

      const result = await executeFundOnlyBuyout(
        db,
        makeBankCorp(makeCharter({ propBookMarkValue })) as never,
        1000
      );

      expect(result.ok).toBe(true);
      expect(expectedTopUp).toBe(52_300);
      expect(fundUpdateOne).toHaveBeenCalledTimes(1);
      expect(fundUpdateOne.mock.calls[0][1]).toMatchObject({ $inc: { cashAnchor: expectedTopUp } });
    });

    it("nets deposits and borrowings against the floor", async () => {
      await mockPointerPolicy();
      mockMarketSellback();
      const discountWindowDebt = 10_000_000;
      const nav = BANK_EQUITY - discountWindowDebt;
      const expectedTopUp =
        Math.round((nav / TOTAL_SHARES - MARKET_PRICE) * FUND_SHARES * 100) / 100;
      const { db, fundUpdateOne } = makeBankDb({ afterCorp: afterAllBoughtBack });

      const result = await executeFundOnlyBuyout(
        db,
        makeBankCorp(makeCharter({ discountWindowDebt })) as never,
        1000
      );

      expect(result.ok).toBe(true);
      expect(expectedTopUp).toBe(32_300);
      expect(fundUpdateOne).toHaveBeenCalledTimes(1);
      expect(fundUpdateOne.mock.calls[0][1]).toMatchObject({ $inc: { cashAnchor: expectedTopUp } });
    });

    it("nets player deposits only once the savings read is authoritative", async () => {
      const playerDeposits = 30_000_000;
      const charter = makeCharter({
        playerDeposits,
        totalDeposits: BANK_DEPOSITS + playerDeposits,
      });

      // Pointer model (default): player balances are not bank liabilities.
      await mockPointerPolicy();
      mockMarketSellback();
      const pointerDb = makeBankDb({ afterCorp: afterAllBoughtBack });
      const pointerResult = await executeFundOnlyBuyout(
        pointerDb.db,
        makeBankCorp(charter) as never,
        1000
      );
      expect(pointerResult.ok).toBe(true);
      expect(pointerDb.fundUpdateOne.mock.calls[0][1]).toMatchObject({
        $inc: { cashAnchor: BASE_TOP_UP },
      });

      // Authoritative read: the same balances are cash-backed liabilities.
      vi.clearAllMocks();
      const { loadBankingPolicy } = await import("@/lib/banking/policy");
      vi.mocked(loadBankingPolicy).mockResolvedValue({
        savingsAccounts: "authoritative",
        savingsReadCurrencies: ["USD"],
      } as never);
      mockMarketSellback();
      const expectedTopUp =
        Math.round(
          ((BANK_EQUITY - playerDeposits) / TOTAL_SHARES - MARKET_PRICE) * FUND_SHARES * 100
        ) / 100;
      expect(expectedTopUp).toBe(12_300);
      const authDb = makeBankDb({ afterCorp: afterAllBoughtBack });
      const authResult = await executeFundOnlyBuyout(
        authDb.db,
        makeBankCorp(charter) as never,
        1000
      );
      expect(authResult.ok).toBe(true);
      expect(authDb.fundUpdateOne).toHaveBeenCalledTimes(1);
      expect(authDb.fundUpdateOne.mock.calls[0][1]).toMatchObject({
        $inc: { cashAnchor: expectedTopUp },
      });
    });

    it("blocks when the treasury covers the market print but not the floored buyout", async () => {
      await mockPointerPolicy();
      const { db, fundUpdateOne, corpUpdateOne } = makeBankDb({ afterCorp: afterAllBoughtBack });
      // Market estimate is 10k x $1 x 1.05 = $10,500; the floored estimate is
      // 10k x $5.23 x 1.05 = $54,915. A 20k treasury covers the former only.
      const result = await executeFundOnlyBuyout(
        db,
        makeBankCorp(makeCharter(), { liquidCapital: 20_000 }) as never,
        1000
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/treasury is too low/i);
      expect(vi.mocked(sellFundHoldingShares)).not.toHaveBeenCalled();
      expect(fundUpdateOne).not.toHaveBeenCalled();
      expect(corpUpdateOne).not.toHaveBeenCalled(); // never went private
    });

    it("leaves non-bank corps on the market price with no top-up", async () => {
      vi.mocked(sellFundHoldingShares).mockResolvedValue({
        cashRaisedAnchor: FUND_SHARES * MARKET_PRICE,
        sharesSold: FUND_SHARES,
        salesExecuted: 1,
      });
      const { db, updateOne } = makeDb({
        funds: [{ _id: FUND_ID }],
        afterCorp: afterAllBoughtBack,
      });

      const result = await executeFundOnlyBuyout(db, makeCorp() as never, 1000);

      expect(result.ok).toBe(true);
      expect(vi.mocked(sellFundHoldingShares)).toHaveBeenCalledTimes(1);
      // No bank ⇒ no floor infra touched, no top-up debit: one updateOne, the finalize.
      expect(updateOne).toHaveBeenCalledTimes(1);
      expect(updateOne.mock.calls[0][1].$set.isPrivate).toBe(true);
    });

    it("keeps the market price when the bank is underwater", async () => {
      await mockPointerPolicy();
      mockMarketSellback();
      const { db, fundUpdateOne, corpUpdateOne } = makeBankDb({ afterCorp: afterAllBoughtBack });

      const result = await executeFundOnlyBuyout(
        db,
        makeBankCorp(
          makeCharter({ cashReserves: 10, npcDeposits: 100, totalDeposits: 100 })
        ) as never,
        1000
      );

      expect(result.ok).toBe(true);
      expect(fundUpdateOne).not.toHaveBeenCalled(); // negative NAV never floors
      expect(corpUpdateOne).toHaveBeenCalledTimes(1); // finalize only
      expect(corpUpdateOne.mock.calls[0][1].$set.isPrivate).toBe(true);
    });
  });

  it("aborts if a non-CEO holder is still present after buyback (drift guard)", async () => {
    vi.mocked(sellFundHoldingShares).mockResolvedValue({
      cashRaisedAnchor: 10_000,
      sharesSold: 10_000,
      salesExecuted: 1,
    });
    const { db, updateOne } = makeDb({
      funds: [
        { _id: FUND_ID, name: "Broad", holdings: [{ corporationId: CORP_ID, shares: 10_000 }] },
      ],
      // Re-read unexpectedly still shows a stray non-CEO shareholder.
      afterCorp: {
        _id: CORP_ID,
        ceoId: CEO_ID,
        name: "TestCorp",
        shareholders: [
          { characterId: CEO_ID, shares: 9_990_000 },
          { fundId: new ObjectId(), shares: 500 },
        ],
        publicFloat: 10_000,
      },
    });

    const result = await executeFundOnlyBuyout(db, makeCorp() as never, 1000);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/non-CEO shareholders/i);
    expect(updateOne).not.toHaveBeenCalled();
  });
});
