import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { reconcileLedger } from "@/lib/ledger/reconcile";
import { finalizeLedgerEntry } from "@/lib/ledger/emit";
import type { LedgerEntry, LedgerEntryInput } from "@/lib/ledger/types";

function entry(input: Omit<LedgerEntryInput, "turn" | "createdAt">): LedgerEntry {
  return finalizeLedgerEntry({ turn: 10, createdAt: new Date(), ...input });
}

describe("reconcileLedger", () => {
  it("is green on a clean, fully-balanced, fully-instrumented turn", () => {
    const donor = new ObjectId().toString();
    const recipient = new ObjectId().toString();
    const entries: LedgerEntry[] = [
      // Two-sided transfer of ₳100 donor -> recipient (two tx rows -> two entries).
      entry({
        txType: "wire_transfer_out",
        emitSite: "test",
        legs: [
          {
            account: `character:${donor}:USD`,
            amount: -100,
            currencyCode: "USD",
            anchorAmount: -100,
            role: "primary",
          },
          {
            account: `character:${recipient}:USD`,
            amount: 100,
            currencyCode: "USD",
            anchorAmount: 100,
            role: "contra",
          },
        ],
      }),
      entry({
        txType: "wire_transfer_in",
        emitSite: "test",
        legs: [
          {
            account: `character:${recipient}:USD`,
            amount: 100,
            currencyCode: "USD",
            anchorAmount: 100,
            role: "primary",
          },
          {
            account: `character:${donor}:USD`,
            amount: -100,
            currencyCode: "USD",
            anchorAmount: -100,
            role: "contra",
          },
        ],
      }),
    ];
    const report = reconcileLedger({
      turn: 10,
      entries,
      openingBalances: { [`character:${donor}:USD`]: 1000, [`character:${recipient}:USD`]: 1000 },
      closingBalances: { [`character:${donor}:USD`]: 900, [`character:${recipient}:USD`]: 1100 },
    });
    expect(report.status).toBe("green");
    expect(report.trialBalance.unbalancedCount).toBe(0);
    expect(report.stockVsFlow.divergentCount).toBe(0);
  });

  // --- DELIBERATE-CORRUPTION REGRESSION TEST (t841 bug class) ----------------
  it("flags an unbalanced write (credit with no debit) AND a raw-foreign-as-local write", () => {
    const victim = new ObjectId().toString();
    const other = new ObjectId().toString();

    // Corruption 1: a credit with no offsetting debit — the phantom-credit class.
    const phantomCredit = entry({
      txType: "admin_transfer",
      emitSite: "corruption/phantom-credit",
      legs: [
        {
          account: `character:${other}:GBP`,
          amount: 500,
          currencyCode: "GBP",
          anchorAmount: 500,
          role: "primary",
        },
      ],
    });

    // Corruption 2: raw-foreign-as-local (t841). The ledger records a ₳1000
    // credit to the GBP wallet, but the actual money landed in the NGN wallet
    // as a raw foreign amount — GBP balance never moved; NGN moved with no legs.
    const rawForeign = entry({
      txType: "corp_revenue",
      emitSite: "corruption/nationalization",
      legs: [
        {
          account: `character:${victim}:GBP`,
          amount: 1000,
          currencyCode: "GBP",
          anchorAmount: 1000,
          role: "primary",
        },
        {
          account: "mint:unattributed:GBP",
          amount: -1000,
          currencyCode: "GBP",
          anchorAmount: -1000,
          role: "contra",
        },
      ],
    });

    const report = reconcileLedger({
      turn: 10,
      entries: [phantomCredit, rawForeign],
      openingBalances: { [`character:${victim}:GBP`]: 0, [`character:${victim}:NGN`]: 0 },
      // GBP wallet did NOT move; NGN wallet gained the raw 1000 with no ledger legs.
      closingBalances: { [`character:${victim}:GBP`]: 0, [`character:${victim}:NGN`]: 1000 },
    });

    // (1) The unbalanced entry is caught by the trial-balance check → CRITICAL/red.
    expect(report.trialBalance.status).toBe("red");
    expect(report.trialBalance.unbalancedCount).toBe(1);
    expect(report.trialBalance.findings[0].emitSite).toBe("corruption/phantom-credit");
    expect(Math.abs(report.trialBalance.findings[0].anchorResidual)).toBeCloseTo(500);

    // (2) The raw-foreign write shows up in stock-vs-flow on BOTH accounts:
    //     GBP: ledger says +1000 but balance didn't move;
    //     NGN: balance moved +1000 with no ledger legs (uninstrumented).
    const gbp = report.stockVsFlow.findings.find((f) => f.account === `character:${victim}:GBP`);
    const ngn = report.stockVsFlow.findings.find((f) => f.account === `character:${victim}:NGN`);
    expect(gbp).toBeDefined();
    expect(gbp!.ledgerDelta).toBeCloseTo(1000);
    expect(gbp!.actualDelta).toBeCloseTo(0);
    expect(ngn).toBeDefined();
    expect(ngn!.uninstrumented).toBe(true);
    expect(ngn!.actualDelta).toBeCloseTo(1000);

    expect(report.status).toBe("red");
  });

  it("catches a same-currency entry that doesn't net to zero natively (FX mismatch)", () => {
    // Legs balance in ₳ but not in native units — the signature of a wrong-rate
    // conversion stored as though same-currency.
    const bad = entry({
      txType: "forex_trade",
      emitSite: "corruption/fx",
      legs: [
        {
          account: "character:a:GBP",
          amount: 1000,
          currencyCode: "GBP",
          anchorAmount: 1000,
          role: "primary",
        },
        {
          account: "sink:unattributed:GBP",
          amount: -1200,
          currencyCode: "GBP",
          anchorAmount: -1000,
          role: "contra",
        },
      ],
    });
    const report = reconcileLedger({
      turn: 10,
      entries: [bad],
      openingBalances: {},
      closingBalances: {},
      skipStockVsFlow: true,
    });
    expect(report.trialBalance.status).toBe("red");
    expect(report.trialBalance.findings[0].nativeResidual).toBeCloseTo(-200);
  });

  it("reports unattributed mint/sink drift as the Phase 3 backlog, ranked by anchor", () => {
    const entries: LedgerEntry[] = [
      entry({
        txType: "corp_revenue",
        emitSite: "sectorRevenue",
        legs: [
          {
            account: "corporation:a:USD",
            amount: 5000,
            currencyCode: "USD",
            anchorAmount: 5000,
            role: "primary",
          },
          {
            account: "mint:unattributed:USD",
            amount: -5000,
            currencyCode: "USD",
            anchorAmount: -5000,
            role: "contra",
          },
        ],
      }),
      entry({
        txType: "savings_interest",
        emitSite: "savingsInterest",
        legs: [
          {
            account: "character:b:USD",
            amount: 200,
            currencyCode: "USD",
            anchorAmount: 200,
            role: "primary",
          },
          {
            account: "mint:unattributed:USD",
            amount: -200,
            currencyCode: "USD",
            anchorAmount: -200,
            role: "contra",
          },
        ],
      }),
    ];
    const report = reconcileLedger({
      turn: 10,
      entries,
      openingBalances: {},
      closingBalances: {},
      skipStockVsFlow: true,
    });
    expect(report.moneySupply.findings[0].currencyCode).toBe("USD");
    expect(report.moneySupply.findings[0].minted).toBeCloseTo(5200);
    expect(report.moneySupply.status).toBe("amber");
    expect(report.unattributed[0].emitSite).toBe("sectorRevenue"); // ranked by |anchor|
    expect(report.unattributed[0].anchorAmount).toBeCloseTo(5000);
  });

  it("reports attributed net money creation without calling it a reconciliation failure", () => {
    const entries: LedgerEntry[] = [
      entry({
        txType: "corp_revenue",
        emitSite: "sectorRevenue",
        legs: [
          {
            account: "corporation:a:USD",
            amount: 5000,
            currencyCode: "USD",
            anchorAmount: 5000,
            role: "primary",
          },
          {
            account: "mint:sector_revenue:USD",
            amount: -5000,
            currencyCode: "USD",
            anchorAmount: -5000,
            role: "contra",
          },
        ],
      }),
    ];
    const report = reconcileLedger({
      turn: 10,
      entries,
      openingBalances: { "corporation:a:USD": 10_000 },
      closingBalances: { "corporation:a:USD": 15_000 },
    });

    expect(report.moneySupply.findings[0].netDrift).toBe(5000);
    expect(report.moneySupply.status).toBe("green");
    expect(report.status).toBe("green");
  });

  it("skips stock-vs-flow when told to (reset/reseed epoch)", () => {
    const report = reconcileLedger({
      turn: 10,
      entries: [],
      openingBalances: { "character:a:USD": 100 },
      closingBalances: { "character:a:USD": 999999 },
      skipStockVsFlow: true,
    });
    expect(report.stockVsFlow.skipped).toBe(true);
    expect(report.stockVsFlow.divergentCount).toBe(0);
  });
});
