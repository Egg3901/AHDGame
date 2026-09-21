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

  it("never mirrors a fund-subject holder row: the fund side is already booked", () => {
    // The charter seed receipt is emitted as its own fund-subject row. If the
    // mirror fired on it, the mirror primary (-seed) would cancel the base
    // primary (+seed) and the fund delta would vanish from the ledger.
    const entries = deriveLedgerEntries([
      tx({
        type: "corp_capital_seed",
        subjectType: "fund",
        subjectId: new ObjectId(FUND_ID),
        amount: 10000,
        anchorAmount: 10000,
        meta: { kind: "fund_charter_seed", fundId: FUND_ID, fundCurrency: "USD" },
      }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].legs[0].account).toBe(`fund:${FUND_ID}:USD`);
    expect(entries[0].legs[1].account).toBe("mint:seed_capital:USD");
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

describe("#992 tranche 3b — fee, charter, and dissolution paths", () => {
  const SPONSOR = new ObjectId().toString();
  const corp = `corporation:${SPONSOR}:USD`;
  const fund = `fund:${FUND_ID}:USD`;
  const gov = `government:US:USD`;

  it("attributes seed capital instead of backloging it", () => {
    expect(reasonForTxType("corp_capital_seed")).toBe("seed_capital");
  });

  it("leaves a fee row single-sided when the fund currency mismatches", () => {
    const entries = deriveLedgerEntries([
      tx({
        type: "corp_revenue",
        subjectType: "corporation",
        amount: 120,
        anchorAmount: 120,
        currencyCode: "USD",
        meta: { kind: "fund_expense_fee", fundId: FUND_ID, fundCurrency: "GBP" },
      }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].legs[1].account).toBe("mint:sector_revenue:USD");
  });

  it("reconciles a sponsor fee as a corp-to-fund transfer with no mint or sink", () => {
    const feeTx = tx({
      type: "corp_revenue",
      subjectType: "corporation",
      subjectId: new ObjectId(SPONSOR),
      amount: 120,
      anchorAmount: 120,
      meta: { kind: "fund_expense_fee", fundId: FUND_ID, fundCurrency: "USD" },
    });
    const report = reconcileLedger({
      turn: 5,
      entries: deriveLedgerEntries([feeTx]).map((e) =>
        ledgerEntry(
          feeTx.type,
          e.legs.map((l) => ({ ...l }))
        )
      ),
      openingBalances: { [corp]: 5000, [fund]: 2000 },
      closingBalances: { [corp]: 5120, [fund]: 1880 },
    });
    expect(report.stockVsFlow.findings).toHaveLength(0);
    expect(report.stockVsFlow.status).toBe("green");
    expect(report.moneySupply.status).toBe("green");
  });

  it("reconciles a charter as corp debit, fund seed receipt, and treasury fee", () => {
    const seed = 10000;
    const fee = 250;
    const total = seed + fee;
    const debit = tx({
      type: "corp_capital_seed",
      subjectType: "corporation",
      subjectId: new ObjectId(SPONSOR),
      amount: -total,
      anchorAmount: -total,
      meta: { kind: "fund_charter", fundId: FUND_ID, tickerSymbol: "NIT" },
    });
    const receipt = tx({
      type: "corp_capital_seed",
      subjectType: "fund",
      subjectId: new ObjectId(FUND_ID),
      amount: seed,
      anchorAmount: seed,
      meta: { kind: "fund_charter_seed", fundId: FUND_ID, fundCurrency: "USD" },
    });
    const treasury = tx({
      type: "gov_tax_revenue",
      subjectType: "government",
      countryId: "US",
      amount: fee,
      anchorAmount: fee,
      counterpartyType: "corporation",
      counterpartyId: new ObjectId(SPONSOR),
      meta: { kind: "fund_charter", side: "charter_fee", fundId: FUND_ID },
    });
    const derived = deriveLedgerEntries([debit, receipt, treasury]);
    // Debit (corp), receipt (fund), treasury receipt (gov): no mirrors, because
    // the corp rows carry no fundCurrency and the fund row is already the fund.
    expect(derived).toHaveLength(3);
    const contraAccounts = derived.map((e) => e.legs[1].account).sort();
    expect(contraAccounts).toEqual([
      `corporation:${SPONSOR}:USD`,
      "mint:seed_capital:USD",
      "sink:seed_capital:USD",
    ]);
    const report = reconcileLedger({
      turn: 5,
      entries: derived.map((e) =>
        ledgerEntry(
          "corp_capital_seed",
          e.legs.map((l) => ({ ...l }))
        )
      ),
      openingBalances: { [corp]: 100000, [fund]: 0, [gov]: 50000 },
      closingBalances: { [corp]: 100000 - total, [fund]: seed, [gov]: 50000 + fee },
    });
    expect(report.stockVsFlow.findings).toHaveLength(0);
    expect(report.stockVsFlow.status).toBe("green");
    expect(report.trialBalance.status).toBe("green");
  });

  it("derives a dissolution fund payout as a two-sided transfer, never a mint", () => {
    const payout = tx({
      type: "corp_dissolution_distribution",
      subjectType: "fund",
      subjectId: new ObjectId(FUND_ID),
      amount: 5000,
      anchorAmount: 5000,
      counterpartyType: "corporation",
      counterpartyId: new ObjectId(SELLER_ID),
      meta: { side: "fund_shareholder", fundId: FUND_ID, fundCurrency: "USD", shares: 100 },
    });
    const entries = deriveLedgerEntries([payout]);
    expect(entries).toHaveLength(1);
    expect(entries[0].legs[0].account).toBe(fund);
    expect(entries[0].legs[1].account).toBe(`corporation:${SELLER_ID}:USD`);
    for (const e of entries) {
      expect(e.legs.some((l) => l.account.startsWith("mint:"))).toBe(false);
      expect(e.legs.some((l) => l.account.startsWith("sink:"))).toBe(false);
      expect(isAnchorBalanced(e.legs)).toBe(true);
    }
    const report = reconcileLedger({
      turn: 5,
      entries: [
        ledgerEntry(
          "corp_dissolution_distribution",
          entries[0].legs.map((l) => ({ ...l }))
        ),
      ],
      openingBalances: { [fund]: 2000 },
      closingBalances: { [fund]: 7000 },
    });
    expect(report.stockVsFlow.findings).toHaveLength(0);
    expect(report.stockVsFlow.status).toBe("green");
  });

  it("derives a nationalization fund payout under the buyout type", () => {
    const payout = tx({
      type: "share_buyout_payout",
      subjectType: "fund",
      subjectId: new ObjectId(FUND_ID),
      amount: 3200,
      anchorAmount: 3200,
      counterpartyType: "corporation",
      counterpartyId: new ObjectId(SELLER_ID),
      meta: {
        kind: "agreed_acquisition",
        side: "fund_shareholder",
        fundId: FUND_ID,
        fundCurrency: "USD",
      },
    });
    const entries = deriveLedgerEntries([payout]);
    expect(entries).toHaveLength(1);
    expect(entries[0].legs).toMatchObject([
      { account: fund, role: "primary" },
      { account: `corporation:${SELLER_ID}:USD`, role: "contra" },
    ]);
    const report = reconcileLedger({
      turn: 5,
      entries: [
        ledgerEntry(
          "share_buyout_payout",
          entries[0].legs.map((l) => ({ ...l }))
        ),
      ],
      openingBalances: { [fund]: 2000 },
      closingBalances: { [fund]: 5200 },
    });
    expect(report.stockVsFlow.findings).toHaveLength(0);
    expect(report.stockVsFlow.status).toBe("green");
  });
});
