import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { executeFundOnlyBuyout } from "./fundOnlyBuyout";

vi.mock("@/lib/indexFunds/fundRedemptionLiquidity", () => ({
  sellFundHoldingShares: vi.fn(),
}));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));

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
