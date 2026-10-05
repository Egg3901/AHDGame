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
import type { Corporation } from "@/lib/db/types";
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

    const archivedOpen = recoveryTargetFor({
      corporationId: OPEN_ESTATE,
      name: "Archived failed bank",
      currency: "USD",
      resolved: false,
      historyId: new ObjectId(),
    });
    expect(archivedOpen.collection).toBe("depositInsuranceFunds");
    expect(archivedOpen.filter).toEqual({ _id: "USD" });
    expect(archivedOpen.path).toBe("balance");
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

  it("services a resolved prior epoch after recharter and sends recovery to insurance", async () => {
    const db = createInMemoryDb();
    const recharteredBank = new ObjectId();
    const priorCharter = {
      ...charter("failed", { depositorsResolvedTurn: 20 }),
      charteredTurn: 1,
      cashReserves: 500,
    };
    db.seed("corporations", [
      {
        _id: recharteredBank,
        name: "Rechartered Bank",
        countryId: "US",
        bankCharter: charter("active", { charteredTurn: 30, cashReserves: 900 }),
      },
    ]);
    db.seed("bankCharterHistory", [
      {
        _id: new ObjectId(),
        corporationId: recharteredBank,
        charter: priorCharter,
        archivedTurn: 20,
        reason: "recharter",
      },
      {
        _id: new ObjectId(),
        corporationId: recharteredBank,
        charter: charter("active", { charteredTurn: 1 }),
        archivedTurn: 10,
        reason: "recharter",
      },
    ]);
    db.seed("depositInsuranceFunds", [{ _id: "USD", balance: 40 }]);
    db.seed("bankLoans", [
      loan(recharteredBank, { charteredTurn: 1 }),
      loan(recharteredBank, { charteredTurn: 30 }),
      // Untagged persisted loans use the originated turn during rollout.
      loan(recharteredBank, { originatedTurn: 2 }),
      // A loan originated in the same turn the prior charter failed stays in its epoch.
      loan(recharteredBank, { originatedTurn: 20 }),
    ]);

    const summary = await processDeadBankLoans(
      db as unknown as Db,
      55,
      async (currentLoan, bank, target) => {
        expect(bank.charteredTurn).toBe(1);
        expect(target.collection).toBe("depositInsuranceFunds");
        await db.collection("depositInsuranceFunds").updateOne(target.filter, {
          $inc: { balance: 100 },
        });
        await db
          .collection("bankLoans")
          .updateOne(
            { _id: currentLoan._id },
            { $set: { lastProcessedTurn: 55, status: "repaid", outstanding: 0 } }
          );
        return { collected: 100 };
      }
    );

    expect(summary.loansServiced).toBe(3);
    expect(summary.recoveredToInsurer).toBe(300);
    expect(db.collection("depositInsuranceFunds").docs[0].balance).toBe(340);
    expect(
      (db.collection("corporations").docs[0] as unknown as Corporation).bankCharter?.cashReserves
    ).toBe(900);
  });

  it("counts insurer recoveries only for resolutions in the measured premium cohort", async () => {
    const db = createInMemoryDb();
    const beforeMeasurement = new ObjectId();
    const measured = new ObjectId();
    const noInsuredClaim = new ObjectId();
    db.seed("corporations", [
      {
        _id: beforeMeasurement,
        name: "Earlier resolution",
        countryId: "US",
        bankCharter: charter("failed", {
          charteredTurn: 1,
          depositorsResolvedTurn: 9,
          insuranceResolutionTurn: 9,
        }),
      },
      {
        _id: measured,
        name: "Measured resolution",
        countryId: "US",
        bankCharter: charter("failed", {
          charteredTurn: 1,
          depositorsResolvedTurn: 10,
          insuranceResolutionTurn: 10,
          insuranceMeasuredClaimTurn: 10,
        }),
      },
      {
        _id: noInsuredClaim,
        name: "Measured resolution without insurer payout",
        countryId: "US",
        bankCharter: charter("failed", {
          charteredTurn: 1,
          depositorsResolvedTurn: 12,
          insuranceResolutionTurn: 12,
        }),
      },
    ]);
    db.seed("depositInsuranceFunds", [
      {
        _id: "USD",
        balance: 0,
        insuredCap: 5_000_000,
        premiumsCollectedLifetime: 0,
        payoutsLifetime: 0,
        treasuryBackstopLifetime: 0,
        pricingEvidenceStartTurn: 10,
      },
    ]);
    db.seed("bankLoans", [loan(beforeMeasurement), loan(measured), loan(noInsuredClaim)]);

    const cohortEligibility: boolean[] = [];
    await processDeadBankLoans(db as unknown as Db, 55, async (_loan, _bank, _target, counted) => {
      cohortEligibility.push(counted);
      return { collected: 100 };
    });

    expect(cohortEligibility.sort()).toEqual([false, false, true]);
  });
});
