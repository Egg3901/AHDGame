import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash, InjectedCrash } from "@/lib/test-utils/faultyDb";
import { settleAtomicDocumentTransition } from "../atomicDocumentSettlement";
import { settleTransition, resumeSettlement } from "../settlementJournal";
import {
  constructionContributionTransition,
  constructionPaidBuildTransition,
  type ConstructionBuildClaim,
} from "../rules/constructionBuild";
import { oid } from "../rules/boundary";
import type { BankingSnapshot, BorrowerSnapshot } from "../rules/boundary";
import { BANKING_POLICY_ALL_ON } from "../rules/policy";
import { settleReservedConstruction } from "../constructionSettlement";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
const sectorId = new ObjectId();
const borrowerId = new ObjectId();
const bankId = new ObjectId();
const loanId = new ObjectId();
const claim = (): ConstructionBuildClaim => ({
  claimId: "quoted-build-1",
  loanId: loanId.toHexString(),
  bankId: bankId.toHexString(),
  charteredTurn: 2,
  borrowerId: borrowerId.toHexString(),
  currency: "USD",
  constructionCostLocal: 100_000,
  collateralCostLocal: 100_000,
  borrowerContributionLocal: 25_750,
  principal: 75_000,
  proceedsLocal: 74_250,
  termTurns: 48,
  ratePercent: 5,
  order: {
    unitsOrdered: 100,
    costPaidAnchor: 100_000,
    startTurn: 10,
    onlineTurn: 14,
    smooth: true,
  },
  status: "funding",
  escrowLocal: 100_000,
  borrowerContributionPaid: true,
  loanFunded: true,
});
function world(buildClaim = claim()) {
  const db = createInMemoryDb();
  db.seed("corporations", [{ _id: borrowerId, liquidCapital: 50_000 }]);
  db.seed("corporateSectors", [
    {
      _id: sectorId,
      corporationId: borrowerId,
      forSale: null,
      buildQueue: [],
      constructionFinancing: buildClaim,
    },
  ]);
  return db;
}
function paidPlan(buildClaim = claim()) {
  const result = constructionPaidBuildTransition({
    enabled: true,
    sectorId: sectorId.toHexString(),
    turn: 12,
    claim: buildClaim,
    queue: [],
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("paid construction settlement", () => {
  it("consumes escrow and publishes one paid order together, including on replay", async () => {
    const memory = world();
    const db = memory as unknown as Db;
    const { transition, guard } = paidPlan();
    const target = { identity: { _id: oid(sectorId.toHexString()) }, guard };
    const settled = await settleAtomicDocumentTransition(db, transition, target);
    expect(settled.error).toBeUndefined();
    expect(settled.status).toBe("applied");
    expect((await settleAtomicDocumentTransition(db, transition, target)).status).toBe("replayed");
    const sector = await db.collection("corporateSectors").findOne({ _id: sectorId });
    expect(sector).toMatchObject({
      constructionFinancing: { escrowLocal: 0, status: "building" },
      buildQueue: [
        {
          startTurn: 12,
          onlineTurn: 16,
          unitsOrdered: 100,
          costPaidAnchor: 100_000,
          constructionLoanId: loanId.toHexString(),
        },
      ],
    });
    expect((await db.collection("corporations").findOne({ _id: borrowerId }))?.liquidCapital).toBe(
      50_000
    );
  });

  it("does not consume escrow when a concurrent build changes the queue", async () => {
    const memory = world();
    const db = memory as unknown as Db;
    const { transition, guard } = paidPlan();
    const concurrent = { unitsOrdered: 5, costPaidAnchor: 5000, startTurn: 11, onlineTurn: 15 };
    await db
      .collection("corporateSectors")
      .updateOne({ _id: sectorId }, { $set: { buildQueue: [concurrent] } });
    expect(
      (
        await settleAtomicDocumentTransition(db, transition, {
          identity: { _id: oid(sectorId.toHexString()) },
          guard,
        })
      ).status
    ).toBe("rejected");
    expect(await db.collection("corporateSectors").findOne({ _id: sectorId })).toMatchObject({
      constructionFinancing: { escrowLocal: 100_000, status: "funding" },
      buildQueue: [concurrent],
    });
  });

  it.each([
    { escrowLocal: 99_999 },
    { loanFunded: false },
    { borrowerContributionPaid: false },
    { status: "awaiting_approval" as const },
    { constructionCostLocal: Number.NaN },
  ])("refuses a build without complete delivered funding (%j)", (overrides) => {
    expect(
      constructionPaidBuildTransition({
        enabled: true,
        sectorId: sectorId.toHexString(),
        turn: 12,
        claim: { ...claim(), ...overrides },
        queue: [],
      }).ok
    ).toBe(false);
  });

  it("has no settlement plan when financing is disabled", () => {
    expect(
      constructionPaidBuildTransition({
        enabled: false,
        sectorId: sectorId.toHexString(),
        turn: 12,
        claim: claim(),
        queue: [],
      }).ok
    ).toBe(false);
  });
});

describe("construction contribution", () => {
  it("recovers a crash after the borrower debit without debiting twice", async () => {
    const frozen = {
      ...claim(),
      escrowLocal: 0,
      borrowerContributionPaid: false,
      loanFunded: false,
    };
    const memory = world(frozen);
    const db = memory as unknown as Db;
    const result = constructionContributionTransition({
      enabled: true,
      sectorId: sectorId.toHexString(),
      turn: 10,
      claim: frozen,
    });
    if (!result.ok) throw new Error(result.error);
    const crashing = withInjectedCrash(memory, {
      collection: "corporations",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
    });
    await expect(settleTransition(crashing.db, result.value)).rejects.toBeInstanceOf(InjectedCrash);
    expect((await resumeSettlement(db, result.value.key)).status).toBe("applied");
    expect(["applied", "replayed"]).toContain(
      (await resumeSettlement(db, result.value.key)).status
    );
    expect((await db.collection("corporations").findOne({ _id: borrowerId }))?.liquidCapital).toBe(
      24_250
    );
    expect(await db.collection("corporateSectors").findOne({ _id: sectorId })).toMatchObject({
      constructionFinancing: { escrowLocal: 25_750, borrowerContributionPaid: true },
    });
  });
});

describe("reserved construction funding", () => {
  const borrower: BorrowerSnapshot = {
    type: "corporation",
    id: borrowerId.toHexString(),
    incomePerTurn: 10_000,
    committedPaymentPerTurn: 0,
    blocked: false,
    currencyMatches: true,
  };
  function reservedWorld() {
    const frozen = {
      ...claim(),
      escrowLocal: 0,
      borrowerContributionPaid: false,
      loanFunded: false,
    };
    const memory = world(frozen);
    const bank: BankingSnapshot = {
      turn: 12,
      policy: BANKING_POLICY_ALL_ON,
      bankId: bankId.toHexString(),
      currency: "USD",
      charter: {
        type: "retail",
        status: "active",
        currency: "USD",
        charteredTurn: 2,
        cashReserves: 2_000_000,
        postedCapital: 1_000_000,
        npcDeposits: 1_000_000,
        totalDeposits: 1_000_000,
        totalLoans: 0,
        depositOffset: 0,
        lendingOffset: 2,
      },
      reserveRatio: 0.2,
      playerDepositsAreLiabilities: false,
      corporationLiquidCapital: 0,
      primeRate: 3,
      centralBankId: "US",
    };
    memory.collection("corporations").docs.push({ _id: bankId, bankCharter: { ...bank.charter } });
    memory.seed("bankLoans", [
      {
        _id: loanId,
        bankCorporationId: bankId,
        borrowerId,
        borrowerType: "corporation",
        charteredTurn: 2,
        currency: "USD",
        outstanding: 75_000,
        principal: 75_000,
        originationFee: 750,
        ratePercent: 5,
        termTurns: 48,
        status: "pending",
        constructionDecision: "approve",
        constructionCollateral: {
          sectorId,
          claimId: frozen.claimId,
          quotedCostLocal: 100_000,
          constructionCostLocal: 100_000,
        },
      },
    ]);
    return { memory, bank };
  }

  it("pays for one build from bank and borrower cash, never from free loan proceeds", async () => {
    const { memory, bank } = reservedWorld();
    const db = memory as unknown as Db;
    const request = { db, enabled: true, sectorId, bank, borrower };
    expect(await settleReservedConstruction(request)).toEqual({ ok: true });
    expect(await settleReservedConstruction(request)).toEqual({ ok: true });
    expect(await db.collection("corporations").findOne({ _id: bankId })).toMatchObject({
      bankCharter: {
        cashReserves: 1_925_750,
        totalLoans: 75_000,
        loanOriginationFeesLifetime: 750,
      },
    });
    expect(await db.collection("corporations").findOne({ _id: borrowerId })).toMatchObject({
      liquidCapital: 24_250,
    });
    expect(await db.collection("corporateSectors").findOne({ _id: sectorId })).toMatchObject({
      constructionFinancing: { escrowLocal: 0, status: "building" },
      buildQueue: [{ costPaidAnchor: 100_000, constructionLoanId: loanId.toHexString() }],
    });
    expect(await db.collection("bankLoans").findOne({ _id: loanId })).toMatchObject({
      status: "current",
      originatedTurn: 12,
    });
  });

  it("cannot debit a replacement charter even from a stale eligible snapshot", async () => {
    const { memory, bank } = reservedWorld();
    const db = memory as unknown as Db;
    await db
      .collection("corporations")
      .updateOne({ _id: bankId }, { $set: { "bankCharter.charteredTurn": 3 } });
    expect(
      (await settleReservedConstruction({ db, enabled: true, sectorId, bank, borrower })).ok
    ).toBe(false);
    expect(await db.collection("corporations").findOne({ _id: bankId })).toMatchObject({
      bankCharter: { cashReserves: 2_000_000 },
    });
    expect(await db.collection("corporateSectors").findOne({ _id: sectorId })).toMatchObject({
      constructionFinancing: { escrowLocal: 25_750, loanFunded: false },
      buildQueue: [],
    });
    expect((await db.collection("bankLoans").findOne({ _id: loanId }))?.status).toBe("pending");
  });

  it("performs no construction read when the feature is disabled", async () => {
    const { memory, bank } = reservedWorld();
    const collection = vi.spyOn(memory, "collection");
    expect(
      (
        await settleReservedConstruction({
          db: memory as unknown as Db,
          enabled: false,
          sectorId,
          bank,
          borrower,
        })
      ).ok
    ).toBe(false);
    expect(collection).not.toHaveBeenCalled();
  });
});
