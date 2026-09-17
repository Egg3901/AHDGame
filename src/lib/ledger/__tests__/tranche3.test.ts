import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  deriveLedgerEntries,
  fundMirrorAccount,
  reasonForTxType,
  type DerivableTx,
} from "@/lib/ledger/deriveFromTx";
import { subjectAccount, isRealAccount } from "@/lib/ledger/accounts";
import { reconcileLedger } from "@/lib/ledger/reconcile";
import { isAnchorBalanced } from "@/lib/ledger/epsilon";
import type { LedgerEntry } from "@/lib/ledger/types";

function tx(overrides: Partial<DerivableTx>): DerivableTx {
  return {
    type: "wire_transfer_out",
    turn: 5,
    createdAt: new Date("2026-07-06T00:00:00Z"),
    subjectType: "character",
    subjectId: new ObjectId(),
    amount: -1000,
    currencyCode: "USD",
    anchorAmount: -1000,
    ...overrides,
  };
}

function ledgerEntry(txType: LedgerEntry["txType"], legs: LedgerEntry["legs"]): LedgerEntry {
  return {
    _id: new ObjectId(),
    turn: 5,
    createdAt: new Date("2026-07-06T00:00:00Z"),
    txType,
    legs,
    emitSite: "test/tranche3",
    balanced: true,
  };
}

const FUND_ID = new ObjectId().toString();
const SELLER_ID = new ObjectId().toString();

describe("#992 tranche 3a — fund-subject enablement", () => {
  it("maps fund subjects to fund accounts", () => {
    const id = new ObjectId();
    expect(subjectAccount("fund", { subjectId: id.toString() }, "USD")).toBe(
      `fund:${id.toString()}:USD`
    );
    expect(isRealAccount(`fund:${FUND_ID}:USD`)).toBe(true);
  });

  it("mirrors an NPP subscribe row with no mint or sink", () => {
    const entries = deriveLedgerEntries([
      tx({
        type: "index_fund_subscribe",
        subjectType: "npp",
        amount: -500,
        anchorAmount: -500,
        meta: { fundId: FUND_ID, fundCurrency: "USD", units: 5, source: "npp-cron" },
      }),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0].legs[1].account).toBe(`fund:${FUND_ID}:USD`);
    expect(entries[1].legs[0].account).toBe(`fund:${FUND_ID}:USD`);
    for (const e of entries) {
      expect(isAnchorBalanced(e.legs)).toBe(true);
      expect(e.legs.some((l) => l.account.startsWith("mint:"))).toBe(false);
      expect(e.legs.some((l) => l.account.startsWith("sink:"))).toBe(false);
    }
  });

  it("mirrors a cross-fund buyer row against the seller fund", () => {
    const entries = deriveLedgerEntries([
      tx({
        type: "fund_transfer",
        subjectType: "fund",
        subjectId: new ObjectId(FUND_ID),
        amount: -800,
        anchorAmount: -800,
        meta: { fundId: SELLER_ID, fundCurrency: "USD" },
      }),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0].legs[0].account).toBe(`fund:${FUND_ID}:USD`);
    expect(entries[0].legs[1].account).toBe(`fund:${SELLER_ID}:USD`);
    expect(entries[1].legs[0].account).toBe(`fund:${SELLER_ID}:USD`);
    for (const e of entries) expect(isAnchorBalanced(e.legs)).toBe(true);
  });

  it("leaves genuine sector revenue and the charter seed row single-sided", () => {
    const plain = deriveLedgerEntries([
      tx({ type: "corp_revenue", subjectType: "corporation", amount: 2000, anchorAmount: 2000 }),
    ]);
    expect(plain).toHaveLength(1);
    expect(plain[0].legs[1].account).toBe("mint:sector_revenue:USD");

    // Charter debit covers seed + fee while the fund receives seed alone, so
    // the charter row carries fundId but deliberately no fundCurrency.
    const charter = tx({
      type: "corp_capital_seed",
      subjectType: "corporation",
      amount: -3000,
      anchorAmount: -3000,
      meta: { kind: "fund_charter", fundId: FUND_ID },
    });
    expect(fundMirrorAccount(charter)).toBeNull();
    expect(deriveLedgerEntries([charter])).toHaveLength(1);
  });

  it("mirrors fee and seed-return rows once fundCurrency is present", () => {
    const fee = deriveLedgerEntries([
      tx({
        type: "corp_revenue",
        subjectType: "corporation",
        amount: 120,
        anchorAmount: 120,
        meta: { kind: "fund_expense_fee", fundId: FUND_ID, fundCurrency: "USD" },
      }),
    ]);
    expect(fee).toHaveLength(2);
    expect(fee[1].legs[0].account).toBe(`fund:${FUND_ID}:USD`);
    expect(fee[1].legs[0].anchorAmount).toBe(-120);
  });

  it("attributes the retained dividend slice instead of backloging it", () => {
    expect(reasonForTxType("dividend_reinvest")).toBe("fund_dividend_retained");
    const entries = deriveLedgerEntries([
      tx({
        type: "dividend_reinvest",
        subjectType: "fund",
        subjectId: new ObjectId(FUND_ID),
        amount: 750,
        anchorAmount: 750,
      }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].legs[1].account).toBe("mint:fund_dividend_retained:USD");
  });

  it("fully covered cross-fund pair reconciles green", () => {
    const buyer = `fund:${FUND_ID}:USD`;
    const seller = `fund:${SELLER_ID}:USD`;
    const report = reconcileLedger({
      turn: 5,
      entries: [
        ledgerEntry("fund_transfer", [
          {
            account: buyer,
            amount: -800,
            currencyCode: "USD",
            anchorAmount: -800,
            role: "primary",
          },
          { account: seller, amount: 800, currencyCode: "USD", anchorAmount: 800, role: "contra" },
        ]),
        ledgerEntry("fund_transfer", [
          {
            account: seller,
            amount: -800,
            currencyCode: "USD",
            anchorAmount: 800,
            role: "primary",
          },
          { account: buyer, amount: 800, currencyCode: "USD", anchorAmount: -800, role: "contra" },
        ]),
      ],
      openingBalances: { [buyer]: 5000, [seller]: 1000 },
      closingBalances: { [buyer]: 4200, [seller]: 1800 },
    });
    expect(report.stockVsFlow.findings).toHaveLength(0);
    expect(report.stockVsFlow.status).toBe("green");
  });
});
