import { describe, expect, it } from "vitest";
import {
  accountFromLegacy,
  bankLiabilityProjection,
  centralBankPoolProjection,
  legacyProjection,
  reconcileAccounts,
  type SavingsAccountSnapshot,
} from "./accounts";

const BANK = "a".repeat(24);
const OTHER_BANK = "b".repeat(24);

function account(over: Partial<SavingsAccountSnapshot>): SavingsAccountSnapshot {
  return {
    id: "1".repeat(24),
    ownerType: "character",
    ownerId: "c".repeat(24),
    currency: "USD",
    balance: 1_000,
    holder: "centralBank",
    status: "open",
    version: 0,
    accruedInterest: 0,
    interestEarned: 0,
    openedTurn: 1,
    ...over,
  };
}

describe("projections", () => {
  const accounts = [
    account({ id: "1", ownerId: "p1", holder: BANK, balance: 500 }),
    account({ id: "2", ownerId: "p2", holder: BANK, balance: 250 }),
    account({ id: "3", ownerId: "p3", holder: OTHER_BANK, balance: 100 }),
    account({ id: "4", ownerId: "p4", holder: "centralBank", balance: 900 }),
    account({ id: "5", ownerId: "p5", holder: BANK, balance: 0, status: "closed" }),
    account({ id: "6", ownerId: "p6", holder: BANK, balance: 70, currency: "GBP" }),
  ];

  it("sums bank liabilities per holder for one currency, ignoring closed and other currencies", () => {
    const usd = bankLiabilityProjection(accounts, "USD");
    expect(usd.get(BANK)).toEqual({ balance: 750, accounts: 2 });
    expect(usd.get(OTHER_BANK)).toEqual({ balance: 100, accounts: 1 });
    expect(usd.has("centralBank")).toBe(false);
    expect(bankLiabilityProjection(accounts, "GBP").get(BANK)).toEqual({
      balance: 70,
      accounts: 1,
    });
  });

  it("sums the central bank pool per currency", () => {
    const pool = centralBankPoolProjection(accounts);
    expect(pool.get("USD")).toBe(900);
    expect(pool.has("GBP")).toBe(false);
  });

  it("projects the legacy character fields from the account", () => {
    expect(
      legacyProjection(
        account({ balance: 12.5, holder: BANK, accruedInterest: 0.4, interestEarned: 3 })
      )
    ).toEqual({
      savings: 12.5,
      savingsHolder: BANK,
      pendingSavingsInterest: 0.4,
      interestEarned: 3,
    });
  });
});

describe("reconcileAccounts", () => {
  it("is clean when every row has one matching account", () => {
    const accounts = [account({ ownerId: "p1", balance: 100, holder: BANK, accruedInterest: 1 })];
    const legacy = [
      {
        ownerId: "p1",
        currency: "USD",
        savings: 100,
        savingsHolder: BANK,
        pendingSavingsInterest: 1,
      },
    ];
    expect(reconcileAccounts(accounts, legacy)).toEqual([]);
  });

  it("flags duplicates, mismatches, missing accounts and missing rows", () => {
    const accounts = [
      account({ id: "a", ownerId: "p1", balance: 100 }),
      account({ id: "b", ownerId: "p1", balance: 100 }),
      account({ id: "c", ownerId: "p2", balance: 50, holder: BANK }),
      account({ id: "d", ownerId: "p3", balance: 5 }),
      account({ id: "e", ownerId: "p5", balance: -1 }),
    ];
    const legacy = [
      { ownerId: "p1", currency: "USD", savings: 100 },
      { ownerId: "p2", currency: "USD", savings: 49, savingsHolder: "centralBank" as const },
      { ownerId: "p4", currency: "USD", savings: 10 },
      { ownerId: "p6", currency: "USD", savings: 0 },
    ];
    const kinds = reconcileAccounts(accounts, legacy).map((d) => [d.key.split(":")[1], d.kind]);
    expect(kinds).toEqual(
      expect.arrayContaining([
        ["p1", "duplicate_account"],
        ["p2", "balance_mismatch"],
        ["p2", "holder_mismatch"],
        ["p4", "missing_account"],
        ["p3", "missing_legacy"],
        ["p5", "negative_balance"],
      ])
    );
    // An empty, unopened legacy row is not an account and is not reported.
    expect(kinds.some(([owner]) => owner === "p6")).toBe(false);
  });

  it("treats a null legacy holder as the central bank", () => {
    const accounts = [account({ ownerId: "p1", balance: 1 })];
    expect(
      reconcileAccounts(accounts, [
        { ownerId: "p1", currency: "USD", savings: 1, savingsHolder: null },
      ])
    ).toEqual([]);
  });

  it("builds an account from a legacy row with the central bank as the default holder", () => {
    const built = accountFromLegacy(
      {
        ownerId: "p9",
        currency: "JPY",
        savings: 3,
        pendingSavingsInterest: 0.5,
        interestEarned: 2,
      },
      "character",
      77,
      "id9"
    );
    expect(built).toMatchObject({
      id: "id9",
      ownerType: "character",
      ownerId: "p9",
      currency: "JPY",
      balance: 3,
      holder: "centralBank",
      status: "open",
      version: 0,
      accruedInterest: 0.5,
      interestEarned: 2,
      openedTurn: 77,
    });
  });
});
