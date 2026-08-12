import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { buildIndexFundDividendTxEntry } from "./fundTxLog";
import { ALL_TX_TYPES } from "@/lib/financialTxLog/types-extended";

describe("fundTxLog", () => {
  it("buildIndexFundDividendTxEntry includes fund and corporation metadata", () => {
    const fundId = new ObjectId();
    const holderId = new ObjectId();
    const corporationId = new ObjectId();

    const entry = buildIndexFundDividendTxEntry({
      fund: {
        _id: fundId,
        slug: "us25",
        name: "US Broad 25",
        tickerSymbol: "US25",
        anchorCurrencyCode: "USD",
      },
      holder: {
        holderKind: "character",
        holderId,
        holderName: "Alice",
      },
      amountAnchor: 125.5,
      units: 10,
      corporationId,
      corporationName: "Acme Corp",
      turn: 42,
      createdAt: new Date("2026-06-09T12:00:00Z"),
    });

    expect(entry.type).toBe("index_fund_dividend");
    expect(entry.amount).toBe(125.5);
    // `amountAnchor` is ₳. With no native figure supplied the two coincide, and
    // stating anchorAmount keeps emitTx from re-deriving it through FX.
    expect(entry.anchorAmount).toBe(125.5);
    expect(entry.turn).toBe(42);
    expect(entry.meta).toMatchObject({
      fundId: fundId.toString(),
      fundSlug: "us25",
      fundTicker: "US25",
      units: 10,
      corporationId: corporationId.toString(),
      corporationName: "Acme Corp",
    });
  });

  it("states the ₳ value and the native value separately for a non-USD fund", () => {
    const entry = buildIndexFundDividendTxEntry({
      fund: {
        _id: new ObjectId(),
        slug: "jp50",
        name: "Nikkei 50 Index",
        tickerSymbol: "JP50",
        anchorCurrencyCode: "JPY",
      },
      holder: { holderKind: "character", holderId: new ObjectId(), holderName: "Ren" },
      amountAnchor: 3_427_000,
      amountNative: 391_380_703.9,
      units: 13_426_963,
      corporationId: new ObjectId(),
      turn: 1,
    });

    // `amount` is what the yen wallet actually received; `anchorAmount` is the ₳
    // value the fund actually paid out. Collapsing the two is what made a JPY
    // fund's ledger row wrong by the whole exchange rate.
    expect(entry.currencyCode).toBe("JPY");
    expect(entry.amount).toBe(391_380_703.9);
    expect(entry.anchorAmount).toBe(3_427_000);
  });

  it("registers index fund tx types in ALL_TX_TYPES", () => {
    expect(ALL_TX_TYPES).toContain("index_fund_subscribe");
    expect(ALL_TX_TYPES).toContain("index_fund_redeem");
    expect(ALL_TX_TYPES).toContain("index_fund_dividend");
  });
});
