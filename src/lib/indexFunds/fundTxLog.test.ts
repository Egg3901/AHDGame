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
    // anchorAmount must stay undefined so emitTx FX-converts `amount` (the fund's
    // anchor currency) into the internal anchor unit. Pre-setting it skipped the
    // conversion and logged ~114× the true anchor value for JPY-anchored funds.
    expect(entry.anchorAmount).toBeUndefined();
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

  it("leaves anchorAmount undefined for a non-USD fund so emitTx converts it", () => {
    const entry = buildIndexFundDividendTxEntry({
      fund: {
        _id: new ObjectId(),
        slug: "jp50",
        name: "Nikkei 50 Index",
        tickerSymbol: "JP50",
        anchorCurrencyCode: "JPY",
      },
      holder: { holderKind: "character", holderId: new ObjectId(), holderName: "Ren" },
      amountAnchor: 391_380_703.9,
      units: 13_426_963,
      corporationId: new ObjectId(),
      turn: 1,
    });

    // amount carries the native JPY value; anchorAmount is left for emitTx to
    // derive via FX. If this regresses, the suspect scanner sees ~114× inflated
    // logged-net and raises spurious cash_mismatch flags on JPY-fund holders.
    expect(entry.currencyCode).toBe("JPY");
    expect(entry.amount).toBe(391_380_703.9);
    expect(entry.anchorAmount).toBeUndefined();
  });

  it("registers index fund tx types in ALL_TX_TYPES", () => {
    expect(ALL_TX_TYPES).toContain("index_fund_subscribe");
    expect(ALL_TX_TYPES).toContain("index_fund_redeem");
    expect(ALL_TX_TYPES).toContain("index_fund_dividend");
  });
});
