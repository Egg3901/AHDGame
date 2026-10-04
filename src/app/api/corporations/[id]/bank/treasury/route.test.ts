import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { POST } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({ checkRateLimit: vi.fn(() => ({ ok: true })) }));
vi.mock("@/lib/api/rejectDuringTurn", () => ({ rejectDuringTurn: vi.fn(async () => null) }));

const bankId = new ObjectId("660000000000000000000001");
const bondId = new ObjectId("660000000000000000000002");
const userId = new ObjectId("660000000000000000000003");
const params = { params: Promise.resolve({ id: bankId.toHexString() }) };
const ticket = {
  action: "subscribePrimary",
  bondId: bondId.toHexString(),
  units: 2,
  maxCostLocal: 3_000,
  requestId: "00000000-0000-4000-8000-000000000001",
};
let memory: InMemoryDb;
function request(body: unknown) {
  return new Request("http://localhost/api/corporations/1/bank/treasury", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  memory = createInMemoryDb();
  memory.seed("gameConfig", [
    {
      _id: "default",
      privateBankingEnabled: true,
      bankTreasuryEnabled: true,
      bankSovereignPrimaryEnabled: true,
      treasuryCashLedgerEnabled: true,
    },
  ]);
  memory.seed("gameState", [{ _id: "current", currentTurn: 100, preset: "1991-default" }]);
  memory.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
  memory.seed("centralBanks", [{ _id: "US", primeRate: 4, bankReserveRequirement: 0.1 }]);
  memory.seed("corporations", [
    {
      _id: bankId,
      name: "Bank",
      countryId: "US",
      ceoType: "character",
      ceoId: userId,
      userId,
      liquidCurrencyCode: "USD",
      bankCharter: {
        type: "investment",
        status: "active",
        currency: "USD",
        charteredTurn: 1,
        cashReserves: 100_000,
        postedCapital: 100_000,
        npcDeposits: 0,
        playerDeposits: 0,
        totalDeposits: 0,
        totalLoans: 0,
        depositOffset: 0,
        lendingOffset: 0,
      },
    },
  ]);
  memory.seed("bonds", [
    {
      _id: bondId,
      issuerType: "sovereign",
      countryId: "US",
      currencyCode: "USD",
      marketPrice: 1,
      couponRate: 4,
      maturityTurn: 340,
      unsoldUnits: 10,
      publicFloat: 0,
      totalIssued: 0,
      holders: [],
      defaulted: false,
      matured: false,
    },
  ]);
  memory.seed("bondMarketPools", [{ _id: "USD", cashLocal: 100_000, targetCashLocal: 100_000 }]);
  memory.seed("federalBudget", [
    {
      _id: "federal",
      countryId: "US",
      currencyCode: "USD",
      treasuryCashLocal: 0,
      treasuryBalance: 0,
      debt: { principal: 0 },
      spending: { debtInterest: 0, total: 0 },
      surplus: 0,
    },
  ]);
  vi.mocked(getDb).mockResolvedValue(memory as unknown as Db);
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { userId: userId.toHexString(), isAdmin: false },
  } as never);
});

describe("sovereign primary subscription route", () => {
  it("funds a CEO-reviewed offer and binds the request to its original price", async () => {
    const response = await POST(request(ticket), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "completed", units: 2 });
    const paid = memory.collection("federalBudget").docs[0].treasuryCashLocal;
    memory.collection("bonds").docs[0].marketPrice = 2;
    expect((await POST(request(ticket), params)).status).toBe(200);
    expect(memory.collection("federalBudget").docs[0].treasuryCashLocal).toBe(paid);
    expect(memory.collection("bonds").docs[0].totalIssued).toBe(2_000);
  });
  it("returns feature-off before looking up the bank or bond", async () => {
    memory.collection("gameConfig").docs[0].bankSovereignPrimaryEnabled = false;
    const spy = vi.spyOn(memory, "collection");
    expect((await POST(request(ticket), params)).status).toBe(404);
    expect(spy.mock.calls.map(([collection]) => collection)).not.toContain("corporations");
    expect(spy.mock.calls.map(([collection]) => collection)).not.toContain("bonds");
  });
  it("rejects an unaccepted price, malformed ticket and a non-CEO without funding", async () => {
    expect((await POST(request({ ...ticket, maxCostLocal: 1 }), params)).status).toBe(400);
    expect((await POST(request({ ...ticket, maxCostLocal: 0 }), params)).status).toBe(400);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toHexString(),
        isAdmin: false,
      },
    } as never);
    expect((await POST(request(ticket), params)).status).toBe(403);
    expect(memory.collection("federalBudget").docs[0].treasuryCashLocal).toBe(0);
  });
});
