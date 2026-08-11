import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("extractionContracts");
  db.collection("corporations");
  db.collection("states");
  db.collection("gameState");
});

async function setup() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
}

function makeAdmin() {
  return { ok: true, admin: { userId: new ObjectId().toString(), isAdmin: true } };
}

function makeForbidden() {
  return {
    ok: false,
    response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
  };
}

// ─── GET /api/contracts/extraction ───────────────────────────────────────────

describe("GET /api/contracts/extraction", () => {
  it("returns empty contracts array when none exist", async () => {
    await setup();
    db.collectionMocks.extractionContracts.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.corporations.find.mockReturnValue({ toArray: async () => [] });

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/contracts/extraction"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.contracts).toEqual([]);
  });

  it("returns contracts with corporationName enriched", async () => {
    await setup();
    const corpId = new ObjectId();
    const contract = {
      _id: new ObjectId(),
      stateId: "TX",
      countryId: "US",
      corporationId: corpId,
      resource: "oil",
      share: 0.5,
      grantedTurn: 10,
      grantedBy: "US",
      grantedByLevel: "national",
      updatedAt: new Date(),
    };
    db.collectionMocks.extractionContracts.find.mockReturnValue({
      toArray: async () => [contract],
    });
    db.collectionMocks.corporations.find.mockReturnValue({
      toArray: async () => [{ _id: corpId, name: "Acme Oil Corp" }],
    });

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/contracts/extraction"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.contracts).toHaveLength(1);
    expect(json.contracts[0].corporationName).toBe("Acme Oil Corp");
    expect(json.contracts[0].corporationId).toBe(corpId.toString());
  });

  it("filters by countryId query param", async () => {
    await setup();
    db.collectionMocks.extractionContracts.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.corporations.find.mockReturnValue({ toArray: async () => [] });

    const { GET } = await import("./route");
    await GET(new Request("http://localhost/api/contracts/extraction?countryId=UK"));

    expect(db.collectionMocks.extractionContracts.find).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: "UK", revokedTurn: { $exists: false } })
    );
  });

  it("filters by stateId query param", async () => {
    await setup();
    db.collectionMocks.extractionContracts.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.corporations.find.mockReturnValue({ toArray: async () => [] });

    const { GET } = await import("./route");
    await GET(new Request("http://localhost/api/contracts/extraction?stateId=TX"));

    expect(db.collectionMocks.extractionContracts.find).toHaveBeenCalledWith(
      expect.objectContaining({ stateId: "TX" })
    );
  });
});

// ─── POST /api/contracts/extraction ──────────────────────────────────────────

describe("POST /api/contracts/extraction", () => {
  it("returns 403 when not admin", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeForbidden() as never);

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/contracts/extraction", {
        method: "POST",
        body: JSON.stringify({
          stateId: "TX",
          countryId: "US",
          corporationId: "a".repeat(24),
          resource: "oil",
          share: 0.5,
          grantedBy: "US",
          grantedByLevel: "national",
        }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 for missing required fields", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/contracts/extraction", {
        method: "POST",
        body: JSON.stringify({ stateId: "TX" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid resource enum", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/contracts/extraction", {
        method: "POST",
        body: JSON.stringify({
          stateId: "TX",
          countryId: "US",
          corporationId: "a".repeat(24),
          resource: "diamonds",
          share: 0.5,
          grantedBy: "US",
          grantedByLevel: "national",
        }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 409 needsConfirmation when over-allocated without force", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    // Existing contracts sum to 0.8 — adding 0.5 would over-allocate
    const existing = [{ _id: new ObjectId(), share: 0.8 }];
    db.collectionMocks.extractionContracts.find.mockReturnValue({ toArray: async () => existing });

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/contracts/extraction", {
        method: "POST",
        body: JSON.stringify({
          stateId: "TX",
          countryId: "US",
          corporationId: "a".repeat(24),
          resource: "oil",
          share: 0.5,
          grantedBy: "US",
          grantedByLevel: "national",
        }),
      })
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.overAllocated).toBe(true);
    expect(json.needsConfirmation).toBe(true);
    expect(db.collectionMocks.extractionContracts.insertOne).not.toHaveBeenCalled();
  });

  it("inserts contract when over-allocated with force:true", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    const existing = [{ _id: new ObjectId(), share: 0.8 }];
    db.collectionMocks.extractionContracts.find.mockReturnValue({ toArray: async () => existing });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 5 });
    db.collectionMocks.states.findOne.mockResolvedValue({ _id: "TX", countryId: "US" });
    const insertedId = new ObjectId();
    db.collectionMocks.extractionContracts.insertOne.mockResolvedValue({ insertedId });

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/contracts/extraction", {
        method: "POST",
        body: JSON.stringify({
          stateId: "TX",
          countryId: "US",
          corporationId: "a".repeat(24),
          resource: "oil",
          share: 0.5,
          grantedBy: "US",
          grantedByLevel: "national",
          force: true,
        }),
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.contractId).toBe(insertedId.toString());
    expect(db.collectionMocks.extractionContracts.insertOne).toHaveBeenCalledOnce();
  });

  it("inserts contract when not over-allocated", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    db.collectionMocks.extractionContracts.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 1 });
    db.collectionMocks.states.findOne.mockResolvedValue({ _id: "TX", countryId: "US" });
    const insertedId = new ObjectId();
    db.collectionMocks.extractionContracts.insertOne.mockResolvedValue({ insertedId });

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/contracts/extraction", {
        method: "POST",
        body: JSON.stringify({
          stateId: "TX",
          countryId: "US",
          corporationId: "a".repeat(24),
          resource: "coal",
          share: 0.3,
          grantedBy: "US",
          grantedByLevel: "national",
        }),
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(db.collectionMocks.extractionContracts.insertOne).toHaveBeenCalledOnce();
  });
});

// ─── DELETE /api/contracts/extraction/[id] ────────────────────────────────────

describe("DELETE /api/contracts/extraction/[id]", () => {
  it("returns 403 when not admin", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeForbidden() as never);

    const { DELETE } = await import("./[id]/route");
    const id = new ObjectId().toString();
    const res = await DELETE(new Request(`http://localhost/api/contracts/extraction/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid ObjectId", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 5 });

    const { DELETE } = await import("./[id]/route");
    const res = await DELETE(new Request("http://localhost/api/contracts/extraction/not-an-id"), {
      params: Promise.resolve({ id: "not-an-id" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when contract not found or already revoked", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 5 });
    db.collectionMocks.extractionContracts.updateOne.mockResolvedValue({ matchedCount: 0 });

    const { DELETE } = await import("./[id]/route");
    const id = new ObjectId().toString();
    const res = await DELETE(new Request(`http://localhost/api/contracts/extraction/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(404);
  });

  it("soft-deletes contract by setting revokedTurn", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 7 });
    db.collectionMocks.extractionContracts.updateOne.mockResolvedValue({ matchedCount: 1 });

    const { DELETE } = await import("./[id]/route");
    const id = new ObjectId().toString();
    const res = await DELETE(new Request(`http://localhost/api/contracts/extraction/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    const json = await (res as unknown as Response).json();
    expect(json.success).toBe(true);
    expect(db.collectionMocks.extractionContracts.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ revokedTurn: { $exists: false } }),
      expect.objectContaining({ $set: expect.objectContaining({ revokedTurn: 7 }) })
    );
  });
});
