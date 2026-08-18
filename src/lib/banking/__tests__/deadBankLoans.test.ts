/**
 * A loan outlives the bank that made it.
 *
 * The wind-up paths all claimed loans were "left in place and keep amortizing",
 * and none of them were: the banking turn services charters whose status is
 * `active`, so the moment a charter went to `failed` or `revoked` its whole
 * loan book stopped being touched by anything. The borrower kept the cash, the
 * asset sat at full value on a dead charter forever, and the value never
 * reached anyone who lost out in the failure.
 *
 * These tests pin the routing decision, which is the part that is easy to get
 * wrong and impossible to see afterwards: a recovery that arrives while the
 * estate is still open belongs to the estate, because the waterfall has not run
 * yet and a bigger estate pays more claimants. A recovery that arrives after
 * the estate closed belongs to the insurer that stood in for the depositors,
 * because everyone else has already been paid or written off. Neither of them
 * is the dead charter's own cash pile.
 */

import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import {
  findDeadBanksWithLoans,
  processDeadBankLoans,
  recoveryTargetFor,
} from "@/lib/banking/deadBankLoans";
import type { BankLoan } from "@/lib/db/types/bank";

const OPEN_ESTATE = new ObjectId();
const CLOSED_ESTATE = new ObjectId();
const REVOKED = new ObjectId();
const LIVE = new ObjectId();

function charter(status: string, extra: Record<string, unknown> = {}) {
  return {
    type: "retail",
    status,
    currency: "USD",
    charteredTurn: 1,
    cashReserves: 0,
    ...extra,
  };
}

function makeWorld(): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("corporations", [
    { _id: OPEN_ESTATE, name: "Failed Open", countryId: "US", bankCharter: charter("failed") },
    {
      _id: CLOSED_ESTATE,
      name: "Failed Closed",
      countryId: "US",
      bankCharter: charter("failed", { depositorsResolvedTurn: 30 }),
    },
    { _id: REVOKED, name: "Revoked", countryId: "US", bankCharter: charter("revoked") },
    { _id: LIVE, name: "Live", countryId: "US", bankCharter: charter("active") },
  ]);
  db.seed("depositInsuranceFunds", [{ _id: "USD", balance: 0 }]);
  return db;
}

function loan(bankCorporationId: ObjectId, overrides: Partial<BankLoan> = {}) {
  return {
    _id: new ObjectId(),
    bankCorporationId,
    borrowerType: "character",
    borrowerId: new ObjectId(),
    currency: "USD",
    principal: 1_000_000,
    outstanding: 1_000_000,
    ratePercent: 6,
    termTurns: 20,
    originatedTurn: 1,
    status: "current",
    ...overrides,
  };
}

describe("loans owed to a bank that no longer exists", () => {
  it("finds only wound-up charters, and knows which estates are closed", async () => {
    const db = makeWorld();
    const dead = await findDeadBanksWithLoans(db as unknown as Db);

    // The live bank is serviced by the normal pass and must not appear here, or
    // its loans would be collected twice in one turn.
    expect(dead.map((b) => b.name).sort()).toEqual(["Failed Closed", "Failed Open", "Revoked"]);

    const byName = new Map(dead.map((b) => [b.name, b]));
    expect(byName.get("Failed Open")!.resolved).toBe(false);
    // Stamped by the resolution sweep, so its waterfall has already run.
    expect(byName.get("Failed Closed")!.resolved).toBe(true);
    // A revocation runs the waterfall on the way out, so it is closed on sight.
    expect(byName.get("Revoked")!.resolved).toBe(true);
  });

  it("routes an early recovery into the estate and a late one to the insurer", () => {
    const open = recoveryTargetFor({
      corporationId: OPEN_ESTATE,
      name: "Failed Open",
      currency: "USD",
      resolved: false,
    });
    expect(open.collection).toBe("corporations");
    expect(open.path).toBe("bankCharter.cashReserves");

    const closed = recoveryTargetFor({
      corporationId: CLOSED_ESTATE,
      name: "Failed Closed",
      currency: "USD",
      resolved: true,
    });
    expect(closed.collection).toBe("depositInsuranceFunds");
    expect(closed.filter).toEqual({ _id: "USD" });
    expect(closed.path).toBe("balance");
  });

  it("services every dead bank's book and reports the two destinations apart", async () => {
    const db = makeWorld();
    db.seed("bankLoans", [
      loan(OPEN_ESTATE),
      loan(OPEN_ESTATE),
      loan(CLOSED_ESTATE),
      loan(REVOKED),
      // Already touched this turn: the servicing pass must not double it.
      loan(OPEN_ESTATE, { lastProcessedTurn: 55 }),
      // Written off already. Nothing left to collect.
      loan(OPEN_ESTATE, { status: "defaulted" }),
      // The live bank's loan belongs to the normal pass.
      loan(LIVE),
    ]);

    const seen: { bank: string; target: string }[] = [];
    const summary = await processDeadBankLoans(
      db as unknown as Db,
      55,
      async (_l, bank, target) => {
        seen.push({ bank: bank.name, target: target.collection });
        return { collected: 100 };
      }
    );

    expect(summary.loansServiced).toBe(4);
    expect(seen.filter((s) => s.bank === "Failed Open")).toHaveLength(2);
    expect(seen.every((s) => s.bank !== "Live")).toBe(true);

    // Two loans into an open estate, one each into two closed ones.
    expect(summary.recoveredToEstate).toBe(200);
    expect(summary.recoveredToInsurer).toBe(200);
    expect(seen.filter((s) => s.target === "depositInsuranceFunds")).toHaveLength(2);
  });

  it("does nothing, and touches no loan, when every charter is alive", async () => {
    const db = createInMemoryDb();
    db.seed("corporations", [
      { _id: LIVE, name: "Live", countryId: "US", bankCharter: charter("active") },
    ]);
    db.seed("bankLoans", [loan(LIVE)]);

    let called = 0;
    const summary = await processDeadBankLoans(db as unknown as Db, 55, async () => {
      called += 1;
      return { collected: 1 };
    });

    expect(called).toBe(0);
    expect(summary).toEqual({
      loansServiced: 0,
      recoveredToEstate: 0,
      recoveredToInsurer: 0,
    });
  });
});
