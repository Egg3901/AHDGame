import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  deriveLedgerEntries,
  fundMirrorAccount,
  type DerivableTx,
} from "@/lib/ledger/deriveFromTx";
import { reconcileLedger } from "@/lib/ledger/reconcile";
import { isRealAccount } from "@/lib/ledger/accounts";
import { isAnchorBalanced, nativeImbalance } from "@/lib/ledger/epsilon";
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

function ledgerEntry(
  txType: LedgerEntry["txType"],
  legs: LedgerEntry["legs"],
  emitSite = "test/tranche2"
): LedgerEntry {
  return {
    _id: new ObjectId(),
    turn: 5,
    createdAt: new Date("2026-07-06T00:00:00Z"),
    txType,
    legs,
    emitSite,
    balanced: true,
  };
}

const FUND_ID = new ObjectId().toString();
const fundMeta = { fundId: FUND_ID, fundCurrency: "USD", units: 10 };

describe("#992 tranche 2 — fund cash mirrors and transfer routing", () => {
  it("mirrors a subscribe row: holder contra at the fund plus a fund primary entry", () => {
    const entries = deriveLedgerEntries([
      tx({
        type: "index_fund_subscribe",
        amount: -1000,
        anchorAmount: -1000,
        meta: fundMeta,
      }),
    ]);
    expect(entries).toHaveLength(2);
    const [base, mirror] = entries;
    expect(base.legs[1].account).toBe(`fund:${FUND_ID}:USD`);
    expect(mirror.legs[0]).toMatchObject({ account: `fund:${FUND_ID}:USD`, role: "primary" });
    expect(mirror.legs[0].anchorAmount).toBe(1000);
    expect(mirror.legs[1].account).toBe(base.legs[0].account);
    for (const e of entries) {
      expect(isAnchorBalanced(e.legs)).toBe(true);
      expect(nativeImbalance(e.legs)).toBeNull();
      expect(e.legs.some((l) => l.account.startsWith("mint:"))).toBe(false);
      expect(e.legs.some((l) => l.account.startsWith("sink:"))).toBe(false);
    }
  });

  it("mirrors redeem and scheme-subscribe rows; never dividends or currency mismatches", () => {
    const redeem = deriveLedgerEntries([
      tx({ type: "index_fund_redeem", amount: 500, anchorAmount: 500, meta: fundMeta }),
    ]);
    expect(redeem).toHaveLength(2);
    expect(redeem[1].legs[0].anchorAmount).toBe(-500);

    const schemeId = new ObjectId();
    const schemeSub = deriveLedgerEntries([
      tx({
        type: "index_fund_subscribe",
        subjectType: "pension_scheme",
        subjectId: schemeId,
        amount: -2000,
        anchorAmount: -2000,
        meta: fundMeta,
      }),
    ]);
    expect(schemeSub).toHaveLength(2);
    expect(schemeSub[0].legs[0].account).toBe(`pension_scheme:${schemeId.toString()}:USD`);

    const mismatch = tx({
      type: "index_fund_subscribe",
      currencyCode: "GBP",
      meta: { fundId: FUND_ID, fundCurrency: "USD" },
    });
    expect(fundMirrorAccount(mismatch)).toBeNull();
    expect(deriveLedgerEntries([mismatch])).toHaveLength(1);

    const dividend = tx({
      type: "index_fund_dividend",
      amount: 250,
      anchorAmount: 250,
      meta: fundMeta,
    });
    expect(fundMirrorAccount(dividend)).toBeNull();
    expect(deriveLedgerEntries([dividend])).toHaveLength(1);
  });

  it("routes a national→state transfer pair as a two-sided transfer, not a mint", () => {
    const partyId = new ObjectId();
    const entries = deriveLedgerEntries([
      tx({
        type: "party_transfer",
        subjectType: "party",
        subjectId: partyId,
        amount: -400,
        anchorAmount: -400,
        meta: { partyId: partyId.toString(), statePartyKey: "CA_3", side: "national_outflow" },
      }),
      tx({
        type: "party_transfer",
        subjectType: "party",
        subjectId: undefined,
        amount: 400,
        anchorAmount: 400,
        meta: { partyId: partyId.toString(), statePartyKey: "CA_3", side: "state_inflow" },
      }),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0].legs[1].account).toBe("state_party:CA_3:USD");
    expect(entries[1].legs[0].account).toBe("state_party:CA_3:USD");
    expect(entries[1].legs[1].account).toBe(`party:${partyId.toString()}:USD`);
    for (const e of entries) {
      expect(isAnchorBalanced(e.legs)).toBe(true);
      expect(e.legs.some((l) => l.account.includes("unattributed"))).toBe(false);
    }
  });
});

describe("#992 tranche 2 — stock-vs-flow coverage and lifecycle hints", () => {
  it("stock-checks the newly listed kinds", () => {
    expect(isRealAccount("pension_scheme:x:USD")).toBe(true);
    expect(isRealAccount("state_party:CA_3:USD")).toBe(true);
    expect(isRealAccount("fund:x:USD")).toBe(true);
  });

  it("fully covered fund subscribe leaves no fund finding", () => {
    const holder = `character:${new ObjectId().toString()}:USD`;
    const fund = `fund:${FUND_ID}:USD`;
    const report = reconcileLedger({
      turn: 5,
      entries: [
        ledgerEntry("index_fund_subscribe", [
          {
            account: holder,
            amount: -1000,
            currencyCode: "USD",
            anchorAmount: -1000,
            role: "primary",
          },
          { account: fund, amount: 1000, currencyCode: "USD", anchorAmount: 1000, role: "contra" },
        ]),
        ledgerEntry("index_fund_subscribe", [
          {
            account: fund,
            amount: -1000,
            currencyCode: "USD",
            anchorAmount: 1000,
            role: "primary",
          },
          {
            account: holder,
            amount: 1000,
            currencyCode: "USD",
            anchorAmount: -1000,
            role: "contra",
          },
        ]),
      ],
      openingBalances: { [holder]: 5000, [fund]: 2000 },
      closingBalances: { [holder]: 4000, [fund]: 3000 },
    });
    expect(report.stockVsFlow.findings).toHaveLength(0);
    expect(report.stockVsFlow.status).toBe("green");
    expect(report.trialBalance.status).toBe("green");
    expect(report.moneySupply.status).toBe("green");
  });

  it("an uninstrumented fund inflow stays an honest uninstrumented amber finding", () => {
    const fund = `fund:${FUND_ID}:USD`;
    const report = reconcileLedger({
      turn: 5,
      entries: [],
      openingBalances: { [fund]: 2000 },
      closingBalances: { [fund]: 2750 },
    });
    expect(report.stockVsFlow.status).toBe("amber");
    expect(report.stockVsFlow.findings).toHaveLength(1);
    expect(report.stockVsFlow.findings[0]).toMatchObject({
      account: fund,
      actualDelta: 750,
      ledgerDelta: 0,
      uninstrumented: true,
    });
    expect(report.stockVsFlow.findings[0].lifecycleHint).toBeUndefined();
  });

  it("values anchor-native fund cash without forex repricing drift", () => {
    const fund = `fund:${FUND_ID}:USD`;
    const report = reconcileLedger({
      turn: 5,
      entries: [],
      openingBalances: { [fund]: 2000 },
      closingBalances: { [fund]: 2000 },
      preForexBalances: { [fund]: 2000 },
      openingAnchorRates: { USD: 1 },
      preForexAnchorRates: { USD: 107 },
      closingAnchorRates: { USD: 107 },
    });
    expect(report.stockVsFlow.findings).toHaveLength(0);
  });

  it("hints created, closed, and currency_rekey lifecycles without reconciling them", () => {
    const report = reconcileLedger({
      turn: 5,
      entries: [],
      openingBalances: { "state_party:OLD_3:USD": 900, "state_party:GONE_1:USD": 100 },
      closingBalances: { "state_party:OLD_3:EUR": 900, "state_party:NEW_9:USD": 400 },
    });
    const byAccount = new Map(report.stockVsFlow.findings.map((f) => [f.account, f]));
    // Same ref under a new currency: conversion evidence on both sides.
    expect(byAccount.get("state_party:OLD_3:EUR")?.lifecycleHint).toBe("currency_rekey");
    expect(byAccount.get("state_party:OLD_3:USD")?.lifecycleHint).toBe("currency_rekey");
    // Brand-new key: creation; vanished key: closure.
    expect(byAccount.get("state_party:NEW_9:USD")?.lifecycleHint).toBe("created");
    expect(byAccount.get("state_party:GONE_1:USD")?.lifecycleHint).toBe("closed");
    // Hints never suppress: all four still diverge.
    expect(report.stockVsFlow.divergentCount).toBe(4);
    expect(report.stockVsFlow.status).toBe("amber");
  });
});
