import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";
import { POST, DELETE } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({ checkRateLimit: () => ({ ok: true }) }));
vi.mock("@/lib/banking/featureFlag", () => ({ isBankPropTradingEnabled: async () => true }));
const bankId = new ObjectId(),
  userId = new ObjectId();
const ticket = { asset: "forex", ref: "GBP", units: 100_000 };
let memory: ReturnType<typeof createInMemoryDb>;
function request(method: string, body: unknown) {
  return new Request("http://localhost/api/corporations/1/bank/prop/positions", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ id: bankId.toHexString() }) };

beforeEach(() => {
  vi.clearAllMocks();
  resetCorpFxRateCacheForTests();
  memory = createInMemoryDb();
  memory.seed("gameConfig", [
    {
      _id: "default",
      privateBankingEnabled: true,
      bankPropTradingEnabled: true,
      bankPropForexFeesEnabled: true,
    },
  ]);
  memory.seed("gameState", [{ _id: "current", currentTurn: 100 }]);
  memory.seed("exchangeRates", [
    { currencyCode: "USD", rate: 1 },
    { currencyCode: "GBP", rate: 2 },
  ]);
  memory.seed("centralBanks", [{ _id: "US", forexRevenue: 0 }]);
  memory.seed("corporations", [
    {
      _id: bankId,
      ceoId: userId,
      userId,
      name: "Bank",
      countryId: "US",
      liquidCurrencyCode: "USD",
      bankCharter: {
        type: "investment",
        status: "active",
        currency: "USD",
        charteredTurn: 1,
        postedCapital: 1_000_000,
        cashReserves: 1_000_000,
        depositOffset: 0,
        lendingOffset: 0,
        propBook: [],
        propBookMarkValue: 0,
      },
    },
  ]);
  vi.mocked(getDb).mockResolvedValue(memory as unknown as Db);
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { userId: userId.toHexString(), isAdmin: false },
  } as never);
});

describe("forex position cash quotes", () => {
  it("quotes without trading, then buys and sells with accepted cash bounds", async () => {
    const quote = await POST(request("POST", { ...ticket, quoteOnly: true }), params);
    expect(quote.status).toBe(200);
    const quoted = await quote.json();
    expect(memory.collection("bankMoneyMoves").docs).toHaveLength(0);
    const bought = await POST(request("POST", { ...ticket, maxCost: quoted.cost }), params);
    expect(bought.status).toBe(200);
    const purchase = await bought.json();
    expect(purchase.fee).toBeGreaterThan(0);
    const sold = await DELETE(request("DELETE", { ...ticket, minProceeds: 0 }), params);
    expect(sold.status).toBe(200);
    expect((await sold.json()).fee).toBeGreaterThan(0);
  });
  it("rejects a quote request on DELETE without closing a position", async () => {
    const response = await DELETE(request("DELETE", { ...ticket, quoteOnly: true }), params);
    expect(response.status).toBe(400);
    expect(memory.collection("bankMoneyMoves").docs).toHaveLength(0);
  });
  it("rejects non-CEO quotes before any money movement", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toHexString(), isAdmin: false },
    } as never);
    expect((await POST(request("POST", { ...ticket, quoteOnly: true }), params)).status).toBe(403);
    expect(memory.collection("bankMoneyMoves").docs).toHaveLength(0);
  });
});
