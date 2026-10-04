import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { LiveSuccessionFinances } from "./loadLiveFinances";
import {
  loadLiveSuccessionAccountingSnapshot,
  loadSuccessionExchangeRates,
  normalizeSuccessionFinances,
} from "./normalizeLiveFinances";

const finances: LiveSuccessionFinances = {
  budgetId: "RU",
  treasuryBalanceLocal: 400,
  budgetCurrencyCode: "RUB",
  reportedDebtPrincipalLocal: 300,
  activeBondPrincipalByCurrency: { RUB: 300 },
  creditorContracts: [
    {
      bondId: "bond-1",
      currencyCode: "RUB",
      totalIssued: 300,
      outstandingPrincipal: 300,
      maturityTurn: 240,
      matured: false,
      defaulted: false,
    },
  ],
};

describe("federation finance accounting snapshot", () => {
  it("converts cash and bond debt separately without counting budget principal twice", () => {
    expect(normalizeSuccessionFinances(finances, { RUB: 4 })).toMatchObject({
      signedCashMinor: 10_000,
      financialAssetsMinor: 10_000,
      cashDeficitMinor: 0,
      creditorDebtMinor: 7500,
      reportedDebtMinor: 7500,
      creditorPrincipalByBondMinor: { "bond-1": 7500 },
    });
  });

  it("keeps a negative treasury separate from creditor contracts", () => {
    const result = normalizeSuccessionFinances(
      { ...finances, treasuryBalanceLocal: -40 },
      { RUB: 4 }
    );
    expect(result.financialAssetsMinor).toBe(0);
    expect(result.cashDeficitMinor).toBe(1000);
    expect(result.creditorDebtMinor).toBe(7500);
  });

  it("preserves each foreign bond denomination in the shared unit", () => {
    const result = normalizeSuccessionFinances(
      {
        ...finances,
        creditorContracts: [
          finances.creditorContracts[0],
          {
            ...finances.creditorContracts[0],
            bondId: "bond-2",
            currencyCode: "USD",
            outstandingPrincipal: 50,
          },
        ],
      },
      { RUB: 4, USD: 2 }
    );
    expect(result.creditorPrincipalByBondMinor).toEqual({ "bond-1": 7500, "bond-2": 2500 });
    expect(result.creditorDebtMinor).toBe(10_000);
  });

  it("rejects missing rates and same-currency budget/bond mismatches", () => {
    expect(() => normalizeSuccessionFinances(finances, {})).toThrow("Missing prevailing");
    expect(() =>
      normalizeSuccessionFinances({ ...finances, reportedDebtPrincipalLocal: 100 }, { RUB: 4 })
    ).toThrow("disagrees");
  });

  it("loads a unique prevailing rate and rejects missing or conflicting rows", async () => {
    const mem = createInMemoryDb();
    const db = mem as unknown as Db;
    mem.seed("exchangeRates", [{ _id: "RU", currencyCode: "RUB", rate: 4 }]);
    expect(await loadSuccessionExchangeRates(db, finances)).toEqual({ RUB: 4 });
    mem.seed("exchangeRates", [
      { _id: "RU", currencyCode: "RUB", rate: 4 },
      { _id: "BY", currencyCode: "RUB", rate: 5 },
    ]);
    await expect(loadSuccessionExchangeRates(db, finances)).rejects.toThrow("conflicting rates");
  });

  it("reads one live budget, actual creditor bonds and prevailing rates together", async () => {
    const mem = createInMemoryDb();
    mem.seed("federalBudget", [
      {
        _id: "RU",
        countryId: "RU",
        treasuryBalance: 400,
        currencyCode: "RUB",
        debt: { principal: 300 },
      },
    ]);
    mem.seed("bonds", [
      {
        _id: new ObjectId("000000000000000000000111"),
        issuerType: "sovereign",
        countryId: "RU",
        currencyCode: "RUB",
        totalIssued: 300,
        maturityTurn: 240,
        matured: false,
        defaulted: false,
      },
    ]);
    mem.seed("exchangeRates", [{ _id: "RU", currencyCode: "RUB", rate: 4 }]);
    const result = await loadLiveSuccessionAccountingSnapshot(mem as unknown as Db, "RU");
    expect(result).toMatchObject({ financialAssetsMinor: 10_000, creditorDebtMinor: 7500 });
  });
});
