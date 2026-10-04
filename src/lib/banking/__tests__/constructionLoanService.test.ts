import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash, InjectedCrash } from "@/lib/test-utils/faultyDb";
import { loanServiceTransition } from "../rules/loanServicing";
import { settleTransition, resumeSettlement } from "../settlementJournal";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("funded construction pledge release", () => {
  it("keeps the pledge during a crashed final payment and releases once after recovery", async () => {
    const bankId = new ObjectId(),
      borrowerId = new ObjectId(),
      sectorId = new ObjectId(),
      loanId = new ObjectId();
    const memory = createInMemoryDb();
    const loan = {
      _id: loanId,
      borrowerType: "corporation" as const,
      borrowerId,
      currency: "USD" as const,
      outstanding: 100,
      status: "current" as const,
      ratePercent: 4.8,
      originatedTurn: 100,
      termTurns: 48,
      constructionCollateral: {
        claimId: "paid-build",
        sectorId,
        quotedCostLocal: 10_000,
        constructionCostLocal: 10_000,
      },
    };
    memory.seed("corporations", [
      { _id: borrowerId, liquidCapital: 1000 },
      { _id: bankId, bankCharter: { cashReserves: 0 } },
    ]);
    memory.seed("bankLoans", [loan]);
    memory.seed("corporateSectors", [
      {
        _id: sectorId,
        constructionFinancing: { claimId: "paid-build", status: "building", escrowLocal: 0 },
      },
    ]);
    const { transition, decision } = loanServiceTransition({
      loan,
      turn: 147,
      borrowerAvailable: 1000,
      bankId: String(bankId),
      creditTarget: {
        collection: "corporations",
        filter: { _id: { $oid: String(bankId) } },
        path: "bankCharter.cashReserves",
        note: "Actual final payment",
      },
    });
    const crashing = withInjectedCrash(memory, {
      collection: "corporations",
      op: "updateOne",
      onCall: 2,
      afterWrite: true,
    });
    await expect(settleTransition(crashing.db, transition)).rejects.toBeInstanceOf(InjectedCrash);
    const db = memory as unknown as Db;
    expect(
      (await db.collection("corporateSectors").findOne({ _id: sectorId }))?.constructionFinancing
        .status
    ).toBe("building");
    expect((await resumeSettlement(db, transition.key)).status).toBe("applied");
    await resumeSettlement(db, transition.key);
    expect(
      (await db.collection("corporateSectors").findOne({ _id: sectorId }))?.constructionFinancing
        .status
    ).toBe("released");
    expect((await db.collection("bankLoans").findOne({ _id: loanId }))?.status).toBe("repaid");
    expect(
      (await db.collection("corporations").findOne({ _id: borrowerId }))?.liquidCapital
    ).toBeCloseTo(1000 - decision.payment);
    expect(
      (await db.collection("corporations").findOne({ _id: bankId }))?.bankCharter.cashReserves
    ).toBeCloseTo(decision.payment);
  });
});
