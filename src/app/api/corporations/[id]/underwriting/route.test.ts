import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { GET, PUT } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn().mockResolvedValue({ ok: true, user: { userId: "ceo" } }),
}));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn().mockReturnValue(null),
}));

const issuerId = new ObjectId();
const bankId = new ObjectId();
const userId = new ObjectId("0000000000000000000000ce");

function setup(enabled = true, issuerOverrides: Record<string, unknown> = {}) {
  const db = createInMemoryDb();
  const issuer = {
    _id: issuerId,
    name: "Issuer",
    countryId: "US",
    userId,
    liquidCurrencyCode: "USD",
    ...issuerOverrides,
  };
  db.seed("gameConfig", [
    { _id: "default", privateBankingEnabled: enabled, bankUnderwritingEnabled: enabled },
  ]);
  db.seed("gameState", [{ _id: "current", currentTurn: 41 }]);
  db.seed("corporations", [
    issuer,
    {
      _id: bankId,
      name: "Investment bank",
      countryId: "US",
      liquidCurrencyCode: "USD",
      bankCharter: {
        type: "investment",
        status: "active",
        currency: "USD",
        charteredTurn: 12,
      },
    },
  ]);
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation: issuer as never });
  vi.mocked(requireCeo).mockReturnValue(null);
  const params = { params: Promise.resolve({ id: issuerId.toHexString() }) };
  const get = () => GET(new Request("http://localhost/api/corporations/1/underwriting"), params);
  const put = (selected: string | null) =>
    PUT(
      new Request("http://localhost/api/corporations/1/underwriting", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankCorporationId: selected }),
      }),
      params
    );
  return { db, issuer, get, put };
}

describe("corporation primary-underwriting mandate API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not read bank corporations while the feature is off", async () => {
    const { db, get } = setup(false);
    const collection = vi.spyOn(db, "collection");
    const response = await get();
    expect(await response.json()).toMatchObject({ enabled: false, banks: [] });
    expect(collection.mock.calls.map(([name]) => name)).toEqual(["gameConfig"]);
  });

  it("uses the legacy country currency fallback and records an optimistic CEO mandate revision", async () => {
    const { db, put } = setup(true, {
      liquidCurrencyCode: undefined,
      primaryUnderwritingMandateRevision: 4,
    });
    const response = await put(bankId.toHexString());
    expect(response.status).toBe(200);
    expect(db.collection("corporations").docs[0]).toMatchObject({
      primaryUnderwritingMandate: {
        bankCorporationId: bankId,
        currencyCode: "USD",
        charteredTurn: 12,
      },
      primaryUnderwritingMandateRevision: 5,
    });
  });

  it("compares HQ-derived currency against a legacy issuer without a stored countryId", async () => {
    const { db, issuer, put } = setup(true, {
      countryId: "US",
      headquartersState: "NY",
      liquidCurrencyCode: undefined,
    });
    const rawIssuer = db.collection("corporations").docs[0] as Record<string, unknown>;
    delete rawIssuer.countryId;
    delete rawIssuer.liquidCurrencyCode;
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: { ...issuer, countryId: "US" } as never,
    });

    const response = await put(bankId.toHexString());
    expect(response.status).toBe(200);
    expect(rawIssuer.primaryUnderwritingMandate).toMatchObject({ currencyCode: "USD" });
  });

  it("rejects a CEO change between authorization and the atomic mandate write", async () => {
    const { db, put } = setup();
    const collection = db.collection("corporations");
    const originalUpdateOne = collection.updateOne.bind(collection);
    vi.spyOn(collection, "updateOne").mockImplementation(async (...args) => {
      (collection.docs[0] as Record<string, unknown>).userId = new ObjectId();
      return originalUpdateOne(...args);
    });
    const response = await put(bankId.toHexString());
    expect(response.status).toBe(409);
    expect(
      (collection.docs[0] as Record<string, unknown>).primaryUnderwritingMandate
    ).toBeUndefined();
  });

  it("compares the exact CEO identity even when the same user remains assigned", async () => {
    const currentCeoId = new ObjectId();
    const { db, put } = setup(true, { ceoId: currentCeoId, ceoType: "character" });
    const collection = db.collection("corporations");
    const originalUpdateOne = collection.updateOne.bind(collection);
    vi.spyOn(collection, "updateOne").mockImplementation(async (...args) => {
      (collection.docs[0] as Record<string, unknown>).ceoId = new ObjectId();
      return originalUpdateOne(...args);
    });

    const response = await put(bankId.toHexString());

    expect(response.status).toBe(409);
    expect(
      (collection.docs[0] as Record<string, unknown>).primaryUnderwritingMandate
    ).toBeUndefined();
  });

  it("rejects a selected bank whose charter epoch went stale", async () => {
    const { db, put } = setup();
    (db.collection("corporations").docs[1] as Record<string, unknown>).bankCharter = {
      type: "investment",
      status: "failed",
      currency: "USD",
      charteredTurn: 13,
    };
    const response = await put(bankId.toHexString());
    expect(response.status).toBe(409);
  });

  it("rejects a bank whose liquid denomination disagrees with its charter", async () => {
    const { db, put } = setup();
    (db.collection("corporations").docs[1] as Record<string, unknown>).countryId = "CA";
    (db.collection("corporations").docs[1] as Record<string, unknown>).liquidCurrencyCode =
      undefined;
    const response = await put(bankId.toHexString());
    expect(response.status).toBe(409);
  });
});
