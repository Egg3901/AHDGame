import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { deriveLedgerEntry, reasonForTxType } from "@/lib/ledger/deriveFromTx";
import { reconcileLedger } from "@/lib/ledger/reconcile";
import { buildEscrowFundingTxEntry, buildEscrowWithdrawalTxEntry } from "./escrowTxLog";

const base = {
  corpId: new ObjectId("700000000000000000000001"),
  corpName: "Synthetic escrow fixture",
  turn: 25,
  createdAt: new Date("2026-10-01T00:00:00Z"),
};

describe("escrow cash receipts", () => {
  it.each<[CurrencyCode, number]>([
    ["USD", 1],
    ["EUR", 0.8],
    ["GBP", 0.7],
    ["JPY", 134.67],
  ])(
    "keeps exact %s funding and withdrawal cash with one named transfer reason",
    (currencyCode, rate) => {
      const funding = buildEscrowFundingTxEntry({
        ...base,
        currencyCode,
        escrowFundingMove: 300.25,
        escrowBalanceAfter: 320.75,
      });
      const withdrawal = buildEscrowWithdrawalTxEntry({
        ...base,
        currencyCode,
        amount: 300.25,
        escrowBalanceAfter: 20.5,
      });
      expect(funding?.amount).toBe(-300.25);
      expect(funding?.meta?.escrowBalanceAfter).toBe(320.75);
      expect(withdrawal?.amount).toBe(300.25);
      expect(withdrawal?.meta?.escrowBalanceAfter).toBe(20.5);

      for (const tx of [funding, withdrawal]) {
        expect(tx).not.toBeNull();
        if (!tx) throw new Error("Expected a positive escrow move");
        const input = deriveLedgerEntry({ ...tx, anchorAmount: tx.amount / rate });
        expect(input).not.toBeNull();
        if (!input) throw new Error("Expected a derivable escrow receipt");
        expect(reasonForTxType(tx.type)).toBe("escrow_transfer");
        expect(input.legs[1].account).toMatch(/^(mint|sink):escrow_transfer:/);
        const account = `corporation:${base.corpId}:${currencyCode}`;
        const report = reconcileLedger({
          turn: base.turn,
          entries: [{ ...input, _id: new ObjectId(), balanced: true }],
          openingBalances: { [account]: 1000 / rate },
          closingBalances: { [account]: (1000 + tx.amount) / rate },
        });
        expect(report.trialBalance.unbalancedCount).toBe(0);
        expect(report.stockVsFlow.divergentCount).toBe(0);
        expect(report.unattributed).toEqual([]);
      }
    }
  );

  it("does not round a positive sub-unit transfer to zero", () => {
    const funding = buildEscrowFundingTxEntry({
      ...base,
      currencyCode: "USD",
      escrowFundingMove: 0.25,
      escrowBalanceAfter: 0.5,
    });
    const withdrawal = buildEscrowWithdrawalTxEntry({
      ...base,
      currencyCode: "USD",
      amount: 0.25,
      escrowBalanceAfter: 0.25,
    });
    expect(funding?.amount).toBe(-0.25);
    expect(withdrawal?.amount).toBe(0.25);
  });
});
