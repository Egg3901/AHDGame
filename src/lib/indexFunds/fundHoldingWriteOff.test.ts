import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IndexFund, IndexFundHolding } from "@/lib/db/types";
import {
  selectDeadHoldingIds,
  writeOffDeadConstituentHoldings,
} from "@/lib/indexFunds/fundHoldingWriteOff";

vi.mock("@/lib/indexFunds/fundQueries", () => ({
  insertFundTransaction: vi.fn().mockResolvedValue(undefined),
  updateFundHoldings: vi.fn().mockResolvedValue(undefined),
}));

const holding = (id: ObjectId, value: number, shares = 100): IndexFundHolding => ({
  corporationId: id,
  shares,
  avgCostPerShareAnchor: value / shares,
  lastValueAnchor: value,
});

const makeFund = (holdings: IndexFundHolding[]): IndexFund =>
  ({
    _id: new ObjectId(),
    slug: "test-fund",
    status: "active",
    quotedNav: 100,
    cashAnchor: 0,
    unitSupply: 1000,
    holdings,
    targetConstituents: [],
  }) as unknown as IndexFund;

/** Mongo double: `corporations.find(...)` returns only the ids listed as live. */
const dbWithLiveCorps = (live: ObjectId[]) =>
  ({
    collection: () => ({
      find: (filter: { _id: { $in: ObjectId[] } }) => ({
        toArray: async () =>
          filter._id.$in.filter((id) => live.some((l) => l.equals(id))).map((id) => ({ _id: id })),
      }),
    }),
  }) as unknown as import("mongodb").Db;

describe("writeOffDeadConstituentHoldings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes a holding whose corporation no longer exists", async () => {
    const dead = new ObjectId();
    const fund = makeFund([holding(dead, 500)]);

    const result = await writeOffDeadConstituentHoldings(dbWithLiveCorps([]), fund, fund.holdings);

    expect(result.writtenOffCount).toBe(1);
    expect(result.writtenOffValueAnchor).toBe(500);

    const { updateFundHoldings, insertFundTransaction } =
      await import("@/lib/indexFunds/fundQueries");
    expect(vi.mocked(updateFundHoldings).mock.calls[0][2]).toEqual([]);
    // The write-off is backing leaving the fund, so it must not read as income.
    expect(vi.mocked(insertFundTransaction).mock.calls[0][1]).toMatchObject({
      kind: "holding_writeoff",
      amountAnchor: -500,
    });
  });

  it("leaves a live corporation's holding alone and reports it as unsellable", async () => {
    const live = new ObjectId();
    const fund = makeFund([holding(live, 900)]);

    const result = await writeOffDeadConstituentHoldings(
      dbWithLiveCorps([live]),
      fund,
      fund.holdings
    );

    expect(result.writtenOffCount).toBe(0);
    expect(result.unsellableCount).toBe(1);
    expect(result.unsellableValueAnchor).toBe(900);

    // Zeroing a live position would destroy real holder value, so nothing is written.
    const { updateFundHoldings } = await import("@/lib/indexFunds/fundQueries");
    expect(updateFundHoldings).not.toHaveBeenCalled();
  });

  it("writes off only the dead holdings in a mixed book", async () => {
    const dead = new ObjectId();
    const live = new ObjectId();
    const untouched = new ObjectId();
    const fund = makeFund([holding(dead, 300), holding(live, 400), holding(untouched, 700)]);

    // Only the first two were flagged for removal; the third stays regardless.
    const result = await writeOffDeadConstituentHoldings(dbWithLiveCorps([live, untouched]), fund, [
      fund.holdings[0],
      fund.holdings[1],
    ]);

    expect(result.writtenOffCount).toBe(1);
    expect(result.writtenOffValueAnchor).toBe(300);

    const { updateFundHoldings } = await import("@/lib/indexFunds/fundQueries");
    const remaining = vi.mocked(updateFundHoldings).mock.calls[0][2];
    expect(remaining.map((h) => h.corporationId)).toEqual([live, untouched]);
  });

  it("does not re-write-off a holding the sale already cleared", async () => {
    const sold = new ObjectId();
    // Flagged for removal, but the sale succeeded so it is gone from the book.
    const fund = makeFund([]);

    const result = await writeOffDeadConstituentHoldings(dbWithLiveCorps([]), fund, [
      holding(sold, 500),
    ]);

    expect(result.writtenOffCount).toBe(0);
    const { updateFundHoldings } = await import("@/lib/indexFunds/fundQueries");
    expect(updateFundHoldings).not.toHaveBeenCalled();
  });

  it("ignores holdings already at zero shares", async () => {
    const dead = new ObjectId();
    const fund = makeFund([holding(dead, 0, 0)]);

    const result = await writeOffDeadConstituentHoldings(dbWithLiveCorps([]), fund, fund.holdings);

    expect(result.writtenOffCount).toBe(0);
  });

  it("does nothing when the rebalance flagged nothing", async () => {
    const fund = makeFund([holding(new ObjectId(), 100)]);
    const result = await writeOffDeadConstituentHoldings(dbWithLiveCorps([]), fund, []);
    expect(result).toMatchObject({ writtenOffCount: 0, unsellableCount: 0 });
  });
});

describe("selectDeadHoldingIds", () => {
  it("picks exactly the holdings with no live corporation", () => {
    const dead = new ObjectId();
    const live = new ObjectId();
    const ids = selectDeadHoldingIds([holding(dead, 100), holding(live, 100)], [live]);
    expect(ids).toEqual([dead]);
  });

  it("accepts string ids for the live set", () => {
    const dead = new ObjectId();
    const live = new ObjectId();
    const ids = selectDeadHoldingIds([holding(dead, 100), holding(live, 100)], [live.toString()]);
    expect(ids).toEqual([dead]);
  });
});
