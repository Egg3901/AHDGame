import { describe, it, expect, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { loadGroupBondDebt } from "./financialComparison";
vi.mock("@/lib/currency/corporationCapital", () => ({
  loadValuationFxRates: vi.fn(async () => new Map([["GBP", 2]])),
}));
import { loadValuationFxRates } from "@/lib/currency/corporationCapital";
describe("Group debt loading", () => {
  it("performs one projected batch read for all authorized corporations", async () => {
    const a = new ObjectId(),
      b = new ObjectId();
    const find = vi.fn(() => ({
      toArray: async () => [{ corporationId: a, totalIssued: 200, currencyCode: "GBP" }],
    }));
    const collection = vi.fn(() => ({ find }));
    expect(await loadGroupBondDebt({ collection } as unknown as Db, [a, b])).toEqual(
      new Map([
        [a.toString(), 100],
        [b.toString(), 0],
      ])
    );
    expect(collection).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith(
      { corporationId: { $in: [a, b] }, matured: false },
      { projection: { corporationId: 1, totalIssued: 1, currencyCode: 1, countryId: 1 } }
    );
  });
  it("does no debt or FX reads when no private corporation is visible", async () => {
    vi.mocked(loadValuationFxRates).mockClear();
    const collection = vi.fn();
    expect(await loadGroupBondDebt({ collection } as unknown as Db, [])).toEqual(new Map());
    expect(collection).not.toHaveBeenCalled();
    expect(loadValuationFxRates).not.toHaveBeenCalled();
  });
});
