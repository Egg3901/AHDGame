/**
 * Bug #0728: CEO salary may not exceed 1.25x daily gross revenue at set time,
 * and the check must run even when gross revenue is zero (a zero-revenue shell
 * cannot set any positive salary). Guards the bond→salary→abandon mint exploit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 100 }),
}));

let db: MockDb;
const corpId = new ObjectId();

function makeCorp(overrides: Record<string, unknown> = {}) {
  return {
    _id: corpId,
    name: "TestCorp",
    marketingBudget: 0,
    logisticsBudget: 0,
    rdBudget: 0,
    ceoSalary: 0,
    type: "manufacturing",
    secondaryType: null,
    imfBailoutActive: false,
    ...overrides,
  };
}

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

async function callUpdate(body: Record<string, unknown>, sectorRevenueTotal: number) {
  db = createMockDb();
  db.collection("corporateSectors");
  db.collection("corporations");
  db.collectionMocks["corporateSectors"]!.find.mockReturnValue(
    makeCursor(sectorRevenueTotal > 0 ? [{ revenue: sectorRevenueTotal }] : []) as never
  );

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString() },
  } as never);
  const { checkRateLimit } = await import("@/lib/api/rateLimit");
  vi.mocked(checkRateLimit).mockReturnValue({ ok: true } as never);
  const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: makeCorp(),
  } as never);
  vi.mocked(requireCeo).mockReturnValue(null as never);

  const { updateCorporationSettings } = await import("./updateCorporationSettings");
  const req = new Request("http://localhost/api/corporations/x/settings", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return updateCorporationSettings(req, { params: Promise.resolve({ id: corpId.toString() }) });
}

describe("updateCorporationSettings — CEO salary revenue cap (Bug #0728)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects CEO salary above 1.25x daily gross revenue", async () => {
    const res = await callUpdate({ ceoSalary: 20_000 }, 10_000); // cap = 12_500
    expect(res.status).toBe(400);
  });

  it("rejects any positive CEO salary when gross revenue is zero", async () => {
    const res = await callUpdate({ ceoSalary: 1 }, 0); // cap = 0
    expect(res.status).toBe(400);
  });

  it("accepts CEO salary at or below 1.25x daily gross revenue", async () => {
    const res = await callUpdate({ ceoSalary: 12_500 }, 10_000); // cap = 12_500
    expect(res.status).toBe(200);
  });
});
