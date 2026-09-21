import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));

import { POST } from "./route";

const corpId = new ObjectId();
const CORP_ID = corpId.toString();

let db: MockDb;

async function authAsCeo() {
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: "ceo-user" },
  } as never);
  const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: { _id: corpId, userId: "ceo-user" },
  } as never);
  vi.mocked(requireCeo).mockReturnValue(null);
}

function flagOn() {
  db.collection("gameConfig");
  db.collectionMocks.gameConfig.findOne.mockResolvedValue({ corporationProductsEnabled: true });
}

function request(productId: string) {
  return new Request(`http://localhost/api/corporations/601/products/${productId}/retire`, {
    method: "POST",
  });
}

function activeDoc() {
  return {
    _id: "product-1",
    id: "product-1",
    corporationId: CORP_ID,
    kindId: "truck",
    name: "Hauler",
    stage: "development",
    startedTurn: 100,
    activeCorporationId: CORP_ID,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  await authAsCeo();
});

describe("POST retire corporation product", () => {
  it("returns 401 without authentication", async () => {
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as never);

    const response = await POST(request("product-1"), {
      params: Promise.resolve({ id: "601", productId: "product-1" }),
    });
    expect(response.status).toBe(401);
  });

  it("blocks a non-CEO retire without writing", async () => {
    const { requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(requireCeo).mockReturnValue(
      Response.json({ error: "Only the CEO can perform this action" }, { status: 403 }) as never
    );

    const response = await POST(request("product-1"), {
      params: Promise.resolve({ id: "601", productId: "product-1" }),
    });

    expect(response.status).toBe(403);
    expect(db.collection).not.toHaveBeenCalledWith("corporationProducts");
  });

  it("gates the mutation while the flag is off", async () => {
    db.collection("gameConfig");
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({});

    const response = await POST(request("product-1"), {
      params: Promise.resolve({ id: "601", productId: "product-1" }),
    });

    expect(response.status).toBe(403);
    expect(db.collection).not.toHaveBeenCalledWith("corporationProducts");
  });

  it("returns 404 when the product belongs to another corporation", async () => {
    flagOn();
    db.collection("corporationProducts");
    db.collectionMocks.corporationProducts.findOne.mockResolvedValue({
      ...activeDoc(),
      corporationId: "other-corp",
    });

    const response = await POST(request("product-1"), {
      params: Promise.resolve({ id: "601", productId: "product-1" }),
    });

    expect(response.status).toBe(404);
    expect(db.collectionMocks.corporationProducts.updateOne).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing product", async () => {
    flagOn();
    db.collection("corporationProducts");
    db.collectionMocks.corporationProducts.findOne.mockResolvedValue(null);

    const response = await POST(request("missing"), {
      params: Promise.resolve({ id: "601", productId: "missing" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns 409 when the product is already retired", async () => {
    flagOn();
    db.collection("corporationProducts");
    db.collectionMocks.corporationProducts.findOne.mockResolvedValue({
      ...activeDoc(),
      stage: "retired",
    });
    db.collectionMocks.corporationProducts.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const response = await POST(request("product-1"), {
      params: Promise.resolve({ id: "601", productId: "product-1" }),
    });

    expect(response.status).toBe(409);
  });

  it("retires the corporation's own product", async () => {
    flagOn();
    db.collection("corporationProducts");
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 130 });
    const retired = { ...activeDoc(), stage: "retired", retiredTurn: 130 };
    delete (retired as { activeCorporationId?: string }).activeCorporationId;
    db.collectionMocks.corporationProducts.findOne
      .mockResolvedValueOnce(activeDoc())
      .mockResolvedValueOnce(retired);
    db.collectionMocks.corporationProducts.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });

    const response = await POST(request("product-1"), {
      params: Promise.resolve({ id: "601", productId: "product-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      product: {
        id: "product-1",
        kindLabel: "Truck",
        name: "Hauler",
        stage: "retired",
        retiredTurn: 130,
      },
    });
  });
});
