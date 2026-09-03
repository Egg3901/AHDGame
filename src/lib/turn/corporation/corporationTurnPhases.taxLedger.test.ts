import { describe, expect, it, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { CorporationLookups, CorpSnapshot } from "./types";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";

/**
 * Ticket #1260 regression: corporate tax was booked TWICE on a corp's own ledger.
 *
 * `CorpSnapshot.income` is already net of corporate tax — the chain is
 * `incomePreDividends − tax − dividends = income` (verified against live
 * turn-581 history rows). `emitCorporationTurnTx` credited `corp_revenue` at
 * that already-net figure and then emitted `corp_tax_paid` for the FULL tax on
 * top, so the corp's rows netted to `income − tax` instead of `income`.
 *
 * On live Value Mart (IT, #80) that reported −₤1.9M/turn for a corp whose cash
 * actually moved +₤70, and 154 of 305 NPP corps plus 24 of 47 player-run corps
 * read as loss-making on turns they in fact earned money. It is a reporting
 * fault only — these rows carry no `balanceAfter` and move no cash — but it
 * corrupts `financialTxLog`, every admin cash-forensics view built on it, and
 * the `corp_tax_paid ↔ gov_tax_revenue` money-supply reconciliation in
 * `deriveFromTx`.
 *
 * The corp side of this phase emits ONLY `corp_revenue` and `corp_tax_paid`
 * (`corp_salary` / `corp_dividend` are character-side credits with no corp-side
 * debit), so those two rows must net to the cash the corp actually keeps.
 */

const emitTxBulk = vi.fn();
vi.mock("@/lib/financialTxLog/emit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/financialTxLog/emit")>();
  return { ...actual, emitTxBulk: (...args: unknown[]) => emitTxBulk(...args) };
});

const CORP_ID = new ObjectId();

function makeSnapshot(overrides: Partial<CorpSnapshot> = {}): CorpSnapshot {
  return {
    corpId: CORP_ID,
    revenue: 500,
    totalCosts: 300,
    incomePreDividends: 200,
    income: 80,
    federalTaxPaid: 100,
    stateTaxPaid: 20,
    taxPaidByCountry: new Map([["IT", 100]]),
    taxPaidByState: new Map([["IT_LAZ", 20]]),
    taxPaidByCountryDomestic: new Map([["IT", 100]]),
    taxPaidByCountryForeign: new Map(),
    taxPaidByStateDomestic: new Map([["IT_LAZ", 20]]),
    taxPaidByStateForeign: new Map(),
    dividendPaidPerTurn: 0,
    escrowFundingMove: 0,
    escrowBalanceAfter: 0,
    ...overrides,
  } as unknown as CorpSnapshot;
}

function makeLookups(currencyCode: string, fxRate: number): CorporationLookups {
  return {
    corpById: new Map([
      [
        CORP_ID.toString(),
        { _id: CORP_ID, name: "Value Mart", countryId: "IT", liquidCurrencyCode: currencyCode },
      ],
    ]),
    exchangeRatesByCurrency: new Map([[currencyCode, fxRate]]),
  } as unknown as CorporationLookups;
}

/** The rows this phase writes against the corporation itself. */
function corpRows(): FinancialTxLogEntry[] {
  const entries = (emitTxBulk.mock.calls[0]?.[1] ?? []) as FinancialTxLogEntry[];
  return entries.filter((e) => e.subjectId?.toString() === CORP_ID.toString());
}

describe("emitCorporationTurnTx — corporate tax is booked once (ticket #1260)", () => {
  let db: MockDb;

  beforeEach(() => {
    emitTxBulk.mockClear();
    db = createMockDb();
  });

  async function run(currencyCode: string, fxRate: number, snapshot = makeSnapshot()) {
    const { emitCorporationTurnTx } = await import("./corporationTurnPhases");
    await emitCorporationTurnTx({
      db: db as unknown as Db,
      lookups: makeLookups(currencyCode, fxRate),
      corpSnapshots: [snapshot],
      ceoSalaryPayments: new Map(),
      dividendPayments: new Map(),
      dividendTaxPaidByCountry: new Map(),
      turn: 581,
      now: new Date("2026-09-02T22:00:00Z"),
      thresholds: {} as never,
    });
  }

  it("nets corp_revenue against corp_tax_paid to the cash the corp actually keeps", async () => {
    await run("USD", 1);

    const rows = corpRows();
    const revenue = rows.find((r) => r.type === "corp_revenue");
    const tax = rows.find((r) => r.type === "corp_tax_paid");

    expect(revenue, "a profitable corp should get a corp_revenue row").toBeDefined();
    expect(tax, "a taxpaying corp should get a corp_tax_paid row").toBeDefined();

    // income (80) is ALREADY net of the 120 of tax. The credit must therefore be
    // the PRE-tax 200 so that 200 − 120 = the 80 the corp truly retained.
    expect(revenue!.amount).toBe(200);
    expect(tax!.amount).toBe(-120);
    expect(revenue!.amount + tax!.amount).toBe(80);
  });

  it("does not report a profitable corp as loss-making when tax exceeds net income", async () => {
    // Value Mart's live shape: tax (120) is larger than the post-tax income (80),
    // so the pre-fix ledger showed a negative net on a genuinely profitable turn.
    await run("ITL", 639.12);

    const rows = corpRows();
    const net = rows
      .filter((r) => r.type === "corp_revenue" || r.type === "corp_tax_paid")
      .reduce((sum, r) => sum + r.amount, 0);

    expect(net).toBeGreaterThan(0);
    expect(net).toBe(Math.round(200 * 639.12) - Math.round(120 * 639.12));
  });

  it("still emits a credit when tax wipes out the whole post-tax income", async () => {
    // income == 0 with tax outstanding: pre-fix the `income > 0` gate suppressed
    // the credit entirely and left a lone tax debit, understating cash by the tax.
    await run("USD", 1, makeSnapshot({ incomePreDividends: 120, income: 0 }));

    const rows = corpRows();
    const revenue = rows.find((r) => r.type === "corp_revenue");
    const tax = rows.find((r) => r.type === "corp_tax_paid");

    expect(revenue?.amount).toBe(120);
    expect(tax?.amount).toBe(-120);
    expect((revenue?.amount ?? 0) + (tax?.amount ?? 0)).toBe(0);
  });

  it("leaves a genuinely loss-making, untaxed corp with no revenue row", async () => {
    await run(
      "USD",
      1,
      makeSnapshot({
        incomePreDividends: -50,
        income: -50,
        federalTaxPaid: 0,
        stateTaxPaid: 0,
        taxPaidByCountry: new Map(),
        taxPaidByState: new Map(),
        taxPaidByCountryDomestic: new Map(),
        taxPaidByStateDomestic: new Map(),
      })
    );

    const rows = corpRows();
    expect(rows.find((r) => r.type === "corp_revenue")).toBeUndefined();
    expect(rows.find((r) => r.type === "corp_tax_paid")).toBeUndefined();
  });
});
