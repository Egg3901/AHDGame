import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { GET } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn().mockResolvedValue({ ok: true, user: { userId: "ceo" } }),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(true) }));

describe("founding underwriting bank choices", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns no bank rows while disabled", async () => {
    const db = createInMemoryDb();
    db.seed("gameConfig", [
      { _id: "default", privateBankingEnabled: true, bankUnderwritingEnabled: false },
    ]);
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const collections = vi.spyOn(db, "collection");
    const response = await GET(
      new Request("http://localhost/api/corporations/underwriting-banks?countryId=US")
    );
    expect(await response.json()).toEqual({ enabled: false, banks: [] });
    expect(collections.mock.calls.map(([name]) => name)).toEqual(["gameConfig"]);
  });

  it("lists only currently eligible banks in the founding currency", async () => {
    const db = createInMemoryDb();
    db.seed("gameConfig", [
      { _id: "default", privateBankingEnabled: true, bankUnderwritingEnabled: true },
    ]);
    db.seed("gameState", [{ _id: "current", preset: "default" }]);
    db.seed("corporations", [
      {
        _id: new ObjectId(),
        name: "USD underwriter",
        countryId: "US",
        liquidCurrencyCode: "USD",
        bankCharter: { type: "investment", status: "active", currency: "USD", charteredTurn: 7 },
      },
      {
        _id: new ObjectId(),
        name: "Mismatched books",
        countryId: "CA",
        liquidCurrencyCode: "CAD",
        bankCharter: { type: "investment", status: "active", currency: "USD", charteredTurn: 8 },
      },
    ]);
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const response = await GET(
      new Request("http://localhost/api/corporations/underwriting-banks?countryId=US")
    );
    expect(await response.json()).toMatchObject({
      enabled: true,
      currencyCode: "USD",
      banks: [{ name: "USD underwriter", currencyCode: "USD", charteredTurn: 7, feeRate: 0.015 }],
    });
  });
});
