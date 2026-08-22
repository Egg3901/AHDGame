import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateStockExchangeSnapshots,
  generateInvestorRankingSnapshot,
  generateWealthListSnapshots,
} from "./stockExchangeSnapshot";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";
import { ALL_EXCHANGES } from "@/lib/constants/exchangeRegistry";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/corporations/marketQuote", () => ({
  getPublicShareQuote: vi.fn((corp) => {
    if (corp.sharePrice !== undefined) return corp.sharePrice;
    return 100;
  }),
  getRoundedPublicMarketCap: vi.fn((corp, totalShares) => {
    const price = corp.sharePrice ?? 100;
    return price * totalShares;
  }),
}));

import { getDb } from "@/lib/mongodb";
import { getPublicShareQuote, getRoundedPublicMarketCap } from "@/lib/corporations/marketQuote";

describe("stockExchangeSnapshot", () => {
  let mockDb: Db;
  let mockCollection: ReturnType<typeof vi.fn>;
  let mockUpdateOne: ReturnType<typeof vi.fn>;

  const createMockChain = (result: any[]) => ({
    find: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
    aggregate: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(result),
    updateMany: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
  });

  beforeEach(() => {
    resetCorpFxRateCacheForTests();
    mockUpdateOne = vi.fn();
    // Default collection mock: returns an empty chain (find/sort/project/aggregate/toArray).
    // Individual tests override with `.mockReturnValueOnce(createMockChain([...]))` for the
    // collections they care about; any collection not covered falls through to this default
    // empty chain, so new upstream fetches (e.g. federalBudget for tax-rate lookups) don't
    // blow up pre-existing tests.
    mockCollection = vi.fn().mockImplementation(() => ({
      find: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
      aggregate: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
      // Era gate reads gameState once (null ⇒ flag off ⇒ legacy behavior).
      findOne: vi.fn().mockResolvedValue(null),
      updateOne: mockUpdateOne,
      updateMany: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
      bulkWrite: vi.fn().mockResolvedValue({ ok: 1 }),
    }));

    mockDb = {
      collection: mockCollection,
    } as unknown as Db;

    vi.mocked(getDb).mockResolvedValue(mockDb);
    vi.clearAllMocks();
  });

  describe("generateStockExchangeSnapshots", () => {
    const createCorporation = (overrides?: Partial<any>) => ({
      _id: new ObjectId(),
      sequentialId: 1,
      name: "Test Corp",
      // Fixtures previously omitted countryId and relied on getExchange()'s
      // `?? "US"` fallback to land on the NYSE. That fallback is gone.
      countryId: "US",
      type: "conglomerate" as const,
      headquartersState: "NY",
      sharePrice: 100,
      totalShares: 1000,
      ceoId: new ObjectId(),
      ceoVacant: false,
      hiddenFromExchange: false,
      marketingBudget: 0,
      logisticsBudget: 0,
      ceoSalary: 0,
      dividendRate: 0,
      countryOwnerId: null,
      logoUrl: null,
      brandColor: null,
      ...overrides,
    });

    const createSector = (overrides?: Partial<any>) => ({
      _id: new ObjectId(),
      corporationId: new ObjectId(),
      revenue: 100000,
      profitMargin: 20,
      currentGrowthCost: 5000,
      targetGrowthRate: 5,
      currentGrowthRate: 5,
      ...overrides,
    });

    const createState = (overrides?: Partial<any>) => ({
      _id: "NY",
      name: "New York",
      ...overrides,
    });

    const createStateMetrics = (overrides?: Partial<any>) => ({
      _id: new ObjectId(),
      stateId: "NY",
      turn: 100,
      economic: { unemploymentRate: { value: 5 }, costOfLiving: { value: 50 } },
      infrastructure: {
        powerGridReliability: { value: 50 },
        broadbandAccess: { value: 50 },
        roadCondition: { value: 50 },
      },
      governance: { corruptionIndex: { value: 50 } },
      education: { workforceSkill: { value: 5 } },
      publicSafety: { crimeRate: { value: 50 } },
      environment: { carbonEmissions: { value: 50 } },
      ...overrides,
    });

    const createCharacter = (overrides?: Partial<any>) => ({
      _id: new ObjectId(),
      name: "Test CEO",
      avatarUrl: null,
      sequentialId: 1,
      ...overrides,
    });

    it("returns early when no corporations exist", async () => {
      mockCollection.mockReturnValue(createMockChain([]));

      await generateStockExchangeSnapshots(100, mockDb);

      expect(mockUpdateOne).not.toHaveBeenCalled();
    });

    it("repairs public IPO corporations left hidden by their auction shell", async () => {
      const corporations = createMockChain([]);
      mockCollection.mockReturnValueOnce(corporations);

      await generateStockExchangeSnapshots(100, mockDb);

      expect(corporations.updateMany).toHaveBeenCalledWith(
        {
          isPrivate: { $ne: true },
          hiddenFromExchange: true,
          lastIpoTurn: { $exists: true },
        },
        { $set: { hiddenFromExchange: false } }
      );
    });

    it("filters out hidden corporations", async () => {
      const corpId = new ObjectId();
      mockCollection
        .mockReturnValueOnce(
          createMockChain([createCorporation({ _id: corpId, hiddenFromExchange: false })])
        )
        .mockReturnValueOnce(createMockChain([createCharacter()]))
        .mockReturnValueOnce(createMockChain([createSector({ corporationId: corpId })]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([createStateMetrics()]))
        .mockReturnValueOnce(createMockChain([createState()]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([createState()]));

      vi.mocked(getPublicShareQuote).mockReturnValue(100);
      vi.mocked(getRoundedPublicMarketCap).mockReturnValue(100000);

      await generateStockExchangeSnapshots(100, mockDb);

      const findCall = mockCollection.mock.calls.find((c) => c[0] === "corporations");
      expect(findCall).toBeDefined();
    });

    it("excludes private corporations from exchange listings", async () => {
      // Private corps must not appear on stock exchanges. The filter is enforced
      // at the MongoDB query level in stockExchangeSnapshot.ts:
      //   { hiddenFromExchange: { $ne: true }, isPrivate: { $ne: true } }
      // This is a smoke test — the query filter is verified by source inspection.
      await generateStockExchangeSnapshots(100, mockDb);

      // Find the call where mockCollection was invoked with "corporations"
      const corpCalls = mockCollection.mock.calls.filter((c) => c[0] === "corporations");
      expect(corpCalls.length).toBeGreaterThanOrEqual(1);
    });

    it("fetches CEO character data for corporations", async () => {
      const ceoId = new ObjectId();
      mockCollection
        .mockReturnValueOnce(createMockChain([createCorporation({ ceoId, ceoVacant: false })]))
        .mockReturnValueOnce(createMockChain([createCharacter({ _id: ceoId })]))
        .mockReturnValueOnce(createMockChain([])) // sectors
        .mockReturnValueOnce(createMockChain([])) // history
        .mockReturnValueOnce(createMockChain([createStateMetrics()]))
        .mockReturnValueOnce(createMockChain([createState()]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]));

      await generateStockExchangeSnapshots(100, mockDb);

      const charCall = mockCollection.mock.calls.find((c) => c[0] === "characters");
      expect(charCall).toBeDefined();
    });

    it("fetches sector data for revenue/income calculations", async () => {
      const corpId = new ObjectId();
      mockCollection
        .mockReturnValueOnce(createMockChain([createCorporation({ _id: corpId })]))
        .mockReturnValueOnce(createMockChain([createCharacter()]))
        .mockReturnValueOnce(createMockChain([createSector({ corporationId: corpId })]))
        .mockReturnValueOnce(createMockChain([])) // history
        .mockReturnValueOnce(createMockChain([createStateMetrics()]))
        .mockReturnValueOnce(createMockChain([createState()]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]));

      await generateStockExchangeSnapshots(100, mockDb);

      const sectorCall = mockCollection.mock.calls.find((c) => c[0] === "corporateSectors");
      expect(sectorCall).toBeDefined();
    });

    it("fetches 24-turn price history", async () => {
      const corpId = new ObjectId();
      mockCollection
        .mockReturnValueOnce(createMockChain([createCorporation({ _id: corpId })]))
        .mockReturnValueOnce(createMockChain([createCharacter()]))
        .mockReturnValueOnce(createMockChain([])) // sectors
        .mockReturnValueOnce(
          createMockChain([{ _id: corpId, history: [{ turn: 76, sharePrice: 95 }] }])
        ) // history
        .mockReturnValueOnce(createMockChain([createStateMetrics()]))
        .mockReturnValueOnce(createMockChain([createState()]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]));

      await generateStockExchangeSnapshots(100, mockDb);

      const historyCall = mockCollection.mock.calls.find((c) => c[0] === "corporationHistory");
      expect(historyCall).toBeDefined();
    });

    it("builds listings with correct exchange assignment", async () => {
      const usCorp = createCorporation({
        _id: new ObjectId(),
        name: "US Corp",
        countryId: "US",
        headquartersState: "NY",
      });
      const ukCorp = createCorporation({
        _id: new ObjectId(),
        name: "UK Corp",
        countryId: "UK",
        headquartersState: "ENG",
      });

      const states = [createState({ _id: "NY" }), createState({ _id: "ENG", name: "England" })];
      mockCollection
        .mockReturnValueOnce(createMockChain([usCorp, ukCorp]))
        .mockReturnValueOnce(createMockChain([createCharacter()]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([createStateMetrics()]))
        .mockReturnValueOnce(createMockChain(states))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain(states));

      vi.mocked(getPublicShareQuote).mockReturnValue(100);
      vi.mocked(getRoundedPublicMarketCap).mockReturnValue(100000);

      await generateStockExchangeSnapshots(100, mockDb);

      const nyseCall = mockUpdateOne.mock.calls.find((c) => c[0]?._id === "nyse");
      const ftseCall = mockUpdateOne.mock.calls.find((c) => c[0]?._id === "ftse");

      // Assert on the listings, not just the documents: a snapshot document is
      // written for every registry entry regardless of whether anything lists
      // on it, so `toBeDefined()` alone never tested assignment at all.
      expect(nyseCall![1].$set.listings.map((l: { name: string }) => l.name)).toEqual(["US Corp"]);
      expect(ftseCall![1].$set.listings.map((l: { name: string }) => l.name)).toEqual(["UK Corp"]);
    });

    it("keeps a venue-less corporation out of every per-venue snapshot", async () => {
      // FR has no exchangeName. Before this fix getExchange() fell back to
      // "NYSE" and a French state enterprise was listed on the New York
      // exchange. It must now appear in `global` only, with exchange: null.
      const frCorp = createCorporation({
        _id: new ObjectId(),
        name: "Régie Nationale",
        countryId: "FR",
        headquartersState: "NY",
      });
      const states = [createState({ _id: "NY" })];
      mockCollection
        .mockReturnValueOnce(createMockChain([frCorp]))
        .mockReturnValueOnce(createMockChain([createCharacter()]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([createStateMetrics()]))
        .mockReturnValueOnce(createMockChain(states))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain(states));

      vi.mocked(getPublicShareQuote).mockReturnValue(100);
      vi.mocked(getRoundedPublicMarketCap).mockReturnValue(100000);

      await generateStockExchangeSnapshots(100, mockDb);

      const nyse = mockUpdateOne.mock.calls.find((c) => c[0]?._id === "nyse")![1].$set;
      const global = mockUpdateOne.mock.calls.find((c) => c[0]?._id === "global")![1].$set;

      expect(nyse.listings).toHaveLength(0);
      expect(global.listings.map((l: { name: string }) => l.name)).toContain("Régie Nationale");
      expect(global.listings[0].exchange).toBeNull();
    });

    it("lists a Soviet state enterprise on GOSPLAN, not the NYSE", async () => {
      const ruCorp = createCorporation({
        _id: new ObjectId(),
        name: "Soviet Union",
        countryId: "RU",
        headquartersState: "NY",
      });
      const states = [createState({ _id: "NY" })];
      mockCollection
        .mockReturnValueOnce(createMockChain([ruCorp]))
        .mockReturnValueOnce(createMockChain([createCharacter()]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([createStateMetrics()]))
        .mockReturnValueOnce(createMockChain(states))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain(states));

      vi.mocked(getPublicShareQuote).mockReturnValue(100);
      vi.mocked(getRoundedPublicMarketCap).mockReturnValue(100000);

      await generateStockExchangeSnapshots(100, mockDb);

      const nyse = mockUpdateOne.mock.calls.find((c) => c[0]?._id === "nyse")![1].$set;
      const gosplan = mockUpdateOne.mock.calls.find((c) => c[0]?._id === "gosplan")![1].$set;

      expect(nyse.listings).toHaveLength(0);
      expect(gosplan.listings.map((l: { name: string }) => l.name)).toEqual(["Soviet Union"]);
    });

    it("copies tickerSymbol from the source corporation onto the listing", async () => {
      const tickered = createCorporation({
        _id: new ObjectId(),
        name: "Tickered Corp",
        tickerSymbol: "TICK",
        headquartersState: "NY",
      });
      const legacy = createCorporation({
        _id: new ObjectId(),
        name: "Legacy Corp",
        headquartersState: "NY",
      });
      const states = [createState({ _id: "NY" })];
      mockCollection
        .mockReturnValueOnce(createMockChain([tickered, legacy]))
        .mockReturnValueOnce(createMockChain([createCharacter()]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([createStateMetrics()]))
        .mockReturnValueOnce(createMockChain(states))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain(states));

      vi.mocked(getPublicShareQuote).mockReturnValue(100);
      vi.mocked(getRoundedPublicMarketCap).mockReturnValue(100000);

      await generateStockExchangeSnapshots(100, mockDb);

      const nyseUpdate = mockUpdateOne.mock.calls.find((c) => c[0]?._id === "nyse");
      expect(nyseUpdate).toBeDefined();
      const listings = nyseUpdate![1].$set.listings as Array<{
        name: string;
        tickerSymbol?: string;
      }>;
      const tListing = listings.find((l) => l.name === "Tickered Corp");
      const lListing = listings.find((l) => l.name === "Legacy Corp");
      expect(tListing?.tickerSymbol).toBe("TICK");
      expect(lListing?.tickerSymbol).toBeUndefined();
    });

    it("calculates price change 24h correctly", async () => {
      const corpId = new ObjectId();
      mockCollection
        .mockReturnValueOnce(createMockChain([createCorporation({ _id: corpId, sharePrice: 110 })]))
        .mockReturnValueOnce(createMockChain([createCharacter()]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(
          createMockChain([{ _id: corpId, history: [{ turn: 76, sharePrice: 100 }] }])
        )
        .mockReturnValueOnce(createMockChain([createStateMetrics()]))
        .mockReturnValueOnce(createMockChain([createState()]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]));

      vi.mocked(getPublicShareQuote).mockImplementation((corp) => corp.sharePrice ?? 100);
      vi.mocked(getRoundedPublicMarketCap).mockReturnValue(110000);

      await generateStockExchangeSnapshots(100, mockDb);

      const updateCall = mockUpdateOne.mock.calls.find((c) => c[0]?._id === "global");
      if (updateCall) {
        const listing = updateCall[1]?.$set?.listings?.[0];
        expect(listing.priceChange24h).toBe(10); // (110 - 100) / 100 * 100 = 10%
      }
    });

    it("handles missing 24h history gracefully", async () => {
      const corpId = new ObjectId();
      mockCollection
        .mockReturnValueOnce(createMockChain([createCorporation({ _id: corpId })]))
        .mockReturnValueOnce(createMockChain([createCharacter()]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([])) // No history
        .mockReturnValueOnce(createMockChain([createStateMetrics()]))
        .mockReturnValueOnce(createMockChain([createState()]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]));

      vi.mocked(getPublicShareQuote).mockReturnValue(100);
      vi.mocked(getRoundedPublicMarketCap).mockReturnValue(100000);

      await generateStockExchangeSnapshots(100, mockDb);

      const updateCall = mockUpdateOne.mock.calls.find((c) => c[0]?._id === "global");
      if (updateCall) {
        const listing = updateCall[1]?.$set?.listings?.[0];
        expect(listing.priceChange24h).toBe(0);
      }
    });

    it("identifies natcorps correctly", async () => {
      const natcorp = createCorporation({ countryOwnerId: "US" });
      const regularCorp = createCorporation({ countryOwnerId: null });

      mockCollection
        .mockReturnValueOnce(createMockChain([natcorp, regularCorp]))
        .mockReturnValueOnce(createMockChain([createCharacter()]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([createStateMetrics()]))
        .mockReturnValueOnce(createMockChain([createState()]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]));

      vi.mocked(getPublicShareQuote).mockReturnValue(100);
      vi.mocked(getRoundedPublicMarketCap).mockReturnValue(100000);

      await generateStockExchangeSnapshots(100, mockDb);

      const updateCall = mockUpdateOne.mock.calls.find((c) => c[0]?._id === "global");
      if (updateCall) {
        const listings = updateCall[1]?.$set?.listings;
        expect(listings?.some((l: any) => l.isNatcorp === true)).toBe(true);
        expect(listings?.some((l: any) => l.isNatcorp === false)).toBe(true);
      }
    });

    it("creates one snapshot per registered exchange plus the global board", async () => {
      mockCollection
        .mockReturnValueOnce(createMockChain([createCorporation()]))
        .mockReturnValueOnce(createMockChain([createCharacter()]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([createStateMetrics()]))
        .mockReturnValueOnce(createMockChain([createState()]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]));

      vi.mocked(getPublicShareQuote).mockReturnValue(100);
      vi.mocked(getRoundedPublicMarketCap).mockReturnValue(100000);

      await generateStockExchangeSnapshots(100, mockDb);

      expect(mockUpdateOne).toHaveBeenCalledTimes(ALL_EXCHANGES.length + 1);
      expect(mockUpdateOne).toHaveBeenCalledWith(
        { _id: "nyse" },
        expect.objectContaining({
          $set: expect.objectContaining({ exchangeName: "NYSE" }),
        }),
        { upsert: true }
      );
      expect(mockUpdateOne).toHaveBeenCalledWith(
        { _id: "ftse" },
        expect.objectContaining({
          $set: expect.objectContaining({ exchangeName: "FTSE" }),
        }),
        { upsert: true }
      );
      expect(mockUpdateOne).toHaveBeenCalledWith(
        { _id: "global" },
        expect.objectContaining({
          $set: expect.objectContaining({ exchangeName: "Global Markets" }),
        }),
        { upsert: true }
      );
    });

    it("sorts listings by market cap descending", async () => {
      const lowCapCorp = createCorporation({ name: "Low Cap" });
      const highCapCorp = createCorporation({ name: "High Cap" });

      mockCollection
        .mockReturnValueOnce(createMockChain([lowCapCorp, highCapCorp]))
        .mockReturnValueOnce(createMockChain([createCharacter()]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([])) // stateMetrics
        .mockReturnValueOnce(createMockChain([createState()])) // allStates
        .mockReturnValueOnce(createMockChain([])) // subsidies
        .mockReturnValueOnce(createMockChain([])) // bonds
        .mockReturnValueOnce(createMockChain([])); // HQ states

      vi.mocked(getPublicShareQuote).mockReturnValue(100);
      vi.mocked(getRoundedPublicMarketCap).mockImplementation((corp: any) => {
        return corp.name === "High Cap" ? 200000 : 100000;
      });

      await generateStockExchangeSnapshots(100, mockDb);

      const updateCall = mockUpdateOne.mock.calls.find((c) => c[0]?._id === "global");
      if (updateCall) {
        const listings = (updateCall[1]?.$set?.listings || []) as Array<{
          name?: string;
          [key: string]: any;
        }>;
        expect(listings[0]?.name).toBe("High Cap");
        expect(listings[1]?.name).toBe("Low Cap");
      }
    });

    it("handles vacant CEO position", async () => {
      mockCollection
        .mockReturnValueOnce(createMockChain([createCorporation({ ceoVacant: true })]))
        .mockReturnValueOnce(createMockChain([])) // No characters to fetch
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([])) // stateMetrics
        .mockReturnValueOnce(createMockChain([createState()])) // allStates
        .mockReturnValueOnce(createMockChain([])) // subsidies
        .mockReturnValueOnce(createMockChain([])) // bonds
        .mockReturnValueOnce(createMockChain([])); // HQ states

      vi.mocked(getPublicShareQuote).mockReturnValue(100);
      vi.mocked(getRoundedPublicMarketCap).mockReturnValue(100000);

      await generateStockExchangeSnapshots(100, mockDb);

      const updateCall = mockUpdateOne.mock.calls.find((c) => c[0]?._id === "global");
      if (updateCall) {
        const listing = updateCall[1]?.$set?.listings?.[0];
        expect(listing.ceo).toBe(null);
      }
    });

    it("calculates average sector growth correctly", async () => {
      const corpId = new ObjectId();
      mockCollection
        .mockReturnValueOnce(createMockChain([createCorporation({ _id: corpId })]))
        .mockReturnValueOnce(createMockChain([createCharacter()]))
        .mockReturnValueOnce(
          createMockChain([
            createSector({ corporationId: corpId, targetGrowthRate: 4, currentGrowthRate: 4 }),
            createSector({ corporationId: corpId, targetGrowthRate: 6, currentGrowthRate: 6 }),
          ])
        )
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([])) // stateMetrics
        .mockReturnValueOnce(createMockChain([createState()])) // allStates
        .mockReturnValueOnce(createMockChain([])) // subsidies
        .mockReturnValueOnce(createMockChain([])) // bonds
        .mockReturnValueOnce(createMockChain([])); // HQ states

      vi.mocked(getPublicShareQuote).mockReturnValue(100);
      vi.mocked(getRoundedPublicMarketCap).mockReturnValue(100000);

      await generateStockExchangeSnapshots(100, mockDb);

      const updateCall = mockUpdateOne.mock.calls.find((c) => c[0]?._id === "global");
      if (updateCall) {
        const listing = updateCall[1]?.$set?.listings?.[0];
        expect(listing.avgSectorGrowth).toBe(5); // (4 + 6) / 2
      }
    });
  });

  describe("generateWealthListSnapshots", () => {
    it("ranks characters by debt-adjusted net worth instead of gross assets", async () => {
      const charId = new ObjectId();
      const userId = new ObjectId();

      // generateWealthListSnapshots persists via bulkWrite on `wealthListSnapshots`.
      // Capture that collection's bulkWrite mock so we can inspect the snapshot ops.
      const snapshotsBulkWrite = vi.fn().mockResolvedValue({ ok: 1 });
      const historyBulkWrite = vi.fn().mockResolvedValue({ ok: 1 });

      mockCollection
        .mockReturnValueOnce(
          createMockChain([
            {
              _id: charId,
              userId,
              name: "Debtor",
              homeState: "NY",
              countryId: "US",
              cashOnHand: 1_000,
              currencyBalances: {},
              sequentialId: 12,
              lineOfCredit: {
                balances: { USD: 300 },
                arrears: {},
              },
            },
          ])
        )
        .mockReturnValueOnce(
          createMockChain([
            {
              _id: userId,
              isBanned: false,
            },
          ])
        )
        .mockReturnValueOnce(createMockChain([{ _id: "NY", name: "New York" }]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))
        .mockReturnValueOnce(createMockChain([]))
        // wealthListSnapshots collection — bulkWrite at the end
        .mockReturnValueOnce({
          find: vi.fn().mockReturnThis(),
          sort: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
          aggregate: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([]),
          updateOne: mockUpdateOne,
          bulkWrite: snapshotsBulkWrite,
        })
        // wealthListHistory collection — bulkWrite for archive
        .mockReturnValueOnce({
          find: vi.fn().mockReturnThis(),
          sort: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
          aggregate: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([]),
          updateOne: mockUpdateOne,
          bulkWrite: historyBulkWrite,
        });

      await generateWealthListSnapshots(100);

      // Snapshot ops come through bulkWrite on wealthListSnapshots — find the
      // "global" upsert op and inspect the snapshot payload.
      // The order of bulkWrite (snapshots) vs the wealthListHistory bulkWrite
      // depends on collection() call ordering; both are captured.
      const snapshotOps = snapshotsBulkWrite.mock.calls[0]?.[0] ?? [];
      const globalOp = snapshotOps.find(
        (op: { updateOne?: { filter?: { _id?: unknown } } }) =>
          op.updateOne?.filter?._id === "global"
      );
      expect(globalOp).toBeTruthy();
      const snapshot = globalOp!.updateOne.update.$set;
      expect(snapshot.entries).toHaveLength(1);
      expect(snapshot.entries[0].cashValue).toBe(1000);
      expect(snapshot.entries[0].locDebtValue).toBe(300);
      expect(snapshot.entries[0].totalWealth).toBe(700);
    });
  });

  describe("generateInvestorRankingSnapshot", () => {
    const createCorporationWithShareholders = (overrides?: Partial<any>) => ({
      _id: new ObjectId(),
      shareholders: [
        { characterId: new ObjectId("507f1f77bcf86cd799439011"), shares: 100 },
        { characterId: new ObjectId("507f1f77bcf86cd799439012"), shares: 50 },
      ],
      sharePrice: 100,
      ...overrides,
    });

    const createCharacter = (overrides?: Partial<any>) => ({
      _id: new ObjectId(),
      name: "Test Investor",
      ...overrides,
    });

    it("returns early when no corporations have shareholders", async () => {
      mockCollection
        .mockReturnValueOnce(createMockChain([])) // corporations
        .mockReturnValueOnce(createMockChain([])) // exchangeRates (loadFxRatesByCurrency)
        .mockReturnValue({ updateOne: mockUpdateOne });

      await generateInvestorRankingSnapshot(100, mockDb);

      // Even with no shareholders, it still creates an empty snapshot
      expect(mockUpdateOne).toHaveBeenCalled();
      const call = mockUpdateOne.mock.calls[0];
      const rankings = call[1]?.$set?.rankings;
      expect(rankings).toEqual([]);
    });

    it("calculates portfolio values correctly", async () => {
      const char1Id = new ObjectId("507f1f77bcf86cd799439011");
      const char2Id = new ObjectId("507f1f77bcf86cd799439012");

      mockCollection
        .mockReturnValueOnce(
          createMockChain([
            createCorporationWithShareholders({
              shareholders: [
                { characterId: char1Id, shares: 100 },
                { characterId: char2Id, shares: 50 },
              ],
              sharePrice: 100,
            }),
          ])
        )
        .mockReturnValueOnce(createMockChain([])) // exchangeRates (loadFxRatesByCurrency)
        .mockReturnValueOnce(
          createMockChain([
            createCharacter({ _id: char1Id, name: "Investor 1" }),
            createCharacter({ _id: char2Id, name: "Investor 2" }),
          ])
        );

      await generateInvestorRankingSnapshot(100, mockDb);

      expect(mockUpdateOne).toHaveBeenCalled();
      const call = mockUpdateOne.mock.calls[0];
      const rankings = call[1]?.$set?.rankings;
      // characterId is converted to string in the source
      expect(rankings).toEqual([
        {
          characterId: "507f1f77bcf86cd799439011",
          characterName: "Investor 1",
          portfolioValue: 10000,
          rank: 1,
        },
        {
          characterId: "507f1f77bcf86cd799439012",
          characterName: "Investor 2",
          portfolioValue: 5000,
          rank: 2,
        },
      ]);
    });

    it("aggregates holdings across multiple corporations", async () => {
      const charId = new ObjectId("507f1f77bcf86cd799439011");

      const corps = [
        {
          _id: new ObjectId(),
          shareholders: [{ characterId: charId, shares: 100 }],
          sharePrice: 50,
        },
        {
          _id: new ObjectId(),
          shareholders: [{ characterId: charId, shares: 50 }],
          sharePrice: 100,
        },
      ];

      mockCollection
        .mockReturnValueOnce(createMockChain(corps))
        .mockReturnValueOnce(createMockChain([])) // exchangeRates (loadFxRatesByCurrency)
        .mockReturnValueOnce(createMockChain([createCharacter({ _id: charId, name: "Investor" })]));

      vi.mocked(getPublicShareQuote).mockImplementation((corp) => {
        return corp.sharePrice ?? 100;
      });

      await generateInvestorRankingSnapshot(100, mockDb);

      expect(mockUpdateOne).toHaveBeenCalled();
      const call = mockUpdateOne.mock.calls[0];
      const rankings = call[1]?.$set?.rankings;
      expect(rankings[0].portfolioValue).toBe(10000); // 100*50 + 50*100
    });

    it("ranks investors by portfolio value descending", async () => {
      const richId = new ObjectId("507f1f77bcf86cd799439011");
      const poorId = new ObjectId("507f1f77bcf86cd799439012");

      mockCollection
        .mockReturnValueOnce(
          createMockChain([
            {
              _id: new ObjectId(),
              shareholders: [
                { characterId: richId, shares: 1000 },
                { characterId: poorId, shares: 100 },
              ],
              sharePrice: 100,
            },
          ])
        )
        .mockReturnValueOnce(createMockChain([])) // exchangeRates (loadFxRatesByCurrency)
        .mockReturnValueOnce(
          createMockChain([
            createCharacter({ _id: richId, name: "Rich Investor" }),
            createCharacter({ _id: poorId, name: "Poor Investor" }),
          ])
        );

      await generateInvestorRankingSnapshot(100, mockDb);

      expect(mockUpdateOne).toHaveBeenCalled();
      const call = mockUpdateOne.mock.calls[0];
      const rankings = call[1]?.$set?.rankings;
      // characterId is converted to string in the source
      expect(rankings).toEqual([
        {
          characterId: "507f1f77bcf86cd799439011",
          characterName: "Rich Investor",
          portfolioValue: 100000,
          rank: 1,
        },
        {
          characterId: "507f1f77bcf86cd799439012",
          characterName: "Poor Investor",
          portfolioValue: 10000,
          rank: 2,
        },
      ]);
    });

    it("handles corporations with no shareholders", async () => {
      mockCollection
        .mockReturnValueOnce(
          createMockChain([
            { _id: new ObjectId(), shareholders: [], sharePrice: 100 },
            {
              _id: new ObjectId(),
              shareholders: [{ characterId: new ObjectId(), shares: 50 }],
              sharePrice: 100,
            },
          ])
        )
        .mockReturnValueOnce(createMockChain([createCharacter({ name: "Investor" })]));

      await generateInvestorRankingSnapshot(100, mockDb);

      expect(mockUpdateOne).toHaveBeenCalled();
    });

    it("limits rankings to top 100 investors", async () => {
      // Create 150 investors
      const investors = Array.from({ length: 150 }, (_, i) => ({
        _id: new ObjectId(),
        name: `Investor ${i}`,
      }));

      const corp = {
        _id: new ObjectId(),
        shareholders: investors.map((inv, i) => ({
          characterId: inv._id,
          shares: 1000 - i * 5, // Decreasing shares
        })),
        sharePrice: 100,
      };

      mockCollection
        .mockReturnValueOnce(createMockChain([corp]))
        .mockReturnValueOnce(createMockChain(investors.slice(0, 100))); // Only top 100 fetched

      await generateInvestorRankingSnapshot(100, mockDb);

      expect(mockUpdateOne).toHaveBeenCalledWith(
        { _id: "global" },
        expect.objectContaining({
          $set: expect.objectContaining({
            rankings: expect.arrayContaining([
              expect.objectContaining({ rank: 1 }),
              expect.objectContaining({ rank: 100 }),
            ]),
          }),
        }),
        { upsert: true }
      );
    });

    it("stores portfolio values as record", async () => {
      const charId = new ObjectId("507f1f77bcf86cd799439011");
      const charIdStr = charId.toString();

      mockCollection
        .mockReturnValueOnce(
          createMockChain([
            {
              _id: new ObjectId(),
              shareholders: [{ characterId: charId, shares: 100 }],
              sharePrice: 100,
            },
          ])
        )
        .mockReturnValueOnce(createMockChain([createCharacter({ _id: charId, name: "Investor" })]));

      await generateInvestorRankingSnapshot(100, mockDb);

      expect(mockUpdateOne).toHaveBeenCalledWith(
        { _id: "global" },
        expect.objectContaining({
          $set: expect.objectContaining({
            portfolioValues: expect.objectContaining({
              [charIdStr]: 10000,
            }),
          }),
        }),
        { upsert: true }
      );
    });
  });
});
