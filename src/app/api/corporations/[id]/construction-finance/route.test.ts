import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { makeCorporation } from "@/lib/test-utils/factories";
import { getDb } from "@/lib/mongodb";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { GET } from "./route";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn().mockResolvedValue({ ok: true, user: { userId: "ceo" } }),
}));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn().mockReturnValue(null),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCeo).mockReturnValue(null);
});
function setup(enabled = true) {
  const memory = createInMemoryDb();
  const corporation = makeCorporation({ _id: new ObjectId(), liquidCurrencyCode: "USD" });
  memory.seed("gameConfig", [
    {
      _id: "default",
      privateBankingEnabled: true,
      treasuryCashLedgerEnabled: true,
      bankConstructionFinanceEnabled: enabled,
    },
  ]);
  memory.seed("centralBanks", [{ _id: "US", primeRate: 3 }]);
  memory.seed("corporations", [
    {
      _id: corporation._id,
      name: "Borrower bank",
      bankCharter: {
        type: "retail",
        status: "active",
        currency: "USD",
        depositOffset: -1,
        lendingOffset: 2,
      },
    },
    {
      _id: new ObjectId(),
      name: "Eligible investment lender",
      bankCharter: {
        type: "investment",
        status: "active",
        currency: "USD",
        depositOffset: -1,
        lendingOffset: 2,
        requireApproval: true,
      },
    },
    {
      _id: new ObjectId(),
      name: "Wrong currency",
      bankCharter: { type: "retail", status: "active", currency: "GBP", lendingOffset: 2 },
    },
    {
      _id: new ObjectId(),
      name: "Failed bank",
      bankCharter: { type: "retail", status: "failed", currency: "USD", lendingOffset: 2 },
    },
    {
      _id: new ObjectId(),
      name: "Busy bank",
      bankCharter: { type: "retail", status: "active", currency: "USD", lendingOffset: 2 },
      bankConstructionFunding: { loanId: "other" },
    },
  ]);
  vi.mocked(getDb).mockResolvedValue(memory as unknown as Db);
  vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation });
  const call = () =>
    GET(new Request("http://localhost/api/corporations/1/construction-finance"), {
      params: Promise.resolve({ id: "1" }),
    });
  return { memory, call };
}
describe("construction lender quotes", () => {
  it("performs no corporation, lender or rate read while disabled", async () => {
    const { memory, call } = setup(false);
    const collection = vi.spyOn(memory, "collection");
    const response = await call();
    expect(await response.json()).toEqual({ enabled: false });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(collection.mock.calls.map(([name]) => name)).toEqual(["gameConfig"]);
    expect(resolveCorporation).not.toHaveBeenCalled();
  });
  it("quotes current currency prime and admits an eligible investment lender, excluding self/failed/busy banks", async () => {
    const { memory, call } = setup();
    const response = await call();
    expect(await response.json()).toMatchObject({
      enabled: true,
      currency: "USD",
      lenders: [{ name: "Eligible investment lender", ratePercent: 5, approvalRequired: true }],
    });
    memory.collection("centralBanks").docs[0].primeRate = 7;
    expect((await (await call()).json()).lenders[0].ratePercent).toBe(9);
  });
  it("refuses non-CEO readers before lender queries", async () => {
    const { memory, call } = setup();
    vi.mocked(requireCeo).mockReturnValue(new NextResponse(null, { status: 403 }));
    const collection = vi.spyOn(memory, "collection");
    expect((await call()).status).toBe(403);
    expect(collection.mock.calls.map(([name]) => name)).toEqual(["gameConfig"]);
  });
});
