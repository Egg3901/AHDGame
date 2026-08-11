import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 100 }),
}));

let db: MockDb;
const chairCharacterId = new ObjectId();

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    userId: new ObjectId().toString(),
    username: "chair",
    isAdmin: false,
    character: {
      _id: chairCharacterId,
      name: "Chair",
      countryId: "US",
    },
    ...overrides,
  };
}

function makeBank(overrides: Record<string, unknown> = {}) {
  return {
    _id: "US",
    countryId: "US",
    chairCharacterId,
    chairControlsLocked: false,
    forexRevenue: 1_000,
    reserveBalance: 800,
    nationalSavingsBalance: 10_000,
    ...overrides,
  };
}

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/US/central-bank/reserve-pool-transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = () => ({ params: Promise.resolve({ code: "US" }) });

async function setup({
  bank = makeBank(),
  user = makeUser(),
  outstanding = [{ totalBalance: 0, totalArrears: 0 }],
}: {
  bank?: ReturnType<typeof makeBank>;
  user?: ReturnType<typeof makeUser>;
  outstanding?: Array<{ totalBalance: number; totalArrears: number }>;
} = {}) {
  db = createMockDb();
  db.collection("centralBanks").findOne.mockResolvedValue(bank);
  db.collection("centralBanks").updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  db.collection("characters").aggregate.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(outstanding),
  });

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user } as never);
}

describe("POST /api/country/[code]/central-bank/reserve-pool-transfer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("moves forex revenue into lending reserves", async () => {
    await setup();
    const { POST } = await import("./route");

    const response = await POST(makeRequest({ direction: "toLending", amount: 400 }), ctx());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.amount).toBe(400);
    expect(json.forexRevenueDelta).toBe(-400);
    expect(json.reserveBalanceDelta).toBe(400);
    expect(db.collectionMocks.centralBanks.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "US", forexRevenue: { $gte: 400 } }),
      expect.objectContaining({
        $inc: { forexRevenue: -400, reserveBalance: 400 },
        $set: expect.objectContaining({ lastReservePoolTransferTurn: 100 }),
      })
    );
  });

  it("rejects lending→forex moves that would uncover outstanding loans", async () => {
    await setup({
      bank: makeBank({
        forexRevenue: 100,
        reserveBalance: 900,
        nationalSavingsBalance: 100,
      }),
      outstanding: [{ totalBalance: 700, totalArrears: 0 }],
    });
    const { POST } = await import("./route");

    const response = await POST(makeRequest({ direction: "toForex", amount: 100 }), ctx());
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toMatch(/outstanding loans/i);
    expect(db.collectionMocks.centralBanks.updateOne).not.toHaveBeenCalled();
  });

  it("enforces the once-per-day cooldown for chairs", async () => {
    await setup({
      bank: makeBank({ lastReservePoolTransferTurn: 90 }),
    });
    const { POST } = await import("./route");

    const response = await POST(makeRequest({ direction: "toLending", amount: 100 }), ctx());
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toMatch(/once every 24 turns/i);
    expect(db.collectionMocks.centralBanks.updateOne).not.toHaveBeenCalled();
  });

  it("rejects non-chair callers", async () => {
    await setup({
      user: makeUser({
        character: { _id: new ObjectId(), name: "Not Chair", countryId: "US" },
      }),
    });
    const { POST } = await import("./route");

    const response = await POST(makeRequest({ direction: "toLending", amount: 100 }), ctx());
    expect(response.status).toBe(403);
    expect(db.collectionMocks.centralBanks.updateOne).not.toHaveBeenCalled();
  });

  it("rejects amounts above the 50% source-pool cap", async () => {
    await setup();
    const { POST } = await import("./route");

    const response = await POST(makeRequest({ direction: "toLending", amount: 600 }), ctx());
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toMatch(/50%/i);
    expect(db.collectionMocks.centralBanks.updateOne).not.toHaveBeenCalled();
  });
});
