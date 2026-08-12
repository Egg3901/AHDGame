import { describe, expect, it } from "vitest";
import { reasonForTxType } from "./deriveFromTx";

describe("prop-book trades net against each other", () => {
  it("maps both directions to ONE reason", () => {
    // A trade is a reclass between the bank's cash and its own book, and the
    // book is an asset account the shadow ledger does not carry. Sharing a
    // reason is what lets the reconciler net a purchase against its own sale
    // per currency, instead of reporting two unrelated single-sided flows.
    expect(reasonForTxType("bank_prop_trade_buy")).toBe("prop_book");
    expect(reasonForTxType("bank_prop_trade_sell")).toBe("prop_book");
  });

  it("keeps the reclass distinct from capacity capex, which nets separately", () => {
    expect(reasonForTxType("bank_prop_trade_buy")).not.toBe(
      reasonForTxType("corp_capacity_build")
    );
  });

  it("leaves the genuinely one-sided banking rows unattributed rather than faking a pair", () => {
    // Origination mints and a haircut sinks. Neither has an opposite leg to net
    // against, so they must NOT be given a shared reason.
    expect(reasonForTxType("bank_loan_origination")).not.toBe("prop_book");
    expect(reasonForTxType("bank_insurance_payout")).not.toBe("prop_book");
  });
});
