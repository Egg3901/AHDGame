import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash, InjectedCrash } from "@/lib/test-utils/faultyDb";
import {
  cancelFinancedConstruction,
  recoverConstructionCancellations,
} from "../constructionCancellation";
import type { ConstructionBuildClaim } from "../rules/constructionBuild";
import { revokeCharter } from "../charter";
import { recoverConstructionServiceLeases } from "../constructionServiceLease";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function world(outstanding = 75_000, epoch = 2, defaults = false) {
  const memory = createInMemoryDb();
  const bankId = new ObjectId(),
    borrowerId = new ObjectId(),
    sectorId = new ObjectId(),
    loanId = new ObjectId();
  const order = {
    unitsOrdered: 100,
    costPaidAnchor: 100_000,
    startTurn: 10,
    onlineTurn: 14,
    smooth: true,
    constructionLoanId: String(loanId),
    constructionClaimId: "financed",
  };
  const claim: ConstructionBuildClaim = {
    claimId: "financed",
    loanId: String(loanId),
    bankId: String(bankId),
    charteredTurn: 2,
    borrowerId: String(borrowerId),
    currency: "USD",
    constructionCostLocal: 100_000,
    collateralCostLocal: 100_000,
    borrowerContributionLocal: 25_750,
    principal: 75_000,
    proceedsLocal: 74_250,
    termTurns: 48,
    ratePercent: 5,
    order,
    status: "building",
    escrowLocal: 0,
    borrowerContributionPaid: true,
    loanFunded: true,
  };
  memory.seed("gameConfig", [
    { _id: "default", privateBankingEnabled: true, bankConstructionFinanceEnabled: true },
  ]);
  memory.seed("gameState", [{ _id: "current", currentTurn: 10 }]);
  memory.seed("corporations", [
    { _id: borrowerId, liquidCapital: 50_000 },
    {
      _id: bankId,
      name: "Lender",
      liquidCapital: 0,
      bankCharter: {
        type: "investment",
        status: "active",
        currency: "USD",
        charteredTurn: epoch,
        cashReserves: 1_000_000,
        totalLoans: defaults ? 0 : outstanding,
      },
    },
  ]);
  memory.seed("corporateSectors", [
    {
      _id: sectorId,
      corporationId: borrowerId,
      capitalStock: 250,
      plantCount: 1,
      buildQueue: [order],
      constructionFinancing: claim,
    },
  ]);
  memory.seed("bankLoans", [
    {
      _id: loanId,
      bankCorporationId: bankId,
      charteredTurn: 2,
      borrowerType: "corporation",
      borrowerId,
      currency: "USD",
      outstanding,
      status: defaults ? "defaulted" : "current",
      constructionCollateral: {
        claimId: claim.claimId,
        sectorId,
        quotedCostLocal: 100_000,
        constructionCostLocal: 100_000,
      },
    },
  ]);
  const db = memory as unknown as Db;
  return {
    memory,
    db,
    bankId,
    borrowerId,
    sectorId,
    loanId,
    input: { db, enabled: true, sectorId, borrowerId, turn: 10 },
  };
}

describe("principal-first financed build cancellation", () => {
  it("returns an unencumbered build's refund after secured principal was fully repaid", async () => {
    const { db, memory, sectorId, borrowerId, loanId } = world(0);
    await db.collection("bankLoans").updateOne({ _id: loanId }, { $set: { status: "repaid" } });
    await db
      .collection("corporateSectors")
      .updateOne({ _id: sectorId }, { $set: { "constructionFinancing.status": "released" } });
    expect(
      await cancelFinancedConstruction({ db, enabled: true, sectorId, borrowerId, turn: 10 })
    ).toMatchObject({ ok: true, principalRepaid: 0, ownerRefund: 75_000 });
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(125_000);
  });
  it.each([75_000, 25_000])(
    "pays %s principal first and refunds only residual cash once",
    async (outstanding) => {
      const w = world(outstanding);
      const result = await cancelFinancedConstruction(w.input);
      expect(result).toEqual({
        ok: true,
        refunded: 75_000,
        principalRepaid: outstanding,
        ownerRefund: 75_000 - outstanding,
      });
      await cancelFinancedConstruction({ ...w.input, turn: 100 });
      expect(
        (await w.db.collection("corporations").findOne({ _id: w.borrowerId }))?.liquidCapital
      ).toBe(125_000 - outstanding);
      const bank = await w.db.collection("corporations").findOne({ _id: w.bankId });
      expect(bank?.bankCharter).toMatchObject({
        cashReserves: 1_000_000 + outstanding,
        totalLoans: 0,
      });
      expect(bank?.bankConstructionFunding).toBeUndefined();
      expect(await w.db.collection("bankLoans").findOne({ _id: w.loanId })).toMatchObject({
        outstanding: 0,
        status: "repaid",
        collateralRecoveredLocal: outstanding,
      });
      const sector = await w.db.collection("corporateSectors").findOne({ _id: w.sectorId });
      expect(sector).toMatchObject({
        capitalStock: 250,
        plantCount: 1,
        buildQueue: [],
        constructionFinancing: {
          escrowLocal: 0,
          status: "released",
          cancellation: { completed: true, cleanupCompleted: true },
        },
      });
    }
  );

  it("keeps the site pledged when cancelling after partial delivery does not repay all debt", async () => {
    const w = world();
    expect(await cancelFinancedConstruction({ ...w.input, turn: 12 })).toMatchObject({
      ok: true,
      refunded: 37_500,
      principalRepaid: 37_500,
      ownerRefund: 0,
    });
    expect(await w.db.collection("bankLoans").findOne({ _id: w.loanId })).toMatchObject({
      outstanding: 37_500,
      status: "current",
    });
    expect(
      (await w.db.collection("corporateSectors").findOne({ _id: w.sectorId }))
        ?.constructionFinancing.status
    ).toBe("building");
  });

  it.each([false, true])(
    "pays the insurer after recharter without changing the replacement book (default=%s)",
    async (defaults) => {
      const w = world(75_000, 20, defaults);
      const bankBefore = (await w.db.collection("corporations").findOne({ _id: w.bankId }))
        ?.bankCharter;
      expect((await cancelFinancedConstruction(w.input)).ok).toBe(true);
      expect(
        (await w.db.collection("corporations").findOne({ _id: w.bankId }))?.bankCharter
      ).toEqual(bankBefore);
      expect(
        (
          await w.db
            .collection<{ _id: string; balance: number }>("depositInsuranceFunds")
            .findOne({ _id: "USD" })
        )?.balance
      ).toBe(75_000);
    }
  );

  it.each(["refund credit", "escrow debit", "loan advance", "completed claim"])(
    "resumes the original quote after a crash at %s",
    async (boundary) => {
      const w = world();
      const crash = withInjectedCrash(w.memory, {
        op: "updateOne",
        onCall: 1,
        afterWrite: true,
        matches: (args) => {
          const update = args[1] as {
            $inc?: Record<string, unknown>;
            $set?: Record<string, unknown>;
          };
          if (boundary === "refund credit")
            return update.$inc?.["constructionFinancing.escrowLocal"] === 75_000;
          if (boundary === "escrow debit")
            return update.$inc?.["constructionFinancing.escrowLocal"] === -75_000;
          if (boundary === "loan advance") return update.$set?.outstanding === 0;
          return update.$set?.["constructionFinancing.cancellation.completed"] === true;
        },
      });
      await expect(cancelFinancedConstruction({ ...w.input, db: crash.db })).rejects.toBeInstanceOf(
        InjectedCrash
      );
      expect((await revokeCharter(w.db, w.bankId, "mid-recovery")).ok).toBe(false);
      // The original turn's 75% refund survives a later fully-delivered time.
      expect(await recoverConstructionCancellations(w.db, 100)).toEqual([]);
      expect(await recoverConstructionCancellations(w.db, 100)).toEqual([]);
      expect(
        (await w.db.collection("corporations").findOne({ _id: w.borrowerId }))?.liquidCapital
      ).toBe(50_000);
      expect(
        (await w.db.collection("corporations").findOne({ _id: w.bankId }))?.bankCharter
      ).toMatchObject({ cashReserves: 1_075_000, totalLoans: 0 });
      expect(
        (await w.db.collection("bankLoans").findOne({ _id: w.loanId }))?.constructionSettlementOwner
      ).toBeUndefined();
      expect(
        (await w.db.collection("corporateSectors").findOne({ _id: w.sectorId }))
          ?.constructionFinancing.escrowLocal
      ).toBe(0);
    }
  );

  it("returns before any database access when disabled", async () => {
    const w = world();
    const read = vi.spyOn(w.db, "collection");
    expect((await cancelFinancedConstruction({ ...w.input, enabled: false })).ok).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it("releases a recovery admission that crashed before reserving its property quote", async () => {
    const w = world();
    const crash = withInjectedCrash(w.memory, {
      collection: "corporations",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
      matches: (args) =>
        (args[1] as { $set?: { bankConstructionFunding?: { kind: string } } }).$set
          ?.bankConstructionFunding?.kind === "recovery",
    });
    await expect(cancelFinancedConstruction({ ...w.input, db: crash.db })).rejects.toBeInstanceOf(
      InjectedCrash
    );
    expect(await recoverConstructionCancellations(w.db, 100)).toEqual([]);
    expect(await recoverConstructionServiceLeases(w.db, 100)).toEqual([]);
    expect(
      (await w.db.collection("corporations").findOne({ _id: w.bankId }))?.bankConstructionFunding
    ).toBeUndefined();
    expect(
      (await w.db.collection("bankLoans").findOne({ _id: w.loanId }))?.constructionSettlementOwner
    ).toBeUndefined();
    expect(
      (await w.db.collection("corporateSectors").findOne({ _id: w.sectorId }))
        ?.constructionFinancing.cancellation
    ).toBeUndefined();
    expect(
      (await w.db.collection("corporations").findOne({ _id: w.borrowerId }))?.liquidCapital
    ).toBe(50_000);
  });

  it("refuses a raced queue without leaving a loan or bank admission owned", async () => {
    const w = world();
    const sectors = w.memory.collection("corporateSectors");
    const original = sectors.updateOne.bind(sectors);
    const spy = vi
      .spyOn(sectors, "updateOne")
      .mockImplementation(async (filter, update, options) => {
        const result = await original(filter, update, options);
        if (
          !Array.isArray(update) &&
          update.$set &&
          typeof update.$set === "object" &&
          "constructionFinancing.cancellation" in update.$set
        )
          await original({ _id: w.sectorId }, { $set: { buildQueue: [] } });
        return result;
      });
    expect((await cancelFinancedConstruction(w.input)).ok).toBe(false);
    spy.mockRestore();
    expect(
      (await w.db.collection("corporations").findOne({ _id: w.bankId }))?.bankConstructionFunding
    ).toBeUndefined();
    expect(
      (await w.db.collection("bankLoans").findOne({ _id: w.loanId }))?.constructionSettlementOwner
    ).toBeUndefined();
    expect(
      (await w.db.collection("corporateSectors").findOne({ _id: w.sectorId }))
        ?.constructionFinancing
    ).toMatchObject({ escrowLocal: 0, cancellation: { aborted: true } });
    expect(
      (await w.db.collection("corporations").findOne({ _id: w.borrowerId }))?.liquidCapital
    ).toBe(50_000);
    expect(await recoverConstructionCancellations(w.db, 11)).toEqual([]);
  });
});
