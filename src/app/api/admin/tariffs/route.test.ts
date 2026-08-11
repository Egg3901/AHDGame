import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  // Pre-initialize collections
  db.collection("tariffs");
});

async function setup() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as any);
}

function makeAdmin(adminId?: ObjectId) {
  return { ok: true, admin: { userId: (adminId ?? new ObjectId()).toString(), isAdmin: true } };
}

describe("GET /api/admin/tariffs", () => {
  it("returns 401/403 when not admin", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as never);

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/admin/tariffs?countryId=US");
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 when countryId is missing", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/admin/tariffs");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns tariffs for the specified country", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    const tariffs = [
      {
        _id: new ObjectId(),
        countryId: "US",
        scopeType: "sector",
        targetSectorType: "energy",
        rate: 15,
      },
      { _id: new ObjectId(), countryId: "US", scopeType: "economy_wide", rate: 5 },
    ];
    db.collectionMocks.tariffs.find.mockReturnValue({ toArray: async () => tariffs });

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/admin/tariffs?countryId=US");
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.tariffs).toHaveLength(2);
    expect(db.collectionMocks.tariffs.find).toHaveBeenCalledWith({ countryId: "US" });
  });
});

describe("POST /api/admin/tariffs", () => {
  it("returns 401/403 when not admin", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/admin/tariffs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ countryId: "US", scopeType: "sector", rate: 10 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("upserts economy_wide tariff", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    db.collectionMocks.tariffs.updateOne.mockResolvedValue({ modifiedCount: 1, upsertedCount: 1 });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/admin/tariffs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ countryId: "US", scopeType: "economy_wide", rate: 10 }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(db.collectionMocks.tariffs.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        countryId: "US",
        scopeType: "economy_wide",
        targetSectorType: null,
        targetOriginCountryId: null,
        targetCorporationId: null,
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ rate: 10 }),
      }),
      { upsert: true }
    );
  });

  it("upserts sector-specific tariff", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    db.collectionMocks.tariffs.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/admin/tariffs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        countryId: "US",
        scopeType: "sector",
        targetSectorType: "energy",
        rate: 25,
      }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it("upserts origin country tariff", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    db.collectionMocks.tariffs.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/admin/tariffs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        countryId: "US",
        scopeType: "origin_country",
        targetOriginCountryId: "UK",
        rate: 30,
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(db.collectionMocks.tariffs.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ targetOriginCountryId: "UK" }),
      expect.anything(),
      { upsert: true }
    );
  });

  it("upserts corporation-specific tariff", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    const corpId = new ObjectId().toString();
    db.collectionMocks.tariffs.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/admin/tariffs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        countryId: "US",
        scopeType: "corporation",
        targetCorporationId: corpId,
        rate: 50,
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(db.collectionMocks.tariffs.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ targetCorporationId: new ObjectId(corpId) }),
      expect.anything(),
      { upsert: true }
    );
  });

  it("validates rate is between 0 and 100", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/admin/tariffs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ countryId: "US", scopeType: "sector", rate: 150 }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/admin/tariffs", () => {
  it("returns 401/403 when not admin", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as never);

    const { DELETE } = await import("./route");
    const req = new Request("http://localhost/api/admin/tariffs?id=123456789012345678901234");
    const res = await DELETE(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 when tariff id is missing", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    const { DELETE } = await import("./route");
    const req = new Request("http://localhost/api/admin/tariffs");
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when tariff id is invalid", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    const { DELETE } = await import("./route");
    const req = new Request("http://localhost/api/admin/tariffs?id=invalid");
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when tariff not found", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    db.collectionMocks.tariffs.deleteOne.mockResolvedValue({ deletedCount: 0 });

    const { DELETE } = await import("./route");
    const req = new Request(`http://localhost/api/admin/tariffs?id=${new ObjectId().toString()}`);
    const res = await DELETE(req);
    expect(res.status).toBe(404);
  });

  it("deletes tariff successfully", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue(makeAdmin() as never);

    const tariffId = new ObjectId();
    db.collectionMocks.tariffs.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const { DELETE } = await import("./route");
    const req = new Request(`http://localhost/api/admin/tariffs?id=${tariffId.toString()}`);
    const res = await DELETE(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(db.collectionMocks.tariffs.deleteOne).toHaveBeenCalledWith({ _id: tariffId });
  });
});
