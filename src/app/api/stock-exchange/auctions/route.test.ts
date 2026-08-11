import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(3) }));
vi.mock("@/lib/nationalization/auctionListing", () => ({
  buildAuctionListings: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/db/characterLookup", () => ({ getCharacterByUserId: vi.fn() }));

function req(url: string): Request {
  return new Request(url);
}

describe("GET /api/stock-exchange/auctions", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({} as Db);
  });

  it("aggregates all countries' auctions for the global exchange (no country scope)", async () => {
    const { GET } = await import("./route");
    const { buildAuctionListings } = await import("@/lib/nationalization/auctionListing");
    const res = await GET(req("http://x/api/stock-exchange/auctions?exchange=global"));
    expect(res.status).toBe(200);
    expect(vi.mocked(buildAuctionListings)).toHaveBeenCalledWith(expect.anything(), {
      currentTurn: 3,
    });
  });

  it("scopes to one country for a specific exchange key", async () => {
    const { GET } = await import("./route");
    const { buildAuctionListings } = await import("@/lib/nationalization/auctionListing");
    const res = await GET(req("http://x/api/stock-exchange/auctions?exchange=sse"));
    expect(res.status).toBe(200);
    expect(vi.mocked(buildAuctionListings)).toHaveBeenCalledWith(expect.anything(), {
      currentTurn: 3,
      countryId: "CN",
    });
  });

  it("rejects an unknown exchange key", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("http://x/api/stock-exchange/auctions?exchange=bogus"));
    expect(res.status).toBe(400);
  });

  it("returns viewerCountryId from the authenticated viewer", async () => {
    const { getAuthUser } = await import("@/lib/auth");
    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getAuthUser).mockResolvedValue({ userId: "u1" } as never);
    vi.mocked(getCharacterByUserId).mockResolvedValue({ countryId: "CN" } as never);
    const { GET } = await import("./route");
    const res = await GET(req("http://x/api/stock-exchange/auctions?exchange=global"));
    const body = await res.json();
    expect(body.viewerCountryId).toBe("CN");
    expect(body.currentTurn).toBe(3);
    expect(Array.isArray(body.auctions)).toBe(true);
  });
});
