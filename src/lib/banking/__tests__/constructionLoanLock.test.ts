import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { BankLoan } from "@/lib/db/types/bank";
import { acquireConstructionLoanLock, releaseConstructionLoanLock } from "../constructionLoanLock";
import { settleTransition } from "../settlementJournal";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
function world() {
  const memory = createInMemoryDb();
  const loan: BankLoan = {
    _id: new ObjectId(),
    bankCorporationId: new ObjectId(),
    charteredTurn: 2,
    currency: "USD",
    borrowerType: "corporation",
    borrowerId: new ObjectId(),
    principal: 100,
    outstanding: 100,
    ratePercent: 5,
    originatedTurn: 10,
    termTurns: 48,
    status: "current",
    constructionCollateral: {
      claimId: "claim",
      sectorId: new ObjectId(),
      quotedCostLocal: 10_000,
      constructionCostLocal: 10_000,
    },
  };
  memory.seed("bankLoans", [{ ...loan }]);
  return { memory, loan, db: memory as unknown as Db };
}
describe("construction debt settlement ownership", () => {
  it("admits the original receipt replay and refuses a competing debt quote", async () => {
    const { db, loan } = world();
    const key = `loan-service:${loan._id}:12`;
    expect(await acquireConstructionLoanLock(db, loan, key)).toMatchObject({
      constructionSettlementOwner: key,
    });
    expect(await acquireConstructionLoanLock(db, loan, key)).not.toBeNull();
    expect(await acquireConstructionLoanLock(db, loan, "construction:claim:cancel")).toBeNull();
    await releaseConstructionLoanLock(db, loan, "another-receipt");
    expect(await acquireConstructionLoanLock(db, loan, "construction:claim:cancel")).toBeNull();
    await releaseConstructionLoanLock(db, loan, key);
    expect(await acquireConstructionLoanLock(db, loan, "construction:claim:cancel")).not.toBeNull();
  });
  it("reloads outstanding debt under the lock instead of trusting an older snapshot", async () => {
    const { db, loan } = world();
    await db.collection("bankLoans").updateOne({ _id: loan._id }, { $set: { outstanding: 42 } });
    expect(
      (await acquireConstructionLoanLock(db, loan, "construction:claim:cancel"))?.outstanding
    ).toBe(42);
  });
  it("recovers a completed service receipt before releasing its ownership", async () => {
    const { db, loan } = world();
    const key = `loan-service:${loan._id}:12`;
    await acquireConstructionLoanLock(db, loan, key);
    expect(
      (
        await settleTransition(db, {
          key,
          kind: "loan_service",
          turn: 12,
          currency: "USD",
          legs: [],
          projections: [
            {
              collection: "bankLoans",
              filter: { _id: { $oid: String(loan._id) } },
              update: { $set: { outstanding: 50 } },
              note: "Original service debt",
            },
          ],
          event: { kind: "loan.paid", command: "bank.loan.service" },
        })
      ).status
    ).toBe("applied");
    expect(
      (await acquireConstructionLoanLock(db, loan, "construction:claim:cancel"))?.outstanding
    ).toBe(50);
  });
  it("does not release another in-progress construction receipt", async () => {
    const { db, loan } = world();
    await acquireConstructionLoanLock(db, loan, "construction:claim:funding");
    expect(await acquireConstructionLoanLock(db, loan, `loan-service:${loan._id}:12`)).toBeNull();
  });
  it("recovers funding ownership after the paid queue append committed", async () => {
    const { db, memory, loan } = world();
    const collateral = loan.constructionCollateral!;
    await acquireConstructionLoanLock(db, loan, `construction:${collateral.claimId}:funding`);
    memory.seed("corporateSectors", [
      {
        _id: collateral.sectorId,
        constructionFinancing: {
          claimId: collateral.claimId,
          status: "building",
          escrowLocal: 0,
          loanFunded: true,
          borrowerContributionPaid: true,
        },
      },
    ]);
    expect(
      await acquireConstructionLoanLock(db, loan, `loan-service:${loan._id}:12`)
    ).not.toBeNull();
  });
  it("does no new reads for ordinary loans", async () => {
    const { db, memory, loan } = world();
    delete loan.constructionCollateral;
    const collection = vi.spyOn(memory, "collection");
    expect(await acquireConstructionLoanLock(db, loan, "key")).toBe(loan);
    await releaseConstructionLoanLock(db, loan, "key");
    expect(collection).not.toHaveBeenCalled();
  });
});
