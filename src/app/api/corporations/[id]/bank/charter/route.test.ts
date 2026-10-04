import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { PATCH } from "./route";
import { coreGameConfigUpdate } from "@/lib/admin/seed/coreGameConfigUpdate";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({ checkRateLimit: () => ({ ok: true }) }));
const bankId = new ObjectId(),
  ownerId = new ObjectId();
let memory: ReturnType<typeof createInMemoryDb>;
const params = { params: Promise.resolve({ id: bankId.toHexString() }) };
function request(type: string) {
  return new Request("http://localhost/api/corporations/1/bank/charter", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type }),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  memory = createInMemoryDb();
  await memory
    .collection("gameConfig")
    .updateOne({ _id: "default" }, coreGameConfigUpdate(false, 1991), { upsert: true });
  memory.seed("gameState", [
    { _id: "current", preset: "1991-default", currentTurn: 10, currentYear: 1991 },
  ]);
  memory.seed("centralBanks", [{ _id: "US", externalBroadMoney: 10_000_000 }]);
  memory.seed("depositInsuranceFunds", [{ _id: "USD", balance: 0 }]);
  memory.seed("corporations", [
    {
      _id: bankId,
      userId: ownerId,
      name: "Bank",
      countryId: "US",
      liquidCapital: 500,
      liquidCurrencyCode: "USD",
      bankCharter: {
        type: "retail",
        status: "active",
        currency: "USD",
        charteredTurn: 1,
        postedCapital: 1_000_000,
        cashReserves: 1_000_000,
        npcDeposits: 100_000,
        totalDeposits: 100_000,
        totalLoans: 20_000,
        depositOffset: -1,
        lendingOffset: 2,
      },
    },
  ]);
  memory.seed("bankLoans", [
    {
      _id: new ObjectId(),
      bankCorporationId: bankId,
      charteredTurn: 1,
      principal: 20_000,
      outstanding: 20_000,
      status: "current",
      currency: "USD",
    },
  ]);
  vi.mocked(getDb).mockResolvedValue(memory as unknown as Db);
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { userId: ownerId.toHexString(), isAdmin: false },
  } as never);
});

describe("1991 CEO charter conversion", () => {
  it("converts retail to investment, returns deposits, preserves the loan epoch and posted capital", async () => {
    const response = await PATCH(request("investment"), params);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.charter).toMatchObject({
      type: "investment",
      charteredTurn: 1,
      postedCapital: 1_000_000,
      cashReserves: 900_000,
      totalDeposits: 0,
    });
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(500);
    expect(memory.collection("bankLoans").docs[0]).toMatchObject({
      charteredTurn: 1,
      outstanding: 20_000,
    });
    expect(memory.collection("centralBanks").docs[0].externalBroadMoney).toBe(10_100_000);
  });
  it("rejects universal banking under the 1991 US default before moving deposits", async () => {
    expect((await PATCH(request("universal"), params)).status).toBe(400);
    expect(memory.collection("centralBanks").docs[0].externalBroadMoney).toBe(10_000_000);
  });
  it("rejects a non-CEO conversion", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toHexString(), isAdmin: false },
    } as never);
    expect((await PATCH(request("investment"), params)).status).toBe(403);
    expect(memory.collection("centralBanks").docs[0].externalBroadMoney).toBe(10_000_000);
  });
});
