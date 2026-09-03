import { describe, expect, it } from "vitest";
import {
  BANKING_INVARIANTS,
  checkBalancedTransfer,
  checkBankAccountingIdentity,
  checkExactlyOnce,
  checkGuardedDebits,
  checkJurisdictionOwnership,
  checkOneAuthoritativeBalance,
  evaluateBankingInvariants,
  legsNet,
} from "./invariants";

describe("banking invariant catalog", () => {
  it("names every invariant once, with an owner", () => {
    const ids = BANKING_INVARIANTS.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "balanced_transfer",
      "guarded_debit",
      "one_authoritative_balance",
      "bank_accounting_identity",
      "exactly_once",
      "jurisdiction_ownership",
    ]);
    for (const row of BANKING_INVARIANTS) {
      expect(row.statement.length).toBeGreaterThan(20);
      expect(["settlement", "accounts", "rules", "governance"]).toContain(row.owner);
    }
  });
});

describe("balanced_transfer", () => {
  it.each([
    [
      "debit and credit",
      [
        { kind: "debit", amount: 10 },
        { kind: "credit", amount: 10 },
      ],
      0,
    ],
    [
      "mint and credit",
      [
        { kind: "mint", amount: 5 },
        { kind: "credit", amount: 5 },
      ],
      0,
    ],
    [
      "debit and burn",
      [
        { kind: "debit", amount: 7 },
        { kind: "burn", amount: 7 },
      ],
      0,
    ],
    [
      "unbalanced",
      [
        { kind: "debit", amount: 10 },
        { kind: "credit", amount: 9 },
      ],
      -1,
    ],
  ] as const)("%s nets to %d", (_label, legs, net) => {
    expect(legsNet(legs)).toBeCloseTo(net, 9);
  });

  it("accepts a balanced transfer", () => {
    expect(
      checkBalancedTransfer([
        { kind: "debit", amount: 100, account: "a" },
        { kind: "credit", amount: 60, account: "b" },
        { kind: "credit", amount: 40, account: "c" },
      ])
    ).toEqual([]);
  });

  it("rejects money created between two correct writes", () => {
    const violations = checkBalancedTransfer(
      [
        { kind: "credit", amount: 100, account: "pool" },
        { kind: "credit", amount: 100, account: "vault" },
      ],
      "deposit-book-return"
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      invariant: "balanced_transfer",
      subject: "deposit-book-return",
    });
  });

  it("rejects negative and non-finite amounts even when they net to zero", () => {
    const violations = checkBalancedTransfer([
      { kind: "debit", amount: -5 },
      { kind: "credit", amount: -5 },
    ]);
    expect(violations.map((v) => v.invariant)).toEqual(["balanced_transfer", "balanced_transfer"]);
    expect(checkBalancedTransfer([{ kind: "mint", amount: Number.NaN }])).not.toEqual([]);
  });
});

describe("guarded_debit", () => {
  const balances = { vault: 100, wallet: 20 };

  it("accepts a debit the balance covers", () => {
    expect(
      checkGuardedDebits(balances, [
        { kind: "debit", amount: 100, account: "vault" },
        { kind: "credit", amount: 100, account: "wallet" },
      ])
    ).toEqual([]);
  });

  it("rejects a debit that would overdraw", () => {
    const violations = checkGuardedDebits(balances, [
      { kind: "debit", amount: 21, account: "wallet" },
      { kind: "credit", amount: 21, account: "vault" },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].subject).toBe("wallet");
  });

  it("checks debits against the same account cumulatively", () => {
    const violations = checkGuardedDebits(balances, [
      { kind: "debit", amount: 60, account: "vault" },
      { kind: "debit", amount: 60, account: "vault" },
      { kind: "credit", amount: 120, account: "wallet" },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].detail).toContain("would leave");
  });

  it("refuses a debit against an unknown balance rather than assuming zero is fine", () => {
    const violations = checkGuardedDebits(balances, [
      { kind: "debit", amount: 1, account: "ghost" },
      { kind: "credit", amount: 1, account: "vault" },
    ]);
    expect(violations[0].detail).toContain("no known balance");
  });

  it("refuses a debit with no account at all", () => {
    expect(checkGuardedDebits(balances, [{ kind: "debit", amount: 1 }])[0].detail).toContain(
      "names no account"
    );
  });
});

describe("one_authoritative_balance", () => {
  const accounts = [
    { ownerId: "alice", currency: "USD", balance: 500 },
    { ownerId: "alice", currency: "GBP", balance: 20 },
    { ownerId: "bob", currency: "USD", balance: 0 },
  ];

  it("accepts one account per owner and currency with matching projections", () => {
    expect(checkOneAuthoritativeBalance(accounts, accounts)).toEqual([]);
  });

  it("rejects two authoritative accounts for one owner and currency", () => {
    const dup = [...accounts, { ownerId: "alice", currency: "USD", balance: 500 }];
    const violations = checkOneAuthoritativeBalance(dup);
    expect(violations).toHaveLength(1);
    expect(violations[0].subject).toBe("alice:USD");
  });

  it("rejects a projection that disagrees with its account", () => {
    const violations = checkOneAuthoritativeBalance(accounts, [
      { ownerId: "alice", currency: "USD", balance: 499 },
    ]);
    expect(violations[0].detail).toContain("disagrees");
  });

  it("rejects a projection with no account behind it", () => {
    const violations = checkOneAuthoritativeBalance(accounts, [
      { ownerId: "carol", currency: "USD", balance: 1 },
    ]);
    expect(violations[0].detail).toContain("no authoritative account");
  });

  it("rejects a second projection for the same owner and currency", () => {
    const violations = checkOneAuthoritativeBalance(accounts, [
      { ownerId: "alice", currency: "USD", balance: 500 },
      { ownerId: "alice", currency: "USD", balance: 500 },
    ]);
    expect(violations).toHaveLength(1);
  });
});

describe("bank_accounting_identity", () => {
  it("holds when cash plus loans equals deposits plus borrowings plus equity", () => {
    expect(
      checkBankAccountingIdentity({
        bankId: "b1",
        cash: 1_000,
        loans: 4_000,
        deposits: 3_500,
        borrowings: 500,
        equity: 1_000,
      })
    ).toEqual([]);
  });

  it("allows negative equity, which is what an insolvent bank looks like", () => {
    expect(
      checkBankAccountingIdentity({
        bankId: "b1",
        cash: 100,
        loans: 0,
        deposits: 300,
        borrowings: 0,
        equity: -200,
      })
    ).toEqual([]);
  });

  it("fails when a liability was cleared without moving the cash", () => {
    const violations = checkBankAccountingIdentity({
      bankId: "b1",
      cash: 1_000,
      loans: 0,
      deposits: 0,
      borrowings: 0,
      equity: 0,
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].subject).toBe("b1");
  });

  it("fails on negative cash, loans, deposits or borrowings", () => {
    const violations = checkBankAccountingIdentity({
      bankId: "b1",
      cash: -1,
      loans: 0,
      deposits: 0,
      borrowings: 0,
      equity: -1,
    });
    expect(violations.some((v) => v.detail.includes("cash is negative"))).toBe(true);
  });

  it("fails on a non-finite line before attempting the sum", () => {
    const violations = checkBankAccountingIdentity({
      bankId: "b1",
      cash: Number.NaN,
      loans: 0,
      deposits: 0,
      borrowings: 0,
      equity: 0,
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].detail).toContain("cash is not a finite number");
  });
});

describe("exactly_once", () => {
  it("accepts one application followed by replays", () => {
    expect(
      checkExactlyOnce([
        { key: "k", outcome: "applied" },
        { key: "k", outcome: "replayed" },
        { key: "k", outcome: "replayed" },
      ])
    ).toEqual([]);
  });

  it("rejects a second application of the same key", () => {
    const violations = checkExactlyOnce([
      { key: "k", outcome: "applied" },
      { key: "k", outcome: "applied" },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].subject).toBe("k");
  });

  it("rejects money moving again under an applied key", () => {
    const violations = checkExactlyOnce([
      { key: "k", outcome: "applied" },
      { key: "k", outcome: "partial" },
    ]);
    expect(violations[0].detail).toContain("moved money again");
  });

  it("treats rejected and partial-before-applied as fine", () => {
    expect(
      checkExactlyOnce([
        { key: "k", outcome: "rejected" },
        { key: "k", outcome: "partial" },
        { key: "k", outcome: "applied" },
      ])
    ).toEqual([]);
  });
});

describe("jurisdiction_ownership", () => {
  const claims = [
    { currency: "USD", institutionId: "US" },
    { currency: "EUR", institutionId: "ECB" },
    { currency: "GBP", institutionId: "UK" },
  ];

  it("accepts one institution per currency and mutations by the owner", () => {
    expect(
      checkJurisdictionOwnership(claims, [
        { currency: "EUR", institutionId: "ECB", field: "rate" },
        { currency: "USD", institutionId: "US", field: "board" },
      ])
    ).toEqual([]);
  });

  it("rejects two institutions claiming one currency", () => {
    const violations = checkJurisdictionOwnership([
      ...claims,
      { currency: "EUR", institutionId: "DE" },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].subject).toBe("EUR");
  });

  it("rejects a mutation by an institution that does not own the currency", () => {
    const violations = checkJurisdictionOwnership(claims, [
      { currency: "GBP", institutionId: "US", field: "meeting" },
    ]);
    expect(violations[0].detail).toContain("owned by UK");
  });

  it("rejects a mutation of a currency nobody owns", () => {
    const violations = checkJurisdictionOwnership(claims, [
      { currency: "JPY", institutionId: "JP", field: "rate" },
    ]);
    expect(violations[0].detail).toContain("nobody owns");
  });
});

describe("evaluateBankingInvariants", () => {
  it("returns nothing for an empty world", () => {
    expect(evaluateBankingInvariants({})).toEqual([]);
  });

  it("runs every check it has data for and reports each violation once", () => {
    const violations = evaluateBankingInvariants({
      transfers: [
        {
          subject: "t1",
          legs: [
            { kind: "debit", amount: 50, account: "vault" },
            { kind: "credit", amount: 40, account: "pool" },
          ],
        },
      ],
      balances: { vault: 10, pool: 0 },
      accounts: [
        { ownerId: "a", currency: "USD", balance: 1 },
        { ownerId: "a", currency: "USD", balance: 1 },
      ],
      banks: [{ bankId: "b", cash: 1, loans: 0, deposits: 0, borrowings: 0, equity: 0 }],
      settlements: [
        { key: "k", outcome: "applied" },
        { key: "k", outcome: "applied" },
      ],
      jurisdictions: [
        { currency: "USD", institutionId: "US" },
        { currency: "USD", institutionId: "FED2" },
      ],
    });
    expect(violations.map((v) => v.invariant).sort()).toEqual([
      "balanced_transfer",
      "bank_accounting_identity",
      "exactly_once",
      "guarded_debit",
      "jurisdiction_ownership",
      "one_authoritative_balance",
    ]);
  });
});
