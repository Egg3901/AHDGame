import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { processNppSavingsInterest } from "./nppSavingsInterest";

function cursor(list: unknown[]) {
  return { project: () => ({ toArray: () => Promise.resolve(list) }) };
}

describe("processNppSavingsInterest", () => {
  let find: ReturnType<typeof vi.fn>;
  let bulkWrite: ReturnType<typeof vi.fn>;
  let db: Db;
  const prime = () => 5;

  beforeEach(() => {
    find = vi.fn();
    bulkWrite = vi.fn();
    db = { collection: () => ({ find, bulkWrite }) } as unknown as Db;
  });

  it("accrues per-turn interest into the pending bucket (non-quarterly turn)", async () => {
    find.mockReturnValueOnce(
      cursor([{ _id: new ObjectId(), currencyBalances: { savings: { USD: 1_000_000 } } }])
    );
    const res = await processNppSavingsInterest(db, 4, prime); // 4 % 12 !== 0 → no credit pass

    expect(res.nppsAccrued).toBe(1);
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    const op = bulkWrite.mock.calls[0][0][0];
    const inc = op.updateOne.update.$inc as Record<string, number>;
    expect(inc["currencyBalances.pendingSavingsInterest.USD"]).toBeGreaterThan(0);
    // accrual must NOT touch the savings balance itself
    expect(inc).not.toHaveProperty("currencyBalances.savings.USD");
  });

  it("quarterly: flushes pending → savings + interestEarned and zeroes pending", async () => {
    const id = new ObjectId();
    find
      .mockReturnValueOnce(cursor([])) // accrual pass: nobody to accrue
      .mockReturnValueOnce(
        cursor([{ _id: id, currencyBalances: { pendingSavingsInterest: { USD: 50 } } }])
      );

    const res = await processNppSavingsInterest(db, 12, prime); // 12 % 12 === 0 → credit pass

    expect(res.totalInterest).toBe(50);
    const op = bulkWrite.mock.calls[0][0][0];
    expect(op.updateOne.update.$inc).toEqual({
      "currencyBalances.savings.USD": 50,
      "currencyBalances.interestEarned.USD": 50,
    });
    expect(op.updateOne.update.$set).toEqual({
      "currencyBalances.pendingSavingsInterest.USD": 0,
    });
  });
});
