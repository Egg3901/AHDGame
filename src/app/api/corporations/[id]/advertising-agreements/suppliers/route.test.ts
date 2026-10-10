import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/advertising/featureFlag", () => ({
  isAdvertisingAgreementsEnabled: vi.fn(),
}));
vi.mock("@/lib/advertising/suppliers", () => ({
  listAdvertisingSuppliers: vi.fn(),
}));

import { GET } from "./route";

let db: MockDb;
const corporation = { _id: "supplier-id", userId: "ceo-user" };

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: "ceo-user" },
  } as never);
  const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation } as never);
  vi.mocked(requireCeo).mockReturnValue(null);
  const { isAdvertisingAgreementsEnabled } = await import("@/lib/advertising/featureFlag");
  vi.mocked(isAdvertisingAgreementsEnabled).mockResolvedValue(true);
  const { listAdvertisingSuppliers } = await import("@/lib/advertising/suppliers");
  vi.mocked(listAdvertisingSuppliers).mockResolvedValue({
    buyerMarketingPerTurnAnchor: 0,
    liquidCurrencyCode: null,
    suppliers: [],
  });
});

describe("GET advertising suppliers", () => {
  it("passes the resolved world year to supplier eligibility", async () => {
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentYear: 1949,
    });

    const response = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "supplier-id" }),
    });

    expect(response.status).toBe(200);
    const { listAdvertisingSuppliers } = await import("@/lib/advertising/suppliers");
    expect(listAdvertisingSuppliers).toHaveBeenCalledWith(db, corporation, 1949);
  });

  it("derives the year from the existing turn clock when currentYear is absent", async () => {
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 1,
      startingYear: 1949,
    });

    const response = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "supplier-id" }),
    });

    expect(response.status).toBe(200);
    const { listAdvertisingSuppliers } = await import("@/lib/advertising/suppliers");
    expect(listAdvertisingSuppliers).toHaveBeenCalledWith(db, corporation, 1949);
  });
});
