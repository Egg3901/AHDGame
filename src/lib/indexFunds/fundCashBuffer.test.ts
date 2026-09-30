import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { IndexFund } from "@/lib/db/types";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { restoreFundCashBuffer } from "./fundCron";
import { sellFundBondHoldingsForCash } from "@/lib/bonds/sellFundBondUnits";
import { sumFundBondHoldingsValueAnchor } from "@/lib/bonds/fundBondHoldings";
import { getFundById, updateFundNav } from "./fundQueries";
import { cancelFundShareOrder } from "./fundShareOrders";
import { loadQueuedRedemptionUnitsByFundId } from "./fundValuation";

vi.mock("@/lib/bonds/sellFundBondUnits", () => ({ sellFundBondHoldingsForCash: vi.fn() }));
vi.mock("@/lib/bonds/fundBondHoldings", () => ({ sumFundBondHoldingsValueAnchor: vi.fn() }));
vi.mock("./fundShareOrders", () => ({ cancelFundShareOrder: vi.fn() }));
vi.mock("./fundQueries", () => ({ getFundById: vi.fn(), updateFundNav: vi.fn() }));
vi.mock("./fundValuation", () => ({
  loadOpenOrdersEscrowByFundId: vi.fn().mockResolvedValue(new Map()),
  loadQueuedRedemptionUnitsByFundId: vi.fn().mockResolvedValue(new Map()),
}));

const fund: IndexFund = {
  _id: new ObjectId(),
  slug: "buffer",
  name: "Buffer",
  tickerSymbol: "BUFF",
  scope: "global",
  kind: "bond",
  anchorCurrencyCode: "USD",
  status: "active",
  quotedNav: 100,
  unitSupply: 100,
  reserveUnits: 100,
  cashAnchor: 400,
  holdings: [],
  targetConstituents: [],
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fund cash buffer restoration", () => {
  it("uses real sale proceeds and remarks the retained bond book including queued units", async () => {
    vi.mocked(sellFundBondHoldingsForCash).mockResolvedValue({
      proceedsAnchor: 110,
      unitsSold: 1,
      bondsTouched: 1,
    });
    vi.mocked(sumFundBondHoldingsValueAnchor).mockResolvedValue(9480);
    vi.mocked(getFundById).mockResolvedValue({ ...fund, cashAnchor: 510 });
    vi.mocked(loadQueuedRedemptionUnitsByFundId).mockResolvedValue(
      new Map([[String(fund._id), 10]])
    );
    const db = createMockDb();
    const result = await restoreFundCashBuffer(db as never, fund, 9600, { USD: 1 }, 74);
    expect(sellFundBondHoldingsForCash).toHaveBeenCalledWith(db, fund, 100, expect.any(Date), {
      turn: 74,
    });
    expect(result.bondPrincipalAnchor).toBe(9480);
    expect(updateFundNav).toHaveBeenCalledWith(db, fund._id, {
      quotedNav: 9990 / 110,
      backingRatio: 1,
    });
  });

  it("does not manufacture cash or change NAV when the dealer cannot buy", async () => {
    vi.mocked(sellFundBondHoldingsForCash).mockResolvedValue({
      proceedsAnchor: 0,
      unitsSold: 0,
      bondsTouched: 0,
    });
    const result = await restoreFundCashBuffer(createMockDb() as never, fund, 9600, { USD: 1 }, 74);
    expect(result).toEqual({ fund, bondPrincipalAnchor: 9600 });
    expect(updateFundNav).not.toHaveBeenCalled();
  });

  it("releases unused bids before selling bonds and leaves the restored buffer alone", async () => {
    const bidId = new ObjectId();
    const db = {
      collection: vi.fn(() => ({
        find: vi.fn(() => ({ toArray: async () => [{ _id: bidId, escrowAnchor: 200 }] })),
      })),
    } as never;
    const restored = { ...fund, cashAnchor: 600 };
    vi.mocked(getFundById).mockResolvedValue(restored);
    const result = await restoreFundCashBuffer(db, fund, 9600, { USD: 1 }, 74);
    expect(cancelFundShareOrder).toHaveBeenCalledWith(db, bidId, 74, { fund });
    expect(sellFundBondHoldingsForCash).not.toHaveBeenCalled();
    expect(result.fund.cashAnchor).toBe(600);
    await restoreFundCashBuffer(db, result.fund, 9600, { USD: 1 }, 75);
    expect(cancelFundShareOrder).toHaveBeenCalledTimes(1);
  });

  it("leaves a funded buffer and a book without bonds alone", async () => {
    await restoreFundCashBuffer(
      createMockDb() as never,
      { ...fund, cashAnchor: 600 },
      9400,
      { USD: 1 },
      74
    );
    await restoreFundCashBuffer(createMockDb() as never, fund, 0, { USD: 1 }, 74);
    expect(sellFundBondHoldingsForCash).not.toHaveBeenCalled();
  });
});
