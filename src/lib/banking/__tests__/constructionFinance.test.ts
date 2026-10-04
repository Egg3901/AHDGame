import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
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
} from "../constructionFinance";

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
