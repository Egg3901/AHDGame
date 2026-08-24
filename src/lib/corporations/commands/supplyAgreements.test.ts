import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/market/featureFlag", () => ({
  getMarketSystemModeForDb: vi.fn().mockResolvedValue("plants"),
  marketAtLeast: vi.fn().mockReturnValue(true),
}));

let db: MockDb;
const supplierId = new ObjectId();

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("supplyAgreements");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: "user1" },
  } as never);

  const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: { _id: supplierId, userId: "user1" },
  } as never);
  vi.mocked(requireCeo).mockReturnValue(null);
});

describe("proposeSupplyAgreement", () => {
  it("rejects freight because corporation-wide agreements have no state identity", async () => {
    const { proposeSupplyAgreement } = await import("./supplyAgreements");
    const response = await proposeSupplyAgreement(
      new Request("http://localhost/api/corporations/supplier/supply-agreements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          buyerCorpId: new ObjectId().toString(),
          commodity: "freight",
          volumeCap: 100,
          pricePremium: 0,
        }),
      }),
      supplierId.toString()
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("state");
    expect(db.collectionMocks.supplyAgreements.insertOne).not.toHaveBeenCalled();
  });
});
