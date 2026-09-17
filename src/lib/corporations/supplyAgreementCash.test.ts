import { describe, expect, it } from "vitest";
import { lastTurnSupplyAgreementCash } from "./supplyAgreementCash";

describe("lastTurnSupplyAgreementCash", () => {
  it("sums the corp's last-turn buyer and supplier legs and skips other turns", () => {
    const cash = lastTurnSupplyAgreementCash({
      corpId: "corp-a",
      turn: 10,
      agreements: [
        {
          supplierCorpId: "npp-chem",
          buyerCorpId: "corp-a",
          lastDeliveryTurn: 10,
          lastSupplierCashDelta: 2721,
          lastBuyerCashDelta: -2721,
          lastUnpaidSettlementAnchor: 802,
        },
        {
          supplierCorpId: "corp-a",
          buyerCorpId: "npp-buyer",
          lastDeliveryTurn: 10,
          lastSupplierCashDelta: 608,
          lastBuyerCashDelta: -608,
          lastUnpaidSettlementAnchor: 0,
        },
        {
          supplierCorpId: "npp-chem",
          buyerCorpId: "corp-a",
          lastDeliveryTurn: 9,
          lastBuyerCashDelta: -9999,
          lastUnpaidSettlementAnchor: 50,
        },
      ],
    });
    expect(cash.netLocal).toBe(-2113);
    expect(cash.unpaidAnchor).toBe(802);
  });

  it("does not invent a buyer debit from the supplier's local cash", () => {
    const cash = lastTurnSupplyAgreementCash({
      corpId: "corp-a",
      turn: 10,
      agreements: [
        {
          supplierCorpId: "npp-chem",
          buyerCorpId: "corp-a",
          lastDeliveryTurn: 10,
          lastSupplierCashDelta: 2721,
        },
      ],
    });
    expect(cash.netLocal).toBe(0);
  });
});
