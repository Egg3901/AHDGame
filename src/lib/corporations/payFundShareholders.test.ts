import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { payFundShareholderRows } from "./payFundShareholders";

function makeDb(funds: { _id: ObjectId; anchorCurrencyCode: string; name: string }[] = []) {
  const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  const find = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(funds) });
  const db = { collection: vi.fn().mockReturnValue({ updateOne, find }) } as unknown as Db;
  return { db, updateOne, find };
}

describe("payFundShareholderRows", () => {
  beforeEach(() => vi.clearAllMocks());

  it("credits each fund's cashAnchor (₳, no FX) and drops its holding of the dissolved corp", async () => {
    const corpId = new ObjectId();
    const fundA = new ObjectId();
    const fundB = new ObjectId();
    const { db, updateOne } = makeDb();

    const { totalPaidAnchor, txEntries } = await payFundShareholderRows(
      db,
      [
        { fundId: fundA.toString(), name: "Broad", shares: 100, payout: 5_000 },
        { fundId: fundB.toString(), name: "Tech", shares: 50, payout: 2_500 },
      ],
      corpId,
      new Date()
    );

    expect(totalPaidAnchor).toBe(7_500);
    expect(txEntries).toHaveLength(0);
    expect(updateOne).toHaveBeenCalledTimes(2);
    const [filter, update] = updateOne.mock.calls[0];
    expect(filter._id.toString()).toBe(fundA.toString());
    expect(update.$inc.cashAnchor).toBe(5_000); // payout is already ₳ — no conversion
    expect(update.$pull.holdings.corporationId).toBe(corpId);
  });

  it("skips non-positive payouts and pays nothing for an empty list", async () => {
    const { db, updateOne } = makeDb();
    const { totalPaidAnchor, txEntries } = await payFundShareholderRows(
      db,
      [{ fundId: new ObjectId().toString(), name: "Z", shares: 0, payout: 0 }],
      new ObjectId(),
      new Date()
    );
    expect(totalPaidAnchor).toBe(0);
    expect(txEntries).toHaveLength(0);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("#992 tranche 3: books a fund-subject leg per credit when ledger context is passed", async () => {
    const corpId = new ObjectId();
    const fundA = new ObjectId();
    const { db } = makeDb([{ _id: fundA, anchorCurrencyCode: "USD", name: "Broad" }]);

    const { totalPaidAnchor, txEntries } = await payFundShareholderRows(
      db,
      [{ fundId: fundA.toString(), name: "Broad", shares: 100, payout: 5_000 }],
      corpId,
      new Date("2026-07-06T00:00:00Z"),
      {
        ledger: {
          turn: 5,
          txType: "corp_dissolution_distribution",
          counterpartyId: corpId,
          counterpartyName: "Dead Corp",
        },
      }
    );

    expect(totalPaidAnchor).toBe(5_000);
    expect(txEntries).toHaveLength(1);
    expect(txEntries[0]).toMatchObject({
      type: "corp_dissolution_distribution",
      turn: 5,
      subjectType: "fund",
      subjectId: fundA,
      amount: 5_000,
      anchorAmount: 5_000,
      currencyCode: "USD",
      counterpartyType: "corporation",
      counterpartyId: corpId,
    });
    expect(txEntries[0].meta).toMatchObject({
      side: "fund_shareholder",
      fundId: fundA.toString(),
      fundCurrency: "USD",
    });
  });

  it("#992 tranche 3: stays unbooked without ledger context or a fund doc", async () => {
    const corpId = new ObjectId();
    const missing = new ObjectId();
    // No fund docs in the db: the credit still lands, but no leg is guessed.
    const { db } = makeDb([]);

    const { totalPaidAnchor, txEntries } = await payFundShareholderRows(
      db,
      [{ fundId: missing.toString(), name: "Ghost", shares: 10, payout: 1_000 }],
      corpId,
      new Date(),
      {
        ledger: {
          turn: 5,
          txType: "share_buyout_payout",
          kind: "agreed_acquisition",
          counterpartyId: corpId,
          counterpartyName: "Target",
        },
      }
    );

    expect(totalPaidAnchor).toBe(1_000);
    expect(txEntries).toHaveLength(0);
  });
});
