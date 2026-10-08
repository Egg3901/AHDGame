import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { loadOpenOffers } from "./listingView";

function makeDb(rows: unknown[], publishers: unknown[]) {
  const find = vi.fn();
  const chain = {
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(rows),
  };
  find.mockReturnValue(chain);
  const db = {
    collection: (name: string) =>
      name === "supplyListings"
        ? { find }
        : { find: () => ({ project: () => ({ toArray: async () => publishers }) }) },
  } as unknown as Db;
  return { db, find, chain };
}

describe("loadOpenOffers", () => {
  const corpId = new ObjectId();
  const row = (n: number, ai = false) => ({
    _id: `l${n}`,
    corporationId: corpId,
    slot: n,
    side: "sell",
    commodity: "oil",
    volumeCap: 5,
    pricePremium: 0.1,
    expiresAtTurn: 99,
    publishedByUserId: "u",
    aiListed: ai,
  });

  it("spans commodities, skips earlier pages and reports hasMore", async () => {
    const { db, find, chain } = makeDb(
      [row(1, true), row(2, true), row(3, true)],
      [{ _id: corpId, name: "Acme" }]
    );
    const out = await loadOpenOffers(db, { turn: 5, viewerCorpIds: new Set(), limit: 2, page: 3 });
    expect(find.mock.calls[0][0]).toEqual({ expiresAtTurn: { $gt: 5 } });
    expect(chain.skip).toHaveBeenCalledWith(4);
    expect(chain.limit).toHaveBeenCalledWith(3);
    expect(out.hasMore).toBe(true);
    expect(out.offers).toHaveLength(2);
    expect(out.offers[0].ai).toBe(true);
  });

  it("filters to one commodity when given", async () => {
    const { db, find } = makeDb([], []);
    const out = await loadOpenOffers(db, {
      commodity: "oil",
      turn: 5,
      viewerCorpIds: new Set(),
      limit: 10,
    });
    expect(find.mock.calls[0][0]).toEqual({ commodity: "oil", expiresAtTurn: { $gt: 5 } });
    expect(out).toEqual({ offers: [], hasMore: false });
  });
});
