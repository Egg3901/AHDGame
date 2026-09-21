import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createAsyncIterableCursor, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));

import { GET, POST } from "./route";

const buyerId = new ObjectId();
const supplierId = new ObjectId();
const BUYER_ID = buyerId.toString();
const SUPPLIER_ID = supplierId.toString();

const buyerCorp = { _id: buyerId, userId: "ceo-user", type: "manufacturing" };
const supplierCorp = { _id: supplierId, userId: "supplier-user", type: "media" };
const retailCorp = { _id: supplierId, userId: "supplier-user", type: "retail" };

let db: MockDb;

async function authAsCeo() {
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: "ceo-user" },
  } as never);
  const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockImplementation(async (_db: unknown, id: string) => {
    if (id === BUYER_ID) return { ok: true, corporation: { ...buyerCorp } } as never;
    if (id === SUPPLIER_ID) return { ok: true, corporation: { ...supplierCorp } } as never;
    return {
      ok: false,
      response: Response.json({ error: "Corporation not found" }, { status: 404 }),
    } as never;
  });
  vi.mocked(requireCeo).mockReturnValue(null);
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

function turnAt(turn: number) {
  db.collection("gameState");
  db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: turn });
}

function supplierModels(count: number) {
  db.collection("corporationOperatingModels");
  db.collectionMocks.corporationOperatingModels.countDocuments.mockResolvedValue(count);
}

function postRequest(body: unknown) {
  return new Request(`http://localhost/api/corporations/${BUYER_ID}/advertising-agreements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function agreementDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId().toHexString(),
    buyerCorpId: BUYER_ID,
    supplierCorpId: SUPPLIER_ID,
    allocationShareBps: 2500,
    status: "pending",
    proposedByCorpId: BUYER_ID,
    currentOffer: { revision: 1, proposedByCorpId: BUYER_ID, allocationShareBps: 2500 },
    offers: [{ revision: 1, proposedByCorpId: BUYER_ID, allocationShareBps: 2500 }],
    createdAt: new Date("2026-09-21T00:00:00.000Z"),
    updatedAt: new Date("2026-09-21T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  await authAsCeo();
});

describe("GET advertising agreements", () => {
  it("returns 401 without authentication", async () => {
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as never);

    const response = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: BUYER_ID }),
    });
    expect(response.status).toBe(401);
  });

  it("blocks a non-CEO read", async () => {
    await denyCeo();
    const response = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: BUYER_ID }),
    });
    expect(response.status).toBe(403);
  });

  it("refuses the list while the flag is off", async () => {
    flagOff();
    const response = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: BUYER_ID }),
    });
    expect(response.status).toBe(403);
    expect(db.collection).not.toHaveBeenCalledWith("advertisingAgreements");
  });

  it("lists agreements with the viewer role and counterparty", async () => {
    flagOn();
    db.collection("advertisingAgreements");
    db.collectionMocks.advertisingAgreements.find.mockReturnValue(
      createAsyncIterableCursor([agreementDoc({ status: "active" })])
    );
    db.collection("corporations");
    db.collectionMocks.corporations.find.mockReturnValue(
      createAsyncIterableCursor([{ _id: supplierId, name: "Media Co", ticker: "MED" }])
    );

    const response = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: BUYER_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.agreements).toHaveLength(1);
    expect(body.agreements[0]).toMatchObject({
      role: "buyer",
      status: "active",
      allocationShareBps: 2500,
      counterparty: { id: SUPPLIER_ID, name: "Media Co", ticker: "MED" },
    });
  });

  it("returns an empty list when the corporation has no agreements", async () => {
    flagOn();
    const response = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: BUYER_ID }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ agreements: [] });
  });
});

describe("POST advertising agreements", () => {
  it("returns 401 without authentication and writes nothing", async () => {
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as never);

    const response = await POST(
      postRequest({ supplierCorpId: SUPPLIER_ID, allocationShareBps: 2500 }),
      { params: Promise.resolve({ id: BUYER_ID }) }
    );
    expect(response.status).toBe(401);
    expect(db.collection).not.toHaveBeenCalledWith("advertisingAgreements");
  });

  it("blocks a non-CEO proposal without touching agreements", async () => {
    await denyCeo();
    const response = await POST(
      postRequest({ supplierCorpId: SUPPLIER_ID, allocationShareBps: 2500 }),
      { params: Promise.resolve({ id: BUYER_ID }) }
    );
    expect(response.status).toBe(403);
    expect(db.collection).not.toHaveBeenCalledWith("advertisingAgreements");
  });

  it("gates the proposal while the flag is off", async () => {
    flagOff();
    const response = await POST(
      postRequest({ supplierCorpId: SUPPLIER_ID, allocationShareBps: 2500 }),
      { params: Promise.resolve({ id: BUYER_ID }) }
    );
    expect(response.status).toBe(403);
    expect(db.collection).not.toHaveBeenCalledWith("advertisingAgreements");
  });

  it("rejects malformed proposals before any database write", async () => {
    flagOn();
    const neither = await POST(postRequest({ allocationShareBps: 2500 }), {
      params: Promise.resolve({ id: BUYER_ID }),
    });
    expect(neither.status).toBe(400);

    const both = await POST(
      postRequest({
        supplierCorpId: SUPPLIER_ID,
        buyerCorpId: BUYER_ID,
        allocationShareBps: 2500,
      }),
      { params: Promise.resolve({ id: BUYER_ID }) }
    );
    expect(both.status).toBe(400);

    const tiny = await POST(postRequest({ supplierCorpId: SUPPLIER_ID, allocationShareBps: 50 }), {
      params: Promise.resolve({ id: BUYER_ID }),
    });
    expect(tiny.status).toBe(400);
    expect(db.collection).not.toHaveBeenCalledWith("advertisingAgreements");
  });

  it("rejects a contract with itself", async () => {
    flagOn();
    const response = await POST(
      postRequest({ supplierCorpId: BUYER_ID, allocationShareBps: 2500 }),
      { params: Promise.resolve({ id: BUYER_ID }) }
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("itself"),
    });
  });

  it("rejects a supplier outside Media and Entertainment", async () => {
    flagOn();
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockImplementation(async (_db: unknown, id: string) => {
      if (id === BUYER_ID) return { ok: true, corporation: { ...buyerCorp } } as never;
      if (id === SUPPLIER_ID) return { ok: true, corporation: { ...retailCorp } } as never;
      return {
        ok: false,
        response: Response.json({ error: "Corporation not found" }, { status: 404 }),
      } as never;
    });

    const response = await POST(
      postRequest({ supplierCorpId: SUPPLIER_ID, allocationShareBps: 2500 }),
      { params: Promise.resolve({ id: BUYER_ID }) }
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("Media"),
    });
    expect(db.collection).not.toHaveBeenCalledWith("advertisingAgreements");
  });

  it("requires the supplier to own an operating model", async () => {
    flagOn();
    supplierModels(0);
    const response = await POST(
      postRequest({ supplierCorpId: SUPPLIER_ID, allocationShareBps: 2500 }),
      { params: Promise.resolve({ id: BUYER_ID }) }
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("operating model"),
    });
    expect(db.collection).not.toHaveBeenCalledWith("advertisingAgreements");
  });

  it("proposes an agreement against a qualifying supplier", async () => {
    flagOn();
    turnAt(120);
    supplierModels(1);
    db.collection("advertisingAgreements");

    const response = await POST(
      postRequest({
        supplierCorpId: SUPPLIER_ID,
        allocationShareBps: 2500,
        durationTurns: 12,
      }),
      { params: Promise.resolve({ id: BUYER_ID }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.agreement).toMatchObject({
      buyerCorpId: BUYER_ID,
      supplierCorpId: SUPPLIER_ID,
      allocationShareBps: 2500,
      status: "pending",
    });
    expect(db.collectionMocks.advertisingAgreements.insertOne).toHaveBeenCalledTimes(1);
  });
});
