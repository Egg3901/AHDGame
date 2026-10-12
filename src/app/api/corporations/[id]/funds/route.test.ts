import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { makeCorporation } from "@/lib/test-utils/factories";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { isIndexFundsEnabled } from "@/lib/indexFunds/featureFlag";
import { listFundsBySponsor } from "@/lib/indexFunds/fundQueries";
import { GET } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/indexFunds/featureFlag", () => ({ isIndexFundsEnabled: vi.fn() }));
vi.mock("@/lib/indexFunds/fundQueries", () => ({ listFundsBySponsor: vi.fn() }));
vi.mock("@/lib/currency/corporationCapital", () => ({
  getCorpFxRate: vi.fn().mockResolvedValue(2),
  anchorToCorpLiquidCapital: (amount: number, _corp: unknown, rate: number) => amount * rate,
}));

let db: MockDb;
let corp: ReturnType<typeof makeCorporation>;
beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  corp = makeCorporation({ liquidCapital: 30_000_000, liquidCurrencyCode: "USD" });
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  vi.mocked(getAuthUser).mockResolvedValue({ userId: String(corp.userId) } as never);
  vi.mocked(isIndexFundsEnabled).mockResolvedValue(true);
  vi.mocked(listFundsBySponsor).mockResolvedValue([]);
  db.collection("corporations").findOne.mockImplementation(async () => corp);
  db.collection("gameConfig").findOne.mockResolvedValue({ playerFundSponsorshipEnabled: true });
  db.collection("corporateSectors")
    .find()
    .toArray.mockResolvedValue([{ sectorType: "financial" }]);
});
async function read() {
  const res = await GET(new Request("http://localhost/api/corporations/1/funds"), {
    params: Promise.resolve({ id: String(corp._id) }),
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toContain("no-store");
  return res.json();
}
describe("fund creation capability", () => {
  it("allows a funded eligible CEO", async () => {
    expect((await read()).canCreate).toBe(true);
  });
  it("denies spectators and vacant CEO seats", async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ userId: String(new ObjectId()) } as never);
    expect((await read()).canCreate).toBe(false);
    vi.mocked(getAuthUser).mockResolvedValue({ userId: String(corp.userId) } as never);
    corp.ceoVacant = true;
    expect((await read()).canCreate).toBe(false);
  });
  it("denies creation when sponsorship, funds or corporation actions are disabled", async () => {
    db.collection("gameConfig").findOne.mockResolvedValue({ playerFundSponsorshipEnabled: false });
    expect((await read()).canCreate).toBe(false);
    db.collection("gameConfig").findOne.mockResolvedValue({ playerFundSponsorshipEnabled: true });
    vi.mocked(isIndexFundsEnabled).mockResolvedValue(false);
    expect((await read()).canCreate).toBe(false);
    vi.mocked(isIndexFundsEnabled).mockResolvedValue(true);
    db.collection("gameState").findOne.mockResolvedValue({ corporationActionsPaused: true });
    expect((await read()).canCreate).toBe(false);
  });
  it("denies active banks, corporations without a finance sector and insufficient local cash", async () => {
    corp.bankCharter = { status: "active" } as never;
    expect((await read()).canCreate).toBe(false);
    delete corp.bankCharter;
    db.collection("corporateSectors")
      .find()
      .toArray.mockResolvedValue([{ sectorType: "manufacturing" }]);
    expect((await read()).canCreate).toBe(false);
    db.collection("corporateSectors")
      .find()
      .toArray.mockResolvedValue([{ sectorType: "financial" }]);
    corp.liquidCapital = 24_999_999;
    expect((await read()).canCreate).toBe(false);
  });
});
