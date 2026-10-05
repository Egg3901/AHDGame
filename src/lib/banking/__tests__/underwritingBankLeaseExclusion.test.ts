import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { BankLoan } from "@/lib/db/types/bank";
import type { ConstructionBuildClaim } from "@/lib/banking/rules/constructionBuild";
import { returnDepositBook } from "@/lib/banking/depositBookReturn";
import { acquireConstructionFundingLease } from "@/lib/banking/constructionFundingLease";
import { acquireConstructionServiceLease } from "@/lib/banking/constructionServiceLease";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));

const bankId = new ObjectId();
const loanId = new ObjectId();
const sectorId = new ObjectId();

function setup() {
  const db = createInMemoryDb();
  db.seed("gameConfig", [{ _id: "default", privateBankingEnabled: true }]);
  db.seed("corporations", [
    {
      _id: bankId,
      name: "Underwriter",
      bankCharter: {
        type: "investment",
        status: "active",
        currency: "USD",
        charteredTurn: 7,
        cashReserves: 10_000,
      },
      bankUnderwritingFunding: { key: "primary-underwriting:equity:one:8", turn: 8 },
    },
  ]);
  return db;
}

describe("bank underwriting lease excludes competing bank lifecycle writes", () => {
  it("prevents deposit-book return and both construction lease types until placement acknowledgement", async () => {
    const db = setup();
    const beforeReserves = (
      db.collection("corporations").docs[0] as { bankCharter: { cashReserves: number } }
    ).bankCharter.cashReserves;

    const returned = await returnDepositBook(db as unknown as Db, bankId, {
      cause: "charter_switch",
      turn: 9,
      releaseResidualToOwner: false,
    });
    expect(returned.returned).toBe(false);
    expect(returned.error).toMatch(/underwriting settlement/i);

    const claim: ConstructionBuildClaim = {
      claimId: "claim-1",
      loanId: loanId.toHexString(),
      bankId: bankId.toHexString(),
      charteredTurn: 7,
      borrowerId: new ObjectId().toHexString(),
      currency: "USD",
      constructionCostLocal: 100,
      collateralCostLocal: 100,
      borrowerContributionLocal: 0,
      principal: 100,
      proceedsLocal: 100,
      termTurns: 12,
      ratePercent: 5,
      order: { unitsOrdered: 1, costPaidAnchor: 100, startTurn: 8, onlineTurn: 9 },
      status: "funding",
      escrowLocal: 0,
    };
    const loan: BankLoan = {
      _id: loanId,
      bankCorporationId: bankId,
      charteredTurn: 7,
      currency: "USD",
      borrowerType: "corporation",
      principal: 100,
      outstanding: 100,
      ratePercent: 5,
      originatedTurn: 8,
      termTurns: 12,
      status: "current",
      constructionCollateral: {
        claimId: "claim-1",
        sectorId,
        quotedCostLocal: 100,
        constructionCostLocal: 100,
      },
    };
    expect(await acquireConstructionFundingLease(db as unknown as Db, claim)).toBe(false);
    expect(await acquireConstructionServiceLease(db as unknown as Db, loan, "service-1", 9)).toBe(
      false
    );
    expect(
      (db.collection("corporations").docs[0] as { bankCharter: { cashReserves: number } })
        .bankCharter.cashReserves
    ).toBe(beforeReserves);
    expect(
      (db.collection("corporations").docs[0] as Record<string, unknown>).bankConstructionFunding
    ).toBeUndefined();
  });
});
