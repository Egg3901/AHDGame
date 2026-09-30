import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { buildSavingsComparison } from "@/lib/savings/shadow";
import { POST } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: () => ({ ok: true }),
  rateLimitResponse: vi.fn(),
  SAVINGS_WALLET_LIMITS: { maxRequests: 10, windowMs: 1000 },
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: async () => true }));
vi.mock("@/lib/gameState", () => ({ getGameState: async () => ({ currentTurn: 50 }) }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));

const USER = new ObjectId();
const OWNER = new ObjectId();
const request = () =>
  new Request("http://localhost/api/character/savings/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currency: "USD" }),
  });

describe("opening authoritative savings", () => {
  let memory: InMemoryDb;
  let db: Db;
  beforeEach(async () => {
    vi.clearAllMocks();
    memory = createInMemoryDb();
    db = memory as unknown as Db;
    memory.seed("gameConfig", [
      {
        _id: "default",
        savingsAccountsMode: "authoritative",
        savingsAccountsReadCurrencies: ["USD"],
      },
    ]);
    memory.seed("gameState", [{ _id: "current", currentTurn: 50 }]);
    memory.seed("centralBanks", [{ _id: "US", externalBroadMoney: 1000 }]);
    memory.seed("characters", [
      {
        _id: OWNER,
        userId: USER,
        countryId: "US",
        currencyBalances: { personal: { USD: 100 }, savings: {} },
      },
    ]);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db);
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: USER.toHexString() },
    } as Awaited<ReturnType<typeof requireBasicAuth>>);
  });

  it("creates the account at opening before any deposit and reconciles cleanly", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(
      await db.collection("savingsAccounts").findOne({ ownerId: OWNER, currency: "USD" })
    ).toMatchObject({ balance: 0, status: "open", holder: "centralBank" });
    expect(
      (await buildSavingsComparison(db, 50, { authoritativeCurrencies: ["USD"] }))
        .totalDiscrepancies
    ).toBe(0);
    expect(
      (await db.collection("characters").findOne({ _id: OWNER }))?.currencyBalances.personal.USD
    ).toBe(100);
  });
});
