import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  ACTIVE_PRODUCT_INDEX_NAME,
  createAsyncIterableCursor,
  createMockDb,
  type MockDb,
} from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));

import { GET, POST } from "./route";

const corpId = new ObjectId();
const CORP_ID = corpId.toString();

function postRequest(body: unknown) {
  return new Request("http://localhost/api/corporations/601/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

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
    corporation: { _id: corpId, userId: "ceo-user", type: "media" },
  } as never);
  vi.mocked(requireCeo).mockReturnValue(null);
}

async function setCorporationType(type: "media" | "manufacturing" | "retail") {
  const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: { _id: corpId, userId: "ceo-user", type },
  } as never);
}

async function denyCeo() {
  const { requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(requireCeo).mockReturnValue(
    Response.json({ error: "Only the CEO can perform this action" }, { status: 403 }) as never
  );
}

function flagOn() {
  db.collection("gameConfig");
  db.collectionMocks.gameConfig.findOne.mockResolvedValue({ corporationProductsEnabled: true });
}

function flagOff() {
  db.collection("gameConfig");
  db.collectionMocks.gameConfig.findOne.mockResolvedValue({});
}

function ownedModels(models: string[]) {
  db.collection("corporationOperatingModels");
  db.collectionMocks.corporationOperatingModels.find.mockReturnValue(
    createAsyncIterableCursor(
      models.map((operatingModel) => ({
        _id: `${CORP_ID}:${operatingModel}`,
        corporationId: CORP_ID,
        operatingModel,
        acquiredTurn: 100,
      }))
    )
  );
}

function activeProduct(doc: unknown) {
  db.collection("corporationProducts");
  db.collectionMocks.corporationProducts.findOne.mockResolvedValue(doc);
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  await authAsCeo();
});

describe("GET corporation products", () => {
  it("returns 401 without authentication", async () => {
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as never);

    const response = await GET(new Request("http://localhost/api/corporations/601/products"), {
      params: Promise.resolve({ id: "601" }),
    });
    expect(response.status).toBe(401);
  });

  it("stays neutral while the flag is off without touching product collections", async () => {
    flagOff();
    const response = await GET(new Request("http://localhost/api/corporations/601/products"), {
      params: Promise.resolve({ id: "601" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      enabled: false,
      family: "media_entertainment",
      isCeo: true,
      operatingModels: [],
      activeProduct: null,
      catalog: [],
    });
    expect(db.collection).not.toHaveBeenCalledWith("corporationProducts");
    expect(db.collection).not.toHaveBeenCalledWith("corporationOperatingModels");
  });

  it("reports a non-CEO viewer without blocking the read", async () => {
    flagOn();
    ownedModels([]);
    activeProduct(null);
    await denyCeo();

    const response = await GET(new Request("http://localhost/api/corporations/601/products"), {
      params: Promise.resolve({ id: "601" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.isCeo).toBe(false);
  });

  it("lists several owned operating models and the active product", async () => {
    flagOn();
    ownedModels(["newspaper", "television_network", "radio_network"]);
    activeProduct({
      _id: "product-1",
      id: "product-1",
      corporationId: CORP_ID,
      kindId: "news_story",
      name: "Evening Edition",
      stage: "development",
      startedTurn: 100,
      activeCorporationId: CORP_ID,
    });

    const response = await GET(new Request("http://localhost/api/corporations/601/products"), {
      params: Promise.resolve({ id: "601" }),
    });
    const body = await response.json();

    expect(body.operatingModels).toEqual(["newspaper", "television_network", "radio_network"]);
    expect(body.activeProduct).toMatchObject({
      id: "product-1",
      kindLabel: "News Story",
      name: "Evening Edition",
      stage: "development",
    });
    expect(body.activeProduct).not.toHaveProperty("activeCorporationId");
  });

  it("filters the media catalog to the owned operating models", async () => {
    flagOn();
    ownedModels(["radio_network"]);
    activeProduct(null);

    const response = await GET(
      new Request("http://localhost/api/corporations/601/products?family=media_entertainment"),
      { params: Promise.resolve({ id: "601" }) }
    );
    const body = await response.json();

    expect(body.catalog.map((kind: { id: string }) => kind.id)).toEqual([
      "news_story",
      "radio_program",
    ]);
  });

  it("rejects an unknown family", async () => {
    flagOn();
    const response = await GET(
      new Request("http://localhost/api/corporations/601/products?family=corner_shop"),
      { params: Promise.resolve({ id: "601" }) }
    );
    expect(response.status).toBe(400);
  });
});

describe("POST corporation products", () => {
  it("returns 401 without authentication and writes nothing", async () => {
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as never);

    const response = await POST(postRequest({ kindId: "truck", name: "Hauler" }), {
      params: Promise.resolve({ id: "601" }),
    });
    expect(response.status).toBe(401);
  });

  it("blocks a non-CEO start without touching the products collection", async () => {
    await denyCeo();
    const response = await POST(postRequest({ kindId: "truck", name: "Hauler" }), {
      params: Promise.resolve({ id: "601" }),
    });

    expect(response.status).toBe(403);
    expect(db.collection).not.toHaveBeenCalledWith("corporationProducts");
  });

  it("gates the mutation while the flag is off", async () => {
    flagOff();
    const response = await POST(postRequest({ kindId: "truck", name: "Hauler" }), {
      params: Promise.resolve({ id: "601" }),
    });

    expect(response.status).toBe(403);
    expect(db.collection).not.toHaveBeenCalledWith("corporationProducts");
  });

  it("rejects unknown kinds and short names", async () => {
    flagOn();

    const unknown = await POST(postRequest({ kindId: "bus", name: "Hauler" }), {
      params: Promise.resolve({ id: "601" }),
    });
    expect(unknown.status).toBe(400);

    const short = await POST(postRequest({ kindId: "truck", name: "X" }), {
      params: Promise.resolve({ id: "601" }),
    });
    expect(short.status).toBe(400);
    expect(db.collection).not.toHaveBeenCalledWith("corporationProducts");
  });

  it("refuses a media product the corporation has no model for", async () => {
    flagOn();
    ownedModels([]);
    const response = await POST(postRequest({ kindId: "news_story", name: "Edition" }), {
      params: Promise.resolve({ id: "601" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("not legal"),
    });
    expect(db.collection).not.toHaveBeenCalledWith("corporationProducts");
  });

  it("starts a legal product for an owned operating model", async () => {
    flagOn();
    ownedModels(["television_network"]);
    db.collection("corporationProducts");
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 120 });

    const response = await POST(postRequest({ kindId: "television_show", name: "Nightly" }), {
      params: Promise.resolve({ id: "601" }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.product).toMatchObject({
      corporationId: CORP_ID,
      kindId: "television_show",
      kindLabel: "Television Show",
      name: "Nightly",
      stage: "development",
      startedTurn: 120,
    });
    expect(db.collectionMocks.corporationProducts.insertOne).toHaveBeenCalledTimes(1);
  });

  it("returns 409 when a second product contends for the one slot", async () => {
    await setCorporationType("manufacturing");
    flagOn();
    ownedModels([]);
    db.collection("corporationProducts");
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 120 });
    db.collectionMocks.corporationProducts.insertOne.mockRejectedValue(
      Object.assign(
        new Error(
          `E11000 duplicate key error collection: test.corporationProducts index: ${ACTIVE_PRODUCT_INDEX_NAME} dup key`
        ),
        { code: 11000, keyPattern: { activeCorporationId: 1 } }
      )
    );

    const response = await POST(postRequest({ kindId: "truck", name: "Hauler" }), {
      params: Promise.resolve({ id: "601" }),
    });

    expect(response.status).toBe(409);
  });

  it("rejects a product from another sector family", async () => {
    flagOn();
    await setCorporationType("retail");

    const response = await POST(postRequest({ kindId: "truck", name: "Hauler" }), {
      params: Promise.resolve({ id: "601" }),
    });

    expect(response.status).toBe(400);
    expect(db.collection).not.toHaveBeenCalledWith("corporationProducts");
  });
});
