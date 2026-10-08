import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";

const loadOpenOffers = vi.fn();
const countDocuments = vi.fn();

vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn().mockResolvedValue({ ok: true, user: { userId: "not-an-object-id" } }),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(10) }));
vi.mock("@/lib/corporations/supplyExchange/listingView", () => ({
  loadOpenOffers: (...args: unknown[]) => loadOpenOffers(...args),
}));
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn().mockResolvedValue({
    collection: () => ({
      findOne: vi.fn().mockResolvedValue({ supplyAgreementsEnabled: true }),
      countDocuments: (...args: unknown[]) => countDocuments(...args),
    }),
  } as unknown as Db),
}));

const get = (query: string) =>
  import("./route").then((m) => m.GET(new Request(`http://localhost/api/supply-offers${query}`)));

beforeEach(() => {
  vi.clearAllMocks();
  loadOpenOffers.mockResolvedValue({ offers: [], hasMore: true });
  countDocuments.mockResolvedValue(42);
});

describe("GET /api/supply-offers", () => {
  it("lists every commodity when none is given, with paging", async () => {
    const res = await get("?page=2&pageSize=20");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ enabled: true, page: 2, hasMore: true, total: 42 });
    expect(loadOpenOffers.mock.calls[0][1]).toMatchObject({
      commodity: undefined,
      page: 2,
      limit: 20,
    });
    expect(countDocuments).toHaveBeenCalledWith({ expiresAtTurn: { $gt: 10 } });
  });

  it("still filters by commodity", async () => {
    await get("?commodity=oil");
    expect(loadOpenOffers.mock.calls[0][1]).toMatchObject({ commodity: "oil", page: 1, limit: 60 });
    expect(countDocuments).toHaveBeenCalledWith({ commodity: "oil", expiresAtTurn: { $gt: 10 } });
  });

  it("rejects an unknown commodity and bad paging", async () => {
    expect((await get("?commodity=nope")).status).toBe(400);
    expect((await get("?page=0")).status).toBe(400);
    expect((await get("?pageSize=500")).status).toBe(400);
  });
});
