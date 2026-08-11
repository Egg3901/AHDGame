import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 100 }),
}));
vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi.fn(async (_tx, fallback) => fallback()),
}));

let db: MockDb;
const secretaryId = new ObjectId();

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    userId: new ObjectId().toString(),
    username: "secretary",
    isAdmin: false,
    character: { _id: secretaryId, name: "Secretary Character" },
    ...overrides,
  };
}

function makeBudget(overrides: Record<string, unknown> = {}) {
  return {
    _id: "federal",
    countryId: "US",
    fiscalYear: 2026,
    revenue: {
      total: 1_000_000,
      incomeTax: 0,
      corporateTax: 0,
      payrollTax: 0,
      tariffs: 0,
      salesTax: 0,
      healthcareIncome: 0,
      other: 0,
    },
    surplus: 100_000,
    spending: { byCategory: {}, stateGrants: 0, debtInterest: 0, total: 900_000 },
    debt: { principal: 0, interestRate: 0, ceiling: 10_000_000, ceilingLastRaisedYear: 2024 },
    ...overrides,
  };
}

function makeBank(overrides: Record<string, unknown> = {}) {
  return {
    _id: "US",
    countryId: "US",
    reserveBalance: 0,
    treasuryTransferHistory: [],
    ...overrides,
  };
}

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/US/cabinet/treasury-transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = () => ({ params: Promise.resolve({ code: "US" }) });

async function setup({
  user = makeUser(),
  budget = makeBudget(),
  bank = makeBank(),
  isSeatHolder = true,
}: {
  user?: ReturnType<typeof makeUser>;
  budget?: ReturnType<typeof makeBudget>;
  bank?: ReturnType<typeof makeBank>;
  isSeatHolder?: boolean;
} = {}) {
  db = createMockDb();
  db.collection("federalBudget").findOne.mockResolvedValue(budget);
  db.collection("centralBanks").findOne.mockResolvedValue(bank);
  db.collection("centralBanks").findOneAndUpdate.mockResolvedValue(bank);
  db.collection("cabinetMembers").findOne.mockResolvedValue(
    isSeatHolder
      ? {
          _id: new ObjectId(),
          countryId: "US",
          positionId: "secretary_of_treasury",
          characterId: user.character._id,
          characterName: user.character.name,
          appointedByCharacterId: new ObjectId(),
          appointedAt: new Date(),
          ministerialActions: 2,
          lastActionGrantedTurn: 99,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      : null
  );

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user } as never);
}

describe("POST /api/country/[code]/cabinet/treasury-transfer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects non-seat-holder", async () => {
    await setup({ isSeatHolder: false });
    const { POST } = await import("./route");

    const res = await POST(makeRequest({ amount: 1000 }), ctx());
    expect(res.status).toBe(403);
  });

  it("accepts transfer from the finance minister", async () => {
    await setup();
    const { POST } = await import("./route");

    const res = await POST(makeRequest({ amount: 1000 }), ctx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.transferred).toBe(1000);
    expect(json.record.transferredByName).toBe("Secretary Character");
    expect(json.record.turn).toBe(100);
  });

  it("deducts from surplus and increments reserveBalance atomically", async () => {
    await setup();
    const { POST } = await import("./route");

    await POST(makeRequest({ amount: 1000 }), ctx());

    const budgetInc = db.collectionMocks.federalBudget.updateOne.mock.calls[0]![1].$inc;
    expect(budgetInc.surplus).toBe(-1000);
    expect(budgetInc["spending.byCategory.fxReserveTransfer"]).toBe(1000);
    expect(budgetInc["spending.total"]).toBe(1000);

    const bankUpdate = db.collectionMocks.centralBanks.updateOne.mock.calls[0]![1];
    expect(bankUpdate.$inc.reserveBalance).toBe(1000);
    expect(bankUpdate.$set.treasuryTransferHistory).toHaveLength(1);
  });

  it("enforces per-turn cap (0.5% of annual revenue)", async () => {
    await setup({
      budget: makeBudget({
        revenue: {
          total: 1_000_000,
          incomeTax: 0,
          corporateTax: 0,
          payrollTax: 0,
          tariffs: 0,
          salesTax: 0,
          healthcareIncome: 0,
          other: 0,
        },
      }),
    });
    const { POST } = await import("./route");

    // Cap = 1_000_000 × 0.005 = 5000. Request 6000 → reject.
    const res = await POST(makeRequest({ amount: 6_000 }), ctx());
    expect(res.status).toBe(400);
  });

  it("rejects transfer that would breach debt ceiling", async () => {
    // Tighten revenue so the per-turn cap allows a transfer large enough to
    // cross the ceiling. Revenue 1e9 → cap 5M. Surplus starts at −9.8M; ceiling
    // 10M. Transferring 500K (under cap) pushes surplus to −10.3M < −10M.
    await setup({
      budget: makeBudget({
        revenue: {
          total: 1_000_000_000,
          incomeTax: 0,
          corporateTax: 0,
          payrollTax: 0,
          tariffs: 0,
          salesTax: 0,
          healthcareIncome: 0,
          other: 0,
        },
        surplus: -9_800_000,
        debt: { principal: 0, interestRate: 0, ceiling: 10_000_000, ceilingLastRaisedYear: 2024 },
      }),
    });
    const { POST } = await import("./route");

    const res = await POST(makeRequest({ amount: 500_000 }), ctx());
    expect(res.status).toBe(400);
  });

  it("rejects a second transfer in the same turn", async () => {
    await setup({
      bank: makeBank({
        treasuryTransferHistory: [
          {
            turn: 100,
            transferredBy: secretaryId,
            transferredByName: "Secretary Character",
            amount: 500,
            createdAt: new Date(),
          },
        ],
      }),
    });
    db.collectionMocks.centralBanks.findOneAndUpdate.mockResolvedValueOnce(null);
    const { POST } = await import("./route");

    const res = await POST(makeRequest({ amount: 1000 }), ctx());
    expect(res.status).toBe(400);
  });

  it("refunds the budget and clears the claim if the bank settlement step fails", async () => {
    await setup();
    db.collectionMocks.centralBanks.findOneAndUpdate.mockResolvedValueOnce(makeBank());
    db.collectionMocks.federalBudget.updateOne.mockResolvedValueOnce({
      matchedCount: 1,
      modifiedCount: 1,
    });
    db.collectionMocks.centralBanks.updateOne
      .mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0 })
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ amount: 1000 }), ctx());

    expect(res.status).toBe(500);
    expect(db.collectionMocks.federalBudget.updateOne).toHaveBeenCalledTimes(2);
    expect(db.collectionMocks.federalBudget.updateOne.mock.calls[1]?.[1]).toMatchObject({
      $inc: {
        surplus: 1000,
        "spending.byCategory.fxReserveTransfer": -1000,
        "spending.total": -1000,
      },
    });
    expect(db.collectionMocks.centralBanks.updateOne.mock.calls[1]?.[1]).toMatchObject({
      $unset: { treasuryTransferInProgressAt: "" },
    });
  });
});
