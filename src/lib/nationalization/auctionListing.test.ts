import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

// A minimal chainable cursor whose toArray yields the seeded rows.
function mkCursor<T>(rows: T[]) {
  const cursor = {
    toArray: vi.fn().mockResolvedValue(rows),
    project: vi.fn(() => cursor),
    sort: vi.fn(() => cursor),
    limit: vi.fn(() => cursor),
    skip: vi.fn(() => cursor),
  };
  return cursor;
}

const CORP_A = new ObjectId();
const CORP_B = new ObjectId();

function seed(
  db: MockDb,
  opts: {
    auctions: unknown[];
    corps: unknown[];
    sectors: unknown[];
    states: unknown[];
    characters?: unknown[];
  }
) {
  db.collection("nationalizationAuctions");
  db.collection("corporations");
  db.collection("corporateSectors");
  db.collection("states");
  db.collection("characters");
  db.collectionMocks.nationalizationAuctions.find.mockReturnValue(mkCursor(opts.auctions));
  db.collectionMocks.corporations.find.mockReturnValue(mkCursor(opts.corps));
  db.collectionMocks.corporateSectors.find.mockReturnValue(mkCursor(opts.sectors));
  db.collectionMocks.states.find.mockReturnValue(mkCursor(opts.states));
  db.collectionMocks.characters.find.mockReturnValue(mkCursor(opts.characters ?? []));
}

describe("buildAuctionListings", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("enriches an open auction with multi-sector totals, region names, valuation and turns-left", async () => {
    seed(db, {
      auctions: [
        {
          _id: new ObjectId(),
          corporationId: CORP_A,
          countryId: "CN",
          closesAtTurn: 51,
          reservePrice: 100_000_000,
          reserveCurrency: "CNY",
          goldenSharePercent: 0,
          status: "open",
          bids: [{ characterId: new ObjectId(), amount: 120_000_000 }],
        },
      ],
      corps: [
        {
          _id: CORP_A,
          name: "Sino Media Group",
          sequentialId: 7,
          type: "media",
          countryId: "CN",
          headquartersState: "HB",
          totalShares: 10_000_000,
          sharePrice: 14.63,
        },
      ],
      sectors: [
        {
          _id: new ObjectId(),
          corporationId: CORP_A,
          sectorType: "media",
          stateId: "HB",
          revenue: 50_000_000,
        },
        {
          _id: new ObjectId(),
          corporationId: CORP_A,
          sectorType: "media",
          stateId: "HD",
          revenue: 30_000_000,
        },
      ],
      states: [
        { _id: "HB", countryId: "CN", name: "Hubei" },
        { _id: "HD", countryId: "CN", name: "Hebei" },
      ],
    });

    const { buildAuctionListings } = await import("./auctionListing");
    const out = await buildAuctionListings(db as unknown as Db, {
      currentTurn: 3,
      countryId: "CN",
    });

    expect(out).toHaveLength(1);
    const a = out[0];
    expect(a.corpName).toBe("Sino Media Group");
    expect(a.corpSequentialId).toBe(7);
    expect(a.leadSectorType).toBe("media");
    expect(a.countryId).toBe("CN");
    expect(a.totalRevenuePerTurn).toBe(80_000_000);
    expect(a.sectors).toHaveLength(2);
    expect(a.sectors.find((s) => s.stateId === "HB")?.stateName).toBe("Hubei");
    expect(a.hqStateName).toBe("Hubei");
    expect(a.valuationLocal).toBe(Math.round(14.63 * 10_000_000));
    expect(a.reservePrice).toBe(100_000_000);
    expect(a.currency).toBe("CNY");
    expect(a.highestBid).toBe(120_000_000);
    expect(a.bidCount).toBe(1);
    expect(a.turnsLeft).toBe(48);
  });

  it("scopes the auction query by country when countryId is given, and omits it for global", async () => {
    seed(db, { auctions: [], corps: [], sectors: [], states: [] });
    const { buildAuctionListings } = await import("./auctionListing");

    await buildAuctionListings(db as unknown as Db, { currentTurn: 1, countryId: "CN" });
    expect(db.collectionMocks.nationalizationAuctions.find).toHaveBeenCalledWith(
      expect.objectContaining({ status: "open", countryId: "CN" })
    );

    vi.clearAllMocks();
    seed(db, { auctions: [], corps: [], sectors: [], states: [] });
    await buildAuctionListings(db as unknown as Db, { currentTurn: 1 });
    const filter = db.collectionMocks.nationalizationAuctions.find.mock.calls[0][0];
    expect(filter).toEqual({ status: "open" });
  });

  it("sorts listings by closesAtTurn (soonest first)", async () => {
    seed(db, {
      auctions: [
        {
          _id: new ObjectId(),
          corporationId: CORP_A,
          countryId: "CN",
          closesAtTurn: 80,
          reservePrice: 1,
          reserveCurrency: "CNY",
          goldenSharePercent: 0,
          status: "open",
          bids: [],
        },
        {
          _id: new ObjectId(),
          corporationId: CORP_B,
          countryId: "CN",
          closesAtTurn: 40,
          reservePrice: 1,
          reserveCurrency: "CNY",
          goldenSharePercent: 0,
          status: "open",
          bids: [],
        },
      ],
      corps: [
        {
          _id: CORP_A,
          name: "Later",
          sequentialId: 1,
          type: "media",
          countryId: "CN",
          headquartersState: "HB",
          totalShares: 10,
          sharePrice: 1,
        },
        {
          _id: CORP_B,
          name: "Sooner",
          sequentialId: 2,
          type: "energy",
          countryId: "CN",
          headquartersState: "HB",
          totalShares: 10,
          sharePrice: 1,
        },
      ],
      sectors: [],
      states: [{ _id: "HB", countryId: "CN", name: "Hubei" }],
    });
    const { buildAuctionListings } = await import("./auctionListing");
    const out = await buildAuctionListings(db as unknown as Db, {
      currentTurn: 1,
      countryId: "CN",
    });
    expect(out.map((a) => a.corpName)).toEqual(["Sooner", "Later"]);
  });

  it("builds the full bid history (newest first) with resolved bidder names", async () => {
    const alice = new ObjectId();
    const bob = new ObjectId();
    seed(db, {
      auctions: [
        {
          _id: new ObjectId(),
          corporationId: CORP_A,
          countryId: "CN",
          closesAtTurn: 51,
          reservePrice: 1,
          reserveCurrency: "CNY",
          goldenSharePercent: 0,
          status: "open",
          // Standing escrow keeps one per bidder; history records every raise.
          bids: [{ characterId: alice, amount: 300, placedAtTurn: 8 }],
          bidHistory: [
            { characterId: alice, amount: 100, placedAtTurn: 4 },
            { characterId: bob, amount: 200, placedAtTurn: 6 },
            { characterId: alice, amount: 300, placedAtTurn: 8 },
          ],
        },
      ],
      corps: [
        {
          _id: CORP_A,
          name: "Sino Media Group",
          sequentialId: 7,
          type: "media",
          countryId: "CN",
          headquartersState: "HB",
          totalShares: 10,
          sharePrice: 1,
        },
      ],
      sectors: [],
      states: [{ _id: "HB", countryId: "CN", name: "Hubei" }],
      characters: [
        { _id: alice, name: "Alice" },
        { _id: bob, name: "Bob" },
      ],
    });
    const { buildAuctionListings } = await import("./auctionListing");
    const out = await buildAuctionListings(db as unknown as Db, {
      currentTurn: 3,
      countryId: "CN",
    });
    // Newest first; every raise present (Alice appears twice).
    expect(out[0].bidHistory).toEqual([
      { bidderName: "Alice", bidderType: "character", amount: 300, placedAtTurn: 8 },
      { bidderName: "Bob", bidderType: "character", amount: 200, placedAtTurn: 6 },
      { bidderName: "Alice", bidderType: "character", amount: 100, placedAtTurn: 4 },
    ]);
    expect(out[0].highestBid).toBe(300);
    // The leader (sole escrow holder) is identified for the affordability credit.
    expect(out[0].leadingBidderCharacterId).toBe(String(alice));
    expect(out[0].leadingBidderCorporationId).toBeNull();
  });

  it("falls back to standing bids when an auction has no history log", async () => {
    const alice = new ObjectId();
    seed(db, {
      auctions: [
        {
          _id: new ObjectId(),
          corporationId: CORP_A,
          countryId: "CN",
          closesAtTurn: 51,
          reservePrice: 1,
          reserveCurrency: "CNY",
          goldenSharePercent: 0,
          status: "open",
          bids: [{ characterId: alice, amount: 100, placedAtTurn: 4 }],
        },
      ],
      corps: [
        {
          _id: CORP_A,
          name: "Sino Media Group",
          sequentialId: 7,
          type: "media",
          countryId: "CN",
          headquartersState: "HB",
          totalShares: 10,
          sharePrice: 1,
        },
      ],
      sectors: [],
      states: [{ _id: "HB", countryId: "CN", name: "Hubei" }],
      characters: [{ _id: alice, name: "Alice" }],
    });
    const { buildAuctionListings } = await import("./auctionListing");
    const out = await buildAuctionListings(db as unknown as Db, {
      currentTurn: 3,
      countryId: "CN",
    });
    expect(out[0].bidHistory).toEqual([
      { bidderName: "Alice", bidderType: "character", amount: 100, placedAtTurn: 4 },
    ]);
  });

  it("returns an empty array when there are no open auctions", async () => {
    seed(db, { auctions: [], corps: [], sectors: [], states: [] });
    const { buildAuctionListings } = await import("./auctionListing");
    expect(await buildAuctionListings(db as unknown as Db, { currentTurn: 1 })).toEqual([]);
  });
});
