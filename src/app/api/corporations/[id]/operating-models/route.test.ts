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
    corporation: { _id: corpId, userId: "ceo-user", type: "media" },
  } as never);
  vi.mocked(requireCeo).mockReturnValue(null);
}

function flagOn() {
  db.collection("gameConfig");
  db.collectionMocks.gameConfig.findOne.mockResolvedValue({ corporationProductsEnabled: true });
}

function request() {
  return new Request("http://localhost/api/corporations/601/operating-models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operatingModel: "newspaper" }),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  await authAsCeo();
});

describe("POST corporation operating models", () => {
  it("returns 401 without authentication", async () => {
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as never);

    const response = await POST(request(), { params: Promise.resolve({ id: "601" }) });
    expect(response.status).toBe(401);
  });

  it("blocks a non-CEO add without writing", async () => {
    const { requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(requireCeo).mockReturnValue(
      Response.json({ error: "Only the CEO can perform this action" }, { status: 403 }) as never
    );

    const response = await POST(request(), { params: Promise.resolve({ id: "601" }) });

    expect(response.status).toBe(403);
    expect(db.collection).not.toHaveBeenCalledWith("corporationOperatingModels");
  });

  it("gates the mutation while the flag is off", async () => {
    db.collection("gameConfig");
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({});

    const response = await POST(request(), { params: Promise.resolve({ id: "601" }) });

    expect(response.status).toBe(403);
    expect(db.collection).not.toHaveBeenCalledWith("corporationOperatingModels");
  });

  it("rejects an unknown operating model", async () => {
    flagOn();
    const response = await POST(
      new Request("http://localhost/api/corporations/601/operating-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatingModel: "printing_press" }),
      }),
      { params: Promise.resolve({ id: "601" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.legalOperatingModels).toContain("newspaper");
    expect(db.collection).not.toHaveBeenCalledWith("corporationOperatingModels");
  });

  it("adds a legal media operating model", async () => {
    flagOn();
    db.collection("corporationOperatingModels");
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 120 });

    const response = await POST(request(), { params: Promise.resolve({ id: "601" }) });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      success: true,
      model: { operatingModel: "newspaper", acquiredTurn: 120 },
    });
    const [doc] = db.collectionMocks.corporationOperatingModels.insertOne.mock.calls[0];
    expect(doc).toMatchObject({ corporationId: CORP_ID, operatingModel: "newspaper" });
  });

  it("treats re-adding an owned model as an idempotent success", async () => {
    flagOn();
    db.collection("corporationOperatingModels");
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 120 });
    const stored = {
      _id: `${CORP_ID}:newspaper`,
      corporationId: CORP_ID,
      operatingModel: "newspaper",
      acquiredTurn: 100,
    };
    db.collectionMocks.corporationOperatingModels.insertOne.mockRejectedValue(
      Object.assign(new Error("E11000 duplicate key error"), { code: 11000 })
    );
    db.collectionMocks.corporationOperatingModels.findOne.mockResolvedValue(stored);

    const response = await POST(request(), { params: Promise.resolve({ id: "601" }) });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ success: true, idempotent: true });
  });
});
