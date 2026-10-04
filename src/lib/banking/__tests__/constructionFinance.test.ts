import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash, InjectedCrash } from "@/lib/test-utils/faultyDb";
import { makeCorporation } from "@/lib/test-utils/factories";
import type { CorporateSector } from "@/lib/db/types/corporation";
import type { BankingSnapshot } from "../rules/boundary";
import { BANKING_POLICY_ALL_ON } from "../rules/policy";
import { loadBankingSnapshot } from "../snapshot";
import { loadBorrowerSnapshot } from "../lending";
import {
  requestConstructionFinance,
  approveConstructionFinance,
  rejectConstructionFinance,
  recoverConstructionFunding,
} from "../constructionFinance";

import { cancelFinancedConstruction } from "../constructionCancellation";
import { acceptLoan, rejectLoan } from "../loanApproval";
vi.mock("@/lib/banking/auditEvents", () => ({ emitBankingAuditEvent: vi.fn() }));
vi.mock("@/lib/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(12) }));
vi.mock("@/lib/mail/systemMail", () => ({ sendSystemMail: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("../snapshot", () => ({ loadBankingSnapshot: vi.fn() }));
vi.mock("../lending", () => ({ loadBorrowerSnapshot: vi.fn() }));

const sectorId = new ObjectId();
const borrowerId = new ObjectId();
const bankId = new ObjectId();
function world(requireApproval = false) {
  const memory = createInMemoryDb();
  memory.seed("gameConfig", [
    { _id: "default", privateBankingEnabled: true, bankConstructionFinanceEnabled: true },
  ]);
  const corporation = makeCorporation({ _id: borrowerId, liquidCapital: 50_000 });
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
      requireApproval,
    },
    reserveRatio: 0.2,
    playerDepositsAreLiabilities: false,
    corporationLiquidCapital: 0,
    primeRate: 3,
    centralBankId: "US",
  };
  const bankCorporation = makeCorporation({ _id: bankId, bankCharter: { ...bank.charter! } });
  const sector = {
    _id: sectorId,
    corporationId: borrowerId,
    forSale: null,
    strategyId: "standard",
    buildQueue: [],
  } as unknown as CorporateSector;
  memory.seed("corporations", [{ ...corporation }, { ...bankCorporation }]);
  memory.seed("corporateSectors", [{ ...sector }]);
  vi.mocked(loadBankingSnapshot).mockResolvedValue({
    snapshot: bank,
    corporation: bankCorporation,
  });
  vi.mocked(loadBorrowerSnapshot).mockResolvedValue({
    name: "Borrower",
    snapshot: {
      type: "corporation",
      id: borrowerId.toHexString(),
      incomePerTurn: 10_000,
      committedPaymentPerTurn: 0,
      blocked: false,
      currencyMatches: true,
    },
  });
  const request = {
    db: memory as unknown as Db,
    enabled: true,
    sector,
    corporation,
    bankId,
    requestId: "build-1",
    principal: 75_000,
    termTurns: 48,
    constructionCostLocal: 100_000,
    collateralCostLocal: 100_000,
    maximumCostLocal: 100_000,
    order: {
      unitsOrdered: 100,
      costPaidAnchor: 100_000,
      startTurn: 12,
      onlineTurn: 16,
      smooth: true,
    },
  };
  return { memory, bank, request };
}

beforeEach(() => vi.clearAllMocks());
describe("construction request lifecycle", () => {
  it("refuses APR drift before reserving the sector or moving cash", async () => {
    const { request, memory } = world();
    expect(await requestConstructionFinance({ ...request, maximumRatePercent: 4 })).toMatchObject({
      ok: false,
      error: "The lender's rate exceeds the reviewed quote",
    });
    expect(memory.collection("bankLoans").docs).toHaveLength(0);
    expect(memory.collection("corporateSectors").docs[0].constructionFinancing).toBeUndefined();
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(50_000);
  });
  it("does not disburse a pending noncash construction request after the flag is disabled", async () => {
    const { request } = world(true);
    const requested = await requestConstructionFinance(request);
    if (!requested.ok) throw new Error(requested.error);
    await request.db
      .collection<{ _id: string; bankConstructionFinanceEnabled: boolean }>("gameConfig")
      .updateOne({ _id: "default" }, { $set: { bankConstructionFinanceEnabled: false } });
    expect(await acceptLoan(request.db, bankId, new ObjectId(requested.loanId))).toMatchObject({
      ok: false,
      error: "New construction funding is disabled",
    });
    expect(
      (await request.db.collection("corporations").findOne({ _id: borrowerId }))?.liquidCapital
    ).toBe(50_000);
    expect(
      (await request.db.collection("corporations").findOne({ _id: bankId }))?.bankCharter
        .cashReserves
    ).toBe(2_000_000);
    expect(
      (await request.db.collection("corporateSectors").findOne({ _id: sectorId }))?.buildQueue
    ).toEqual([]);
  });
  it("auto-approves into one paid build and replays without free proceeds", async () => {
    const { memory, request } = world();
    const result = await requestConstructionFinance(request);
    expect(result).toMatchObject({ ok: true, pending: false });
    expect(await requestConstructionFinance(request)).toEqual(result);
    expect(
      await request.db.collection("corporateSectors").findOne({ _id: sectorId })
    ).toMatchObject({
      constructionFinancing: { status: "building", escrowLocal: 0 },
      buildQueue: [{ unitsOrdered: 100 }],
    });
    expect(
      (await request.db.collection("corporations").findOne({ _id: borrowerId }))?.liquidCapital
    ).toBe(24_250);
    expect(
      (await request.db.collection("corporations").findOne({ _id: bankId }))?.bankCharter
        .cashReserves
    ).toBe(1_925_750);
    expect(memory.collection("bankLoans").docs).toHaveLength(1);
  });

  it("releases bank admission when replaying a committed paid build after a crash", async () => {
    const { request, memory } = world();
    const fault = withInjectedCrash(memory, {
      collection: "corporateSectors",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
      matches: (args) =>
        Array.isArray((args[1] as { $set?: Record<string, unknown> }).$set?.buildQueue),
    });
    await expect(requestConstructionFinance({ ...request, db: fault.db })).rejects.toBeInstanceOf(
      InjectedCrash
    );
    expect(
      (await request.db.collection("corporations").findOne({ _id: bankId }))
        ?.bankConstructionFunding
    ).toMatchObject({ kind: "funding", disbursed: true });
    expect(await requestConstructionFinance(request)).toMatchObject({ ok: true, pending: false });
    expect(
      (await request.db.collection("corporations").findOne({ _id: bankId }))
        ?.bankConstructionFunding
    ).toBeUndefined();
    expect(memory.collection("bankLoans").docs[0]?.constructionSettlementOwner).toBeUndefined();
    expect(
      (await request.db.collection("corporateSectors").findOne({ _id: sectorId }))?.buildQueue
    ).toHaveLength(1);
  });

  it("recovers a paid queue after a crash without a player retry", async () => {
    const { request, memory } = world();
    const fault = withInjectedCrash(memory, {
      collection: "corporateSectors",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
      matches: (args) =>
        Array.isArray((args[1] as { $set?: Record<string, unknown> }).$set?.buildQueue),
    });
    await expect(requestConstructionFinance({ ...request, db: fault.db })).rejects.toBeInstanceOf(
      InjectedCrash
    );
    expect(await recoverConstructionFunding(request.db, 12)).toEqual([]);
    expect(
      memory.collection("corporations").docs.find((doc) => String(doc._id) === String(bankId))
        ?.bankConstructionFunding
    ).toBeDefined();
    expect(await recoverConstructionFunding(request.db, 13)).toEqual([]);
    expect(await recoverConstructionFunding(request.db, 100)).toEqual([]);
    expect(memory.collection("corporateSectors").docs[0]).toMatchObject({
      buildQueue: [expect.objectContaining({ startTurn: 12 })],
      constructionFinancing: { fundingCleanupCompleted: true, escrowLocal: 0 },
    });
    expect(
      memory.collection("corporations").docs.find((doc) => String(doc._id) === String(bankId))
        ?.bankConstructionFunding
    ).toBeUndefined();
    expect(memory.collection("bankLoans").docs[0]?.constructionSettlementOwner).toBeUndefined();
  });

  it("does not approve an old pending loan during funding recovery", async () => {
    const { request, memory } = world(true);
    expect(await requestConstructionFinance(request)).toMatchObject({ ok: true, pending: true });
    expect(await recoverConstructionFunding(request.db, 100)).toEqual([]);
    expect(memory.collection("corporateSectors").docs[0]).toMatchObject({
      buildQueue: [],
      constructionFinancing: { status: "awaiting_approval", escrowLocal: 0 },
    });
    expect(memory.collection("bankLoans").docs[0]).toMatchObject({ status: "pending" });
    expect(
      memory.collection("corporations").docs.find((doc) => String(doc._id) === String(borrowerId))
        ?.liquidCapital
    ).toBe(50_000);
  });

  it("reserves an approval-required quote without moving cash, then funds it", async () => {
    const { request } = world(true);
    const result = await requestConstructionFinance(request);
    expect(result).toMatchObject({ ok: true, pending: true });
    if (!result.ok) throw new Error(result.error);
    expect(
      (await request.db.collection("corporations").findOne({ _id: borrowerId }))?.liquidCapital
    ).toBe(50_000);
    expect(await acceptLoan(request.db, bankId, new ObjectId(result.loanId))).toMatchObject({
      ok: true,
      loan: { status: "current" },
    });
    expect(
      (await request.db.collection("corporateSectors").findOne({ _id: sectorId }))?.buildQueue
    ).toHaveLength(1);
    expect(
      (await rejectConstructionFinance(request.db, bankId, new ObjectId(result.loanId), true)).ok
    ).toBe(false);
  });

  it("rejects and replays an unfunded request while preventing later approval", async () => {
    const { request } = world(true);
    const result = await requestConstructionFinance(request);
    if (!result.ok) throw new Error(result.error);
    const loanId = new ObjectId(result.loanId);
    expect(await rejectLoan(request.db, bankId, loanId, "Declined")).toMatchObject({ ok: true });
    expect(await rejectConstructionFinance(request.db, bankId, loanId, true)).toMatchObject({
      ok: true,
    });
    expect((await approveConstructionFinance(request.db, bankId, loanId, true)).ok).toBe(false);
    expect((await requestConstructionFinance(request)).ok).toBe(false);
    expect(
      await request.db.collection("corporateSectors").findOne({ _id: sectorId })
    ).toMatchObject({
      constructionFinancing: { status: "cancelled", escrowLocal: 0 },
      buildQueue: [],
    });
    expect(
      (await request.db.collection("corporations").findOne({ _id: borrowerId }))?.liquidCapital
    ).toBe(50_000);
    expect(await requestConstructionFinance({ ...request, requestId: "build-2" })).toMatchObject({
      ok: true,
      pending: true,
    });
  });

  it("rejects approval after a charter change before moving borrower cash", async () => {
    const { request, bank } = world(true);
    const result = await requestConstructionFinance(request);
    if (!result.ok || !bank.charter) throw new Error("fixture failed");
    bank.charter.charteredTurn = 3;
    expect(
      (await approveConstructionFinance(request.db, bankId, new ObjectId(result.loanId), true)).ok
    ).toBe(false);
    expect(
      (await request.db.collection("corporations").findOne({ _id: borrowerId }))?.liquidCapital
    ).toBe(50_000);
  });

  it("does not replace an active claim or reserve an invalid build", async () => {
    const { request } = world(true);
    expect(
      (
        await requestConstructionFinance({
          ...request,
          order: { ...request.order, onlineTurn: 12 },
        })
      ).ok
    ).toBe(false);
    expect(
      (await request.db.collection("corporateSectors").findOne({ _id: sectorId }))
        ?.constructionFinancing
    ).toBeUndefined();
    expect((await requestConstructionFinance(request)).ok).toBe(true);
    expect((await requestConstructionFinance({ ...request, requestId: "other-build" })).ok).toBe(
      false
    );
  });

  it("routes generic CEO approval to the paid construction escrow", async () => {
    const { request } = world(true);
    const result = await requestConstructionFinance(request);
    if (!result.ok) throw new Error(result.error);
    expect(await acceptLoan(request.db, bankId, new ObjectId(result.loanId))).toMatchObject({
      ok: true,
      loan: { status: "current" },
    });
    expect(
      (await request.db.collection("corporations").findOne({ _id: borrowerId }))?.liquidCapital
    ).toBe(24_250);
    expect(
      (await request.db.collection("corporateSectors").findOne({ _id: sectorId }))?.buildQueue
    ).toHaveLength(1);
  });

  it("lets only one of simultaneous approval and rejection own funding", async () => {
    const { request } = world(true);
    const result = await requestConstructionFinance(request);
    if (!result.ok) throw new Error(result.error);
    const loanId = new ObjectId(result.loanId);
    const outcomes = await Promise.all([
      approveConstructionFinance(request.db, bankId, loanId, true),
      rejectConstructionFinance(request.db, bankId, loanId, true),
    ]);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    const loan = await request.db.collection("bankLoans").findOne({ _id: loanId });
    const sector = await request.db.collection("corporateSectors").findOne({ _id: sectorId });
    if (loan?.constructionDecision === "approve") {
      expect(loan.status).toBe("current");
      expect(sector?.buildQueue).toHaveLength(1);
    } else {
      expect(loan?.status).toBe("rejected");
      expect(sector?.buildQueue).toHaveLength(0);
      expect(
        (await request.db.collection("corporations").findOne({ _id: borrowerId }))?.liquidCapital
      ).toBe(50_000);
    }
  });

  it.each(["none", "fee", "pool", "queue"])(
    "settles native FX recipients and market headroom once after a %s interruption",
    async (point) => {
      const { request, memory } = world();
      const poolId = new ObjectId();
      memory.seed("centralBanks", [
        { _id: "US", forexRevenue: 0 },
        { _id: "UK", spreadFeeReserveBalances: { USD: 0 } },
      ]);
      memory.seed("unownedSectors", [
        {
          _id: poolId,
          stateId: "GB_TEST",
          countryId: "UK",
          sectorType: "manufacturing",
          industryModel: null,
          headroomUnits: 250,
          revenue: 250_000,
        },
      ]);
      const financed = {
        ...request,
        constructionCostLocal: 100_500,
        maximumCostLocal: 100_500,
        buildContext: {
          destinationCurrency: "GBP" as const,
          bucket: { stateId: "GB_TEST", countryId: "UK", sectorType: "manufacturing" as const },
          eraUnitScale: 1,
        },
      };
      if (point !== "none") {
        const fault = withInjectedCrash(memory, {
          collection:
            point === "fee"
              ? "centralBanks"
              : point === "pool"
                ? "unownedSectors"
                : "corporateSectors",
          op: "updateOne",
          onCall: 1,
          afterWrite: true,
          matches: (args) => {
            const update = args[1] as {
              $inc?: Record<string, unknown>;
              $set?: Record<string, unknown>;
            };
            return point === "fee"
              ? update.$inc?.forexRevenue === 125
              : point === "pool"
                ? Array.isArray(args[1])
                : Array.isArray(update.$set?.buildQueue);
          },
        });
        await expect(
          requestConstructionFinance({ ...financed, db: fault.db })
        ).rejects.toBeInstanceOf(InjectedCrash);
      }
      expect(await requestConstructionFinance(financed)).toMatchObject({
        ok: true,
        pending: false,
      });
      expect(
        await requestConstructionFinance({ ...financed, constructionCostLocal: 900_000 })
      ).toMatchObject({ ok: true, pending: false });
      expect(memory.collection("centralBanks").docs).toMatchObject([
        { forexRevenue: 125 },
        { spreadFeeReserveBalances: { USD: 250 } },
      ]);
      expect(memory.collection("unownedSectors").docs[0].headroomUnits).toBe(150);
      const sector = memory.collection("corporateSectors").docs[0];
      expect(sector.buildQueue).toHaveLength(1);
      expect(sector.constructionFinancing).toMatchObject({
        escrowLocal: 0,
        effectsPaid: true,
        collateralCostLocal: 100_000,
      });
      expect(memory.collection("corporations").docs[0].liquidCapital).toBe(23_750);
      expect(memory.collection("corporations").docs[1].bankConstructionFunding).toBeUndefined();
      const cancelled = await cancelFinancedConstruction({
        db: request.db,
        enabled: true,
        sectorId,
        borrowerId,
        turn: 12,
      });
      expect(cancelled).toMatchObject({ ok: true, principalRepaid: 75_000, ownerRefund: 0 });
      expect(memory.collection("unownedSectors").docs[0].headroomUnits).toBe(250);
      expect(
        (
          await cancelFinancedConstruction({
            db: request.db,
            enabled: true,
            sectorId,
            borrowerId,
            turn: 100,
          })
        ).ok
      ).toBe(true);
      expect(memory.collection("unownedSectors").docs[0].headroomUnits).toBe(250);
      expect(memory.collection("centralBanks").docs).toMatchObject([
        { forexRevenue: 125 },
        { spreadFeeReserveBalances: { USD: 250 } },
      ]);
    }
  );

  it("performs no read or snapshot load when disabled", async () => {
    const { request, memory } = world();
    const collection = vi.spyOn(memory, "collection");
    expect((await requestConstructionFinance({ ...request, enabled: false })).ok).toBe(false);
    expect((await approveConstructionFinance(request.db, bankId, new ObjectId(), false)).ok).toBe(
      false
    );
    expect((await rejectConstructionFinance(request.db, bankId, new ObjectId(), false)).ok).toBe(
      false
    );
    expect(collection).not.toHaveBeenCalled();
    expect(loadBankingSnapshot).not.toHaveBeenCalled();
  });
});
