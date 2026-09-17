import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createAsyncIterableCursor, createMockDb } from "@/lib/test-utils/mockDb";
import { sumFundBondHoldingsByFundId } from "./fundBondHoldings";

describe("sumFundBondHoldingsByFundId", () => {
  it("values several funds from one projected bond query", async () => {
    const db = createMockDb();
    const first = new ObjectId();
    const second = new ObjectId();
    const bonds = db.collection("bonds");
    bonds.find.mockReturnValue(
      createAsyncIterableCursor([
        {
          _id: new ObjectId(),
          countryId: "US",
          currencyCode: "USD",
          marketPrice: 0.9,
          holders: [
            { fundId: first, units: 2 },
            { fundId: second, units: 3 },
          ],
        },
      ])
    );

    const totals = await sumFundBondHoldingsByFundId(
      db as unknown as Db,
      [
        { _id: first, anchorCurrencyCode: "USD" },
        { _id: second, anchorCurrencyCode: "USD" },
      ],
      { USD: 1 }
    );

    expect(totals.get(first.toString())).toBe(1_800);
    expect(totals.get(second.toString())).toBe(2_700);
    expect(bonds.find).toHaveBeenCalledTimes(1);
  });
});
