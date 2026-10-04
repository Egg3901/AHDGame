import { describe, expect, it, vi } from "vitest";
import { loadInvestmentBondReference } from "./bondReference";

describe("investment sovereign reference read", () => {
  it("reads one projected active same-currency short issue with market float", async () => {
    const findOne = vi
      .fn()
      .mockResolvedValue({ couponRate: 6, marketPrice: 1, maturityTurn: 58, currencyCode: "EUR" });
    const collection = vi.fn().mockReturnValue({ findOne });
    expect(await loadInvestmentBondReference({ collection } as never, "EUR", 10)).toMatchObject({
      annualYieldPercent: 6,
    });
    expect(findOne).toHaveBeenCalledExactlyOnceWith(
      {
        issuerType: "sovereign",
        currencyCode: "EUR",
        matured: false,
        defaulted: false,
        publicFloat: { $gt: 0 },
        maturityTurn: { $gt: 10, $lte: 58 },
      },
      {
        projection: {
          _id: 0,
          couponRate: 1,
          marketPrice: 1,
          maturityTurn: 1,
          currencyCode: 1,
          issuerName: 1,
          countryId: 1,
        },
        sort: { maturityTurn: 1, _id: 1 },
      }
    );
  });
  it("leaves an absent currency or absent issue explicit without a substituted quote", async () => {
    const collection = vi.fn().mockReturnValue({ findOne: vi.fn().mockResolvedValue(null) });
    expect(await loadInvestmentBondReference({ collection } as never, undefined, 10)).toBeNull();
    expect(await loadInvestmentBondReference({ collection } as never, "UNKNOWN", 10)).toBeNull();
    expect(collection).not.toHaveBeenCalled();
    expect(await loadInvestmentBondReference({ collection } as never, "USD", 10)).toBeNull();
  });
});
