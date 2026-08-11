import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { applyExchangeRateDepreciation } from "../fxDepreciation";

function makeDb(currentRate: number | null) {
  const findOne = vi.fn().mockResolvedValue(currentRate === null ? null : { rate: currentRate });
  const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  const db = {
    collection: vi.fn().mockReturnValue({ findOne, updateOne }),
  } as unknown as Db;
  return { db, findOne, updateOne };
}

describe("applyExchangeRateDepreciation", () => {
  it("multiplies rate by 1+percent and reports old/new", async () => {
    const { db, updateOne } = makeDb(100);
    const r = await applyExchangeRateDepreciation(db, "US", 0.4);
    expect(r.ok).toBe(true);
    expect(r.previousRate).toBe(100);
    expect(r.newRate).toBe(140);
    expect(updateOne).toHaveBeenCalledTimes(1);
    const call = updateOne.mock.calls[0];
    expect(call[1].$set.rate).toBe(140);
  });

  it("returns ok=false when no exchangeRate row exists", async () => {
    const { db, updateOne } = makeDb(null);
    const r = await applyExchangeRateDepreciation(db, "US", 0.4);
    expect(r.ok).toBe(false);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("treats negative percent (appreciation) as documented behavior — multiplier < 1", async () => {
    const { db } = makeDb(100);
    const r = await applyExchangeRateDepreciation(db, "US", -0.1);
    expect(r.newRate).toBe(90);
  });

  it("zero percent is a no-op multiplier", async () => {
    const { db } = makeDb(100);
    const r = await applyExchangeRateDepreciation(db, "US", 0);
    expect(r.newRate).toBe(100);
  });
});
