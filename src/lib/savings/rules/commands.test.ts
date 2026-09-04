import { describe, expect, it } from "vitest";
import { legsNet } from "@/lib/banking/rules/invariants";
import { decideSavingsCommand, type HolderSnapshot, type SavingsContext } from "./commands";
import type { SavingsAccountSnapshot } from "./accounts";

const BANK = "a".repeat(24);
const OTHER = "b".repeat(24);
const OWNER = "c".repeat(24);

function account(over: Partial<SavingsAccountSnapshot> = {}): SavingsAccountSnapshot {
  return {
    id: "1".repeat(24),
    ownerType: "character",
    ownerId: OWNER,
    currency: "USD",
    balance: 1_000,
    holder: "centralBank",
    status: "open",
    version: 3,
    accruedInterest: 0,
    interestEarned: 0,
    openedTurn: 1,
    ...over,
  };
}

const CB: HolderSnapshot = {
  holder: "centralBank",
  cash: 0,
  acceptsDeposits: true,
  playerDeposits: 0,
  active: true,
};
function bank(over: Partial<HolderSnapshot> = {}): HolderSnapshot {
  return {
    holder: BANK,
    cash: 5_000,
    acceptsDeposits: true,
    playerDeposits: 0,
    depositCeiling: 100_000,
    active: true,
    ...over,
  };
}
const CTX: SavingsContext = { turn: 50, centralBankId: "US", privateBanking: true };

function allowed(decision: ReturnType<typeof decideSavingsCommand>) {
  expect(decision.allowed).toBe(true);
  if (!decision.allowed) throw new Error(decision.message);
  expect(Math.abs(legsNet(decision.transition.legs))).toBeLessThan(1e-9);
  return decision;
}

describe("deposit", () => {
  it("moves wallet cash into the central bank's pool and raises the account", () => {
    const d = allowed(
      decideSavingsCommand(
        account(),
        { type: "deposit", amount: 200, walletBalance: 500, holder: CB },
        CTX,
        "x"
      )
    );
    expect(d.next.balance).toBe(1_200);
    expect(d.next.version).toBe(4);
    expect(d.transition.legs.map((l) => [l.kind, l.collection, l.path])).toEqual([
      ["debit", "characters", "currencyBalances.personal.USD"],
      ["credit", "centralBanks", "externalBroadMoney"],
    ]);
    expect(d.transition.projections.map((p) => p.collection)).toEqual([
      "centralBanks",
      "savingsAccounts",
      "characters",
    ]);
    expect(d.transition.projections[1].filter).toEqual({
      _id: { $oid: "1".repeat(24) },
      version: 3,
    });
  });

  it("lands in a bank's vault and raises its player-deposit liability", () => {
    const d = allowed(
      decideSavingsCommand(
        account({ holder: BANK }),
        { type: "deposit", amount: 200, walletBalance: 500, holder: bank() },
        CTX,
        "x"
      )
    );
    expect(d.transition.legs[1]).toMatchObject({
      collection: "corporations",
      path: "bankCharter.cashReserves",
    });
    expect(d.transition.projections[0].update).toEqual({
      $inc: { "bankCharter.playerDeposits": 200 },
    });
  });

  it("refuses over the wallet, over the ceiling, and at a bank not accepting", () => {
    expect(
      decideSavingsCommand(
        account(),
        { type: "deposit", amount: 600, walletBalance: 500, holder: CB },
        CTX,
        "x"
      )
    ).toMatchObject({ refusal: { code: "insufficient_funds" } });
    expect(
      decideSavingsCommand(
        account({ holder: BANK }),
        {
          type: "deposit",
          amount: 200,
          walletBalance: 500,
          holder: bank({ playerDeposits: 99_900 }),
        },
        CTX,
        "x"
      )
    ).toMatchObject({ refusal: { code: "ceiling", max: 100 } });
    expect(
      decideSavingsCommand(
        account({ holder: BANK }),
        { type: "deposit", amount: 1, walletBalance: 5, holder: bank({ acceptsDeposits: false }) },
        CTX,
        "x"
      )
    ).toMatchObject({ refusal: { code: "holder_refuses" } });
    expect(
      decideSavingsCommand(
        account({ holder: BANK }),
        { type: "deposit", amount: 1, walletBalance: 5, holder: bank() },
        { ...CTX, privateBanking: false },
        "x"
      )
    ).toMatchObject({ refusal: { code: "banking_disabled" } });
  });

  it("refuses a stale version", () => {
    expect(
      decideSavingsCommand(
        account(),
        { type: "deposit", amount: 1, walletBalance: 5, holder: CB },
        { ...CTX, expectedVersion: 2 },
        "x"
      )
    ).toMatchObject({
      refusal: { code: "version_conflict", expected: 2, actual: 3 },
    });
  });
});

describe("withdraw", () => {
  it("pays out of the holder's cash and lowers the account", () => {
    const d = allowed(
      decideSavingsCommand(
        account({ holder: BANK }),
        { type: "withdraw", amount: 300, holder: bank() },
        CTX,
        "x"
      )
    );
    expect(d.next.balance).toBe(700);
    expect(d.transition.legs[0]).toMatchObject({
      kind: "debit",
      collection: "corporations",
      path: "bankCharter.cashReserves",
    });
    expect(d.transition.legs[1]).toMatchObject({ kind: "credit", collection: "characters" });
    expect(d.transition.projections[0].update).toEqual({
      $inc: { "bankCharter.playerDeposits": -300 },
    });
  });

  it("refuses more than the balance, and a bank that cannot cover it", () => {
    expect(
      decideSavingsCommand(account(), { type: "withdraw", amount: 1_001, holder: CB }, CTX, "x")
    ).toMatchObject({ refusal: { code: "insufficient_funds" } });
    expect(
      decideSavingsCommand(
        account({ holder: BANK }),
        { type: "withdraw", amount: 900, holder: bank({ cash: 100 }) },
        CTX,
        "x"
      )
    ).toMatchObject({
      refusal: { code: "holder_cannot_pay", available: 100 },
    });
  });
});

describe("transfer_holder", () => {
  it("moves the whole backing and both liabilities, leaving the balance unchanged", () => {
    const d = allowed(
      decideSavingsCommand(account(), { type: "transfer_holder", from: CB, to: bank() }, CTX, "x")
    );
    expect(d.next.balance).toBe(1_000);
    expect(d.next.holder).toBe(BANK);
    expect(d.transition.legs.map((l) => [l.kind, l.collection, l.amount])).toEqual([
      ["debit", "centralBanks", 1_000],
      ["credit", "corporations", 1_000],
    ]);
    expect(d.transition.projections[0].update).toEqual({
      $inc: { householdSavingsLiability: -1_000 },
    });
    expect(d.transition.projections[1].update).toEqual({
      $inc: { "bankCharter.playerDeposits": 1_000 },
    });
    expect(d.transition.event).toMatchObject({
      kind: "account.holder_changed",
      statusBefore: "centralBank",
      statusAfter: BANK,
    });
  });

  it("is a no-op refusal for the same holder", () => {
    expect(
      decideSavingsCommand(
        account({ holder: BANK }),
        { type: "transfer_holder", from: bank(), to: bank() },
        CTX,
        "x"
      )
    ).toMatchObject({ refusal: { code: "same_holder" } });
  });

  it("moves an empty account without legs", () => {
    const d = allowed(
      decideSavingsCommand(
        account({ balance: 0 }),
        { type: "transfer_holder", from: CB, to: bank() },
        CTX,
        "x"
      )
    );
    expect(d.transition.legs).toEqual([]);
    expect(d.next.holder).toBe(BANK);
  });

  it("refuses when the target is full, inactive, or the source cannot release the cash", () => {
    expect(
      decideSavingsCommand(
        account(),
        { type: "transfer_holder", from: CB, to: bank({ playerDeposits: 99_500 }) },
        CTX,
        "x"
      )
    ).toMatchObject({ refusal: { code: "ceiling" } });
    expect(
      decideSavingsCommand(
        account(),
        { type: "transfer_holder", from: CB, to: bank({ active: false }) },
        CTX,
        "x"
      )
    ).toMatchObject({ refusal: { code: "holder_refuses" } });
    expect(
      decideSavingsCommand(
        account({ holder: BANK }),
        { type: "transfer_holder", from: bank({ cash: 10 }), to: { ...bank(), holder: OTHER } },
        CTX,
        "x"
      )
    ).toMatchObject({ refusal: { code: "holder_cannot_pay" } });
  });

  it("refuses a concurrent version conflict", () => {
    expect(
      decideSavingsCommand(
        account(),
        { type: "transfer_holder", from: CB, to: bank() },
        { ...CTX, expectedVersion: 9 },
        "x"
      )
    ).toMatchObject({ refusal: { code: "version_conflict" } });
  });
});

describe("interest", () => {
  it("accrues without moving money and credits at a bank without moving cash", () => {
    const accrued = allowed(
      decideSavingsCommand(
        account({ holder: BANK }),
        { type: "accrue_interest", amount: 4 },
        CTX,
        "x"
      )
    );
    expect(accrued.transition.legs).toEqual([]);
    expect(accrued.next.accruedInterest).toBe(4);
    const credited = allowed(
      decideSavingsCommand(accrued.next, { type: "credit_interest", holder: bank() }, CTX, "y")
    );
    expect(credited.transition.legs).toEqual([]);
    expect(credited.next).toMatchObject({ balance: 1_004, accruedInterest: 0, interestEarned: 4 });
    expect(credited.transition.projections[0].update).toEqual({
      $inc: { "bankCharter.playerDeposits": 4 },
    });
  });

  it("credits at the central bank as a mint into the pool and records the creation", () => {
    const d = allowed(
      decideSavingsCommand(
        account({ accruedInterest: 5 }),
        { type: "credit_interest", holder: CB },
        CTX,
        "x"
      )
    );
    expect(d.transition.legs.map((l) => l.kind)).toEqual(["mint", "credit"]);
    expect(d.transition.projections[1].update).toEqual({
      $inc: { netMoneyCreatedLifetime: 5, savingsInterestPaidLifetime: 5 },
    });
  });

  it("refuses a bank credit the bank cannot fund", () => {
    expect(
      decideSavingsCommand(
        account({ holder: BANK, accruedInterest: 50 }),
        { type: "credit_interest", holder: bank({ cash: 10 }) },
        CTX,
        "x"
      )
    ).toMatchObject({
      refusal: { code: "holder_cannot_pay" },
    });
  });
});

describe("resolve_failed_holder", () => {
  it("returns the account to the central bank, funded in waterfall order, balance unchanged", () => {
    const d = allowed(
      decideSavingsCommand(
        account({ holder: BANK }),
        {
          type: "resolve_failed_holder",
          holder: bank({ active: false }),
          fromEstate: 300,
          fromInsuranceFund: 500,
          fromTreasury: 200,
        },
        CTX,
        "x"
      )
    );
    expect(d.next).toMatchObject({ balance: 1_000, holder: "centralBank", status: "open" });
    expect(d.transition.legs.map((l) => [l.kind, l.amount])).toEqual([
      ["debit", 300],
      ["debit", 500],
      ["mint", 200],
      ["credit", 1_000],
    ]);
  });

  it("refuses a funding plan that does not cover the balance, and a central-bank-held account", () => {
    expect(
      decideSavingsCommand(
        account({ holder: BANK }),
        {
          type: "resolve_failed_holder",
          holder: bank(),
          fromEstate: 1,
          fromInsuranceFund: 0,
          fromTreasury: 0,
        },
        CTX,
        "x"
      )
    ).toMatchObject({ refusal: { code: "invalid_amount" } });
    expect(
      decideSavingsCommand(
        account(),
        {
          type: "resolve_failed_holder",
          holder: CB,
          fromEstate: 0,
          fromInsuranceFund: 0,
          fromTreasury: 1_000,
        },
        CTX,
        "x"
      )
    ).toMatchObject({
      refusal: { code: "not_failed" },
    });
  });
});
