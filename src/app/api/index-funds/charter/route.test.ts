import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { POST } from "./route";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { charterFund } from "@/lib/indexFunds/sponsorship/charterFund";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn(async () => null),
}));
vi.mock("@/lib/api/rateLimit", () => ({ checkRateLimit: vi.fn(() => ({ ok: true })) }));
vi.mock("@/lib/indexFunds/featureFlag", () => ({ isIndexFundsEnabled: vi.fn(async () => true) }));
vi.mock("@/lib/indexFunds/fundCron", () => ({ INDEX_FUNDS_DISABLED_MESSAGE: "Unavailable" }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn(async () => 1) }));
vi.mock("@/lib/indexFunds/sponsorship/charterFund", () => ({ charterFund: vi.fn() }));

const owner = new ObjectId();
const corpId = new ObjectId();
const body = {
  sponsorCorporationId: String(corpId),
  name: "Domestic Equity Trust",
  tickerSymbol: "DET",
  scope: "country",
  countryId: "US",
  kind: "broad",
  expenseRatioAnnual: 0.01,
  seedCapitalAnchor: 10_000_000,
};
function request(overrides = {}) {
  return new Request("https://example.com/api/index-funds/charter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, ...overrides }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  const memory = createMockDb();
  memory.collection("corporations").findOne.mockResolvedValue({ _id: corpId, userId: owner });
  vi.mocked(getDb).mockResolvedValue(memory as unknown as Db);
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: String(owner) },
  } as Awaited<ReturnType<typeof requireBasicAuth>>);
  vi.mocked(charterFund).mockResolvedValue({
    ok: true,
    fundId: new ObjectId(),
    slug: "sponsored-det",
  });
});

describe("fund creation permissions", () => {
  it("requires authentication before loading or creating a fund", async () => {
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as Awaited<ReturnType<typeof requireBasicAuth>>);
    expect((await POST(request())).status).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
    expect(charterFund).not.toHaveBeenCalled();
  });
  it.each([false, true])("refuses a non-CEO or vacant CEO seat (vacant: %s)", async (vacant) => {
    const memory = createMockDb();
    memory.collection("corporations").findOne.mockResolvedValue({
      _id: corpId,
      userId: vacant ? owner : new ObjectId(),
      ceoVacant: vacant,
    });
    vi.mocked(getDb).mockResolvedValue(memory as unknown as Db);
    expect((await POST(request())).status).toBe(403);
    expect(charterFund).not.toHaveBeenCalled();
  });
  it("allows the owner through to the accounting shell with the parsed contract", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(charterFund).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        currentTurn: 1,
        seedCapitalAnchor: body.seedCapitalAnchor,
        kind: "broad",
      })
    );
  });
  it("does not expose unimplemented asset modes through this creation route", async () => {
    expect((await POST(request({ kind: "bond" }))).status).toBe(400);
    expect(charterFund).not.toHaveBeenCalled();
  });
});
