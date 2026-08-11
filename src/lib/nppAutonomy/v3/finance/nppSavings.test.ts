import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { depositNppSavings, withdrawNppSavings } from "./nppSavings";

describe("npp savings command cores", () => {
  let findOneAndUpdate: ReturnType<typeof vi.fn>;
  let db: Db;
  const nppId = new ObjectId();
  const npp = { _id: nppId, countryId: "US" as const };

  beforeEach(() => {
    findOneAndUpdate = vi.fn();
    db = {
      collection: () => ({ findOneAndUpdate }),
    } as unknown as Db;
  });

  it("deposit moves funds → savings atomically with a funds guard", async () => {
    findOneAndUpdate.mockResolvedValue({
      _id: nppId,
      funds: 9000,
      currencyBalances: { savings: { USD: 1000 } },
    });
    const res = await depositNppSavings(db, npp, 1000);
    expect(res).toEqual({ ok: true, amount: 1000, currency: "USD", funds: 9000, savings: 1000 });

    const [filter, update] = findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: nppId, funds: { $gte: 1000 } });
    expect(update.$inc).toEqual({ funds: -1000, "currencyBalances.savings.USD": 1000 });
  });

  it("deposit rejects non-positive amounts without touching the db", async () => {
    expect(await depositNppSavings(db, npp, 0)).toEqual({
      ok: false,
      reason: "Deposit amount must be positive.",
    });
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("deposit fails cleanly when the guard rejects (insufficient funds)", async () => {
    findOneAndUpdate.mockResolvedValue(null);
    expect(await depositNppSavings(db, npp, 5000)).toEqual({
      ok: false,
      reason: "Insufficient liquid funds for deposit.",
    });
  });

  it("withdraw moves savings → funds atomically with a savings guard", async () => {
    findOneAndUpdate.mockResolvedValue({
      _id: nppId,
      funds: 6000,
      currencyBalances: { savings: { USD: 0 } },
    });
    const res = await withdrawNppSavings(db, npp, 1000);
    expect(res.ok).toBe(true);

    const [filter, update] = findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: nppId, "currencyBalances.savings.USD": { $gte: 1000 } });
    expect(update.$inc).toEqual({ funds: 1000, "currencyBalances.savings.USD": -1000 });
  });

  it("withdraw fails cleanly when the guard rejects (insufficient savings)", async () => {
    findOneAndUpdate.mockResolvedValue(null);
    expect(await withdrawNppSavings(db, npp, 1000)).toEqual({
      ok: false,
      reason: "Insufficient savings for withdrawal.",
    });
  });
});
