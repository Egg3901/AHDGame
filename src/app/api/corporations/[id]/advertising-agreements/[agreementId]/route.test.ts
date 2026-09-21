import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createAsyncIterableCursor, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));

import { PATCH } from "./route";

const buyerId = new ObjectId();
const supplierId = new ObjectId();
const BUYER_ID = buyerId.toString();
const SUPPLIER_ID = supplierId.toString();
const AGREEMENT_ID = new ObjectId().toHexString();

let db: MockDb;

async function authAsCeo() {
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: "ceo-user" },
  } as never);
  const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockImplementation(async (_db: unknown, id: string) => {
    if (id === BUYER_ID)
      return { ok: true, corporation: { _id: buyerId, userId: "ceo-user" } } as never;
    if (id === SUPPLIER_ID)
      return { ok: true, corporation: { _id: supplierId, userId: "supplier-user" } } as never;
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

/** The agreement document every findOne returns until a test overrides it. */
function serveAgreement(doc: Record<string, unknown> | null) {
  db.collection("advertisingAgreements");
  db.collectionMocks.advertisingAgreements.findOne.mockResolvedValue(doc);
}

/** Docs the budget check sees when summing the buyer's active shares. */
function serveActiveAgreements(docs: Record<string, unknown>[]) {
  db.collection("advertisingAgreements");
  db.collectionMocks.advertisingAgreements.find.mockReturnValue(createAsyncIterableCursor(docs));
}

function pendingAgreement(overrides: Record<string, unknown> = {}) {
  return {
    _id: AGREEMENT_ID,
    buyerCorpId: BUYER_ID,
    supplierCorpId: SUPPLIER_ID,
    allocationShareBps: 2500,
    durationTurns: 12,
    status: "pending",
    proposedByCorpId: BUYER_ID,
    currentOffer: { revision: 1, proposedByCorpId: BUYER_ID, allocationShareBps: 2500 },
    offers: [{ revision: 1, proposedByCorpId: BUYER_ID, allocationShareBps: 2500 }],
    createdAt: new Date("2026-09-21T00:00:00.000Z"),
    updatedAt: new Date("2026-09-21T00:00:00.000Z"),
    ...overrides,
  };
}

function patchRequest(body: unknown) {
  return new Request(
    `http://localhost/api/corporations/${SUPPLIER_ID}/advertising-agreements/${AGREEMENT_ID}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

function patchAsCorp(corpId: string, body: unknown) {
  return PATCH(patchRequest(body), {
    params: Promise.resolve({ id: corpId, agreementId: AGREEMENT_ID }),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  await authAsCeo();
  flagOn();
  turnAt(120);
});

describe("PATCH advertising agreements", () => {
  it("returns 401 without authentication and writes nothing", async () => {
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as never);

    const response = await patchAsCorp(SUPPLIER_ID, { action: "accept" });
    expect(response.status).toBe(401);
    expect(db.collection).not.toHaveBeenCalledWith("advertisingAgreements");
  });

  it("blocks a non-CEO update", async () => {
    await denyCeo();
    const response = await patchAsCorp(SUPPLIER_ID, { action: "accept" });
    expect(response.status).toBe(403);
    expect(db.collection).not.toHaveBeenCalledWith("advertisingAgreements");
  });

  it("gates the update while the flag is off", async () => {
    flagOff();
    const response = await patchAsCorp(SUPPLIER_ID, { action: "accept" });
    expect(response.status).toBe(403);
  });

  it("rejects an invalid agreement id and an unknown agreement", async () => {
    const invalid = await PATCH(patchRequest({ action: "accept" }), {
      params: Promise.resolve({ id: SUPPLIER_ID, agreementId: "not-an-id" }),
    });
    expect(invalid.status).toBe(400);

    serveAgreement(null);
    const missing = await patchAsCorp(SUPPLIER_ID, { action: "accept" });
    expect(missing.status).toBe(404);
  });

  it("rejects a corporation that is not a party", async () => {
    const strangerId = new ObjectId();
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: { _id: strangerId, userId: "ceo-user" },
    } as never);
    serveAgreement(pendingAgreement());
    const response = await PATCH(patchRequest({ action: "accept" }), {
      params: Promise.resolve({ id: strangerId.toHexString(), agreementId: AGREEMENT_ID }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("Not a party") });
    expect(db.collectionMocks.advertisingAgreements.updateOne).not.toHaveBeenCalled();
  });

  it("accepts from the counterparty and stamps the active state", async () => {
    serveAgreement(pendingAgreement());
    serveActiveAgreements([]);
    const response = await patchAsCorp(SUPPLIER_ID, { action: "accept" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    const calls = db.collectionMocks.advertisingAgreements.updateOne.mock.calls;
    const accept = calls.find(
      (call) => (call[1] as { $set?: { status?: string } })?.$set?.status === "active"
    );
    expect(accept).toBeDefined();
    expect(accept![0]).toMatchObject({ _id: AGREEMENT_ID, "currentOffer.revision": 1 });
  });

  it("rejects an accept that would oversubscribe the buyer budget", async () => {
    serveAgreement(pendingAgreement({ allocationShareBps: 3000 }));
    serveActiveAgreements([
      {
        _id: "other",
        buyerCorpId: BUYER_ID,
        supplierCorpId: SUPPLIER_ID,
        allocationShareBps: 8000,
        status: "active",
        startsAtTurn: 100,
      },
    ]);
    const response = await patchAsCorp(SUPPLIER_ID, { action: "accept" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "allocation_exceeds_budget" });
    expect(db.collectionMocks.advertisingAgreements.updateOne).not.toHaveBeenCalled();
  });

  it("fails a replayed accept closed instead of forking state", async () => {
    serveAgreement(
      pendingAgreement({ status: "active", startsAtTurn: 120, allocationShareBps: 2500 })
    );
    serveActiveAgreements([]);
    const response = await patchAsCorp(SUPPLIER_ID, { action: "accept" });
    expect(response.status).toBe(400);
    expect(db.collectionMocks.advertisingAgreements.updateOne).not.toHaveBeenCalled();
  });

  it("reports a raced accept as a stale-offer conflict", async () => {
    serveAgreement(pendingAgreement());
    serveActiveAgreements([]);
    db.collectionMocks.advertisingAgreements.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });
    const response = await patchAsCorp(SUPPLIER_ID, { action: "accept" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "stale_offer" });
  });

  it("rejects an accept from the offer author", async () => {
    serveAgreement(pendingAgreement());
    serveActiveAgreements([]);
    const response = await patchAsCorp(BUYER_ID, { action: "accept" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "not_counterparty" });
  });

  it("counters with a new revision from the counterparty", async () => {
    serveAgreement(pendingAgreement());
    const response = await patchAsCorp(SUPPLIER_ID, {
      action: "counter",
      allocationShareBps: 3000,
      durationTurns: 12,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    const calls = db.collectionMocks.advertisingAgreements.updateOne.mock.calls;
    const counter = calls.find(
      (call) =>
        (call[1] as { $set?: { currentOffer?: { revision?: number } } })?.$set?.currentOffer
          ?.revision === 2
    );
    expect(counter).toBeDefined();
  });

  it("rejects a counter without terms", async () => {
    serveAgreement(pendingAgreement());
    const response = await patchAsCorp(SUPPLIER_ID, { action: "counter" });
    expect(response.status).toBe(400);
    expect(db.collectionMocks.advertisingAgreements.updateOne).not.toHaveBeenCalled();
  });

  it("cancels a pending agreement immediately", async () => {
    serveAgreement(pendingAgreement());
    const response = await patchAsCorp(BUYER_ID, { action: "cancel" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    const calls = db.collectionMocks.advertisingAgreements.updateOne.mock.calls;
    expect(
      calls.some(
        (call) => (call[1] as { $set?: { status?: string } })?.$set?.status === "cancelled"
      )
    ).toBe(true);
  });

  it("replays a cancel idempotently", async () => {
    serveAgreement(pendingAgreement({ status: "cancelled" }));
    const first = await patchAsCorp(BUYER_ID, { action: "cancel" });
    expect(first.status).toBe(200);
    expect((await first.json()).success).toBe(true);
    expect(db.collectionMocks.advertisingAgreements.updateOne).not.toHaveBeenCalled();

    const second = await patchAsCorp(SUPPLIER_ID, { action: "cancel" });
    expect(second.status).toBe(200);
  });
});
