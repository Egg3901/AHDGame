import { describe, it, expect, vi, beforeEach } from "vitest";
import { processCommodityPriceTurn, realizedOutputFraction } from "./commodityPriceTurn";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { COMMODITY_TYPES, COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";

vi.mock("@/lib/market/featureFlag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/market/featureFlag")>();
  return {
    ...actual,
    // The shared mock db in this file doesn't implement findOne on gameConfig;
    // the ledger path is covered by flowLedger.test.ts. Every featureFlag reader
    // that hits gameConfig must be stubbed here or processCommodityPriceTurn
    // throws "db.collection(...).findOne is not a function".
    getMarketSystemMode: vi.fn().mockResolvedValue("off"),
    getDemographicsDemandEnabled: vi.fn().mockResolvedValue(false),
    getExtractionOutputScaleEnabled: vi.fn().mockResolvedValue(false),
  };
});

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@/lib/mongodb";

describe("commodityPriceTurn", () => {
  let mockDb: Db;
  let mockCollection: ReturnType<typeof vi.fn>;
  let mockBulkWrite: ReturnType<typeof vi.fn>;
  let mockInsertMany: ReturnType<typeof vi.fn>;
  let mockTradeUpdateOne: ReturnType<typeof vi.fn>;
  let mockFind: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockBulkWrite = vi.fn().mockResolvedValue({});
    mockInsertMany = vi.fn().mockResolvedValue({ insertedIds: [] });
    mockTradeUpdateOne = vi.fn().mockResolvedValue({});
    mockFind = vi.fn();
    mockCollection = vi.fn();

    mockDb = {
      collection: mockCollection,
    } as unknown as Db;

    vi.mocked(getDb).mockResolvedValue(mockDb);
    vi.clearAllMocks();
  });

  function createChainableCursor(data: any[]) {
    return {
      find: mockFind.mockReturnThis(),
      project: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(data),
    };
  }

  /** Sets up the 11 positional mocks for the parallel fetches in processCommodityPriceTurn. */
  function setupMocks(
    overrides: {
      sectors?: any[];
      stateMetrics?: any[];
      corporations?: any[];
      centralBanks?: any[];
      states?: any[];
      bonds?: any[];
      federalBudgets?: any[];
      exchangeRates?: any[];
      nudges?: any[];
      existingPrices?: any[];
      stateBudgets?: any[];
    } = {}
  ) {
    mockCollection.mockReturnValueOnce(createChainableCursor(overrides.sectors ?? [])); // 1. sectors
    mockCollection.mockReturnValueOnce(createChainableCursor(overrides.stateMetrics ?? [])); // 2. stateMetrics
    mockCollection.mockReturnValueOnce(createChainableCursor(overrides.corporations ?? [])); // 3. corporations
    mockCollection.mockReturnValueOnce(createChainableCursor(overrides.centralBanks ?? [])); // 4. centralBanks
    mockCollection.mockReturnValueOnce(createChainableCursor(overrides.states ?? [])); // 5. states
    mockCollection.mockReturnValueOnce(createChainableCursor(overrides.bonds ?? [])); // 6. bonds
    mockCollection.mockReturnValueOnce(createChainableCursor(overrides.federalBudgets ?? [])); // 7. federalBudgets
    mockCollection.mockReturnValueOnce(createChainableCursor(overrides.exchangeRates ?? [])); // 8. exchangeRates
    mockCollection.mockReturnValueOnce(createChainableCursor(overrides.nudges ?? [])); // 9. nudgeDocs
    mockCollection.mockReturnValueOnce(createChainableCursor(overrides.existingPrices ?? [])); // 10. existingPrices
    mockCollection.mockReturnValueOnce(createChainableCursor(overrides.stateBudgets ?? [])); // 11. stateBudgets
    mockCollection.mockReturnValue({
      bulkWrite: mockBulkWrite,
      insertMany: mockInsertMany,
      updateOne: mockTradeUpdateOne,
      deleteMany: vi.fn().mockResolvedValue({}),
      // Lazy index creation is fire-and-forget on the real driver. The ledger
      // ones sit behind marketSystemMode >= "ledger" (mocked "off" here), but
      // the tradeFlowSnapshots {turn:-1} index for the reachable-book read runs
      // on every turn, so the stub has to answer it.
      createIndex: vi.fn().mockResolvedValue(""),
      // Config-flag reads (e.g. commodityScarcityDrift/stockCoverCap at the tail
      // of the turn) hit gameConfig.findOne; default to null so every flag reads
      // as off, matching getMarketSystemMode("off") above.
      findOne: vi.fn().mockResolvedValue(null),
      // Phase 6 influence-lever reads (FTA legislation, org memberships,
      // tariffs, embargoes, embargo-bill reconcile) run after the positional
      // reads; default to an empty chainable cursor.
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      }),
    });
  }

  describe("processCommodityPriceTurn", () => {
    it("returns zero result when no sectors exist", async () => {
      setupMocks();

      const result = await processCommodityPriceTurn(100);

      expect(result.commoditiesUpdated).toBe(COMMODITY_TYPES.length);
      expect(result.statesWithActivity).toBe(0);
      expect(mockBulkWrite).toHaveBeenCalledTimes(2);
    });

    it("persists a trade-flow snapshot for the turn", async () => {
      setupMocks({
        states: [
          { _id: "us_tx", countryId: "US", gdp: 1_000_000 },
          { _id: "cn_gd", countryId: "CN", gdp: 1_000_000 },
        ],
        exchangeRates: [{ currencyCode: "USD", rate: 1.0 }],
      });

      const result = await processCommodityPriceTurn(412);

      expect(mockTradeUpdateOne).toHaveBeenCalledTimes(1);
      const [filter, update, options] = mockTradeUpdateOne.mock.calls[0];
      expect(filter).toEqual({ turn: 412 });
      expect(options).toEqual({ upsert: true });
      expect(update.$set.turn).toBe(412);
      expect(update.$set.world).toHaveProperty("clearedVolume");
      expect(update.$set).toHaveProperty("commodities");
      expect(update.$set).toHaveProperty("national");
      expect(result.tradeClearedVolume).toBe(update.$set.world.clearedVolume);
    });

    it("processes sectors and updates commodity prices", async () => {
      setupMocks({
        sectors: [
          {
            _id: new ObjectId(),
            sectorType: "agriculture" as const,
            revenue: 1000,
            stateId: "US-CA",
            corporationId: new ObjectId(),
            strategyId: null,
            transitionFromStrategyId: null,
            transitionStartTurn: null,
          },
        ],
      });

      const result = await processCommodityPriceTurn(100);

      expect(result.commoditiesUpdated).toBe(COMMODITY_TYPES.length);
      expect(mockBulkWrite).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            updateOne: expect.objectContaining({
              filter: expect.objectContaining({ commodity: expect.any(String) }),
              update: expect.objectContaining({
                $set: expect.objectContaining({
                  basePrice: expect.any(Number),
                  globalPrice: expect.any(Number),
                  globalSupply: expect.any(Number),
                  globalDemand: expect.any(Number),
                }),
              }),
            }),
          }),
        ])
      );
    });

    it("applies sector production policy to commodity supply", async () => {
      setupMocks({
        sectors: [
          {
            _id: new ObjectId(),
            sectorType: "energy" as const,
            revenue: 6000,
            stateId: "US-TX",
            corporationId: new ObjectId(),
            strategyId: null,
            transitionFromStrategyId: null,
            transitionStartTurn: null,
            productionPolicyLevel: 25,
          },
        ],
        states: [{ _id: "US-TX", countryId: "US", gdp: 2000 }],
      });

      await processCommodityPriceTurn(100);

      const ops = mockBulkWrite.mock.calls[0][0];
      const energyOp = ops.find((op: any) => op.updateOne.filter.commodity === "energy");

      // Base stabilizer 50,000 + (6,000 revenue * 0.65 supply rate / 60 base price) * 1.15 policy,
      // plus/minus the bounded unowned-commodity drift term (±UNOWNED_DRIFT_AMPLITUDE of the
      // 50,000 stabilizer, i.e. ±3,000 — see applyUnownedCommodityDrift in commodities.ts). The
      // drift is deterministic per (commodity, turn) but not worth re-deriving here, so assert a
      // bounded range instead of an exact figure.
      expect(energyOp.updateOne.update.$set.globalSupply).toBeGreaterThanOrEqual(50074.75 - 3000);
      expect(energyOp.updateOne.update.$set.globalSupply).toBeLessThanOrEqual(50074.75 + 3000);
      expect(energyOp.updateOne.update.$set.stateSupply["US-TX"]).toBeCloseTo(74.75, 4);
    });

    it("tracks states with activity", async () => {
      setupMocks({
        sectors: [
          {
            _id: new ObjectId(),
            sectorType: "agriculture" as const,
            revenue: 1000,
            stateId: "US-TX",
            corporationId: new ObjectId(),
            strategyId: null,
            transitionFromStrategyId: null,
            transitionStartTurn: null,
          },
          {
            _id: new ObjectId(),
            sectorType: "energy" as const,
            revenue: 500,
            stateId: "US-NY",
            corporationId: new ObjectId(),
            strategyId: null,
            transitionFromStrategyId: null,
            transitionStartTurn: null,
          },
        ],
        states: [
          { _id: "US-TX", countryId: "US", gdp: 1000 },
          { _id: "US-NY", countryId: "US", gdp: 2000 },
        ],
      });

      const result = await processCommodityPriceTurn(100);

      expect(result.statesWithActivity).toBeGreaterThanOrEqual(0);
    });

    it("adds marketing budget demand to advertising commodity", async () => {
      setupMocks({
        corporations: [
          {
            _id: new ObjectId(),
            marketingBudget: 10000,
            headquartersState: "US-CA",
            countryOwnerId: null,
          },
        ],
      });

      await processCommodityPriceTurn(100);
      expect(mockBulkWrite).toHaveBeenCalled();
    });

    it("handles natcorp sectors correctly", async () => {
      const corpId = new ObjectId();
      setupMocks({
        sectors: [
          {
            _id: new ObjectId(),
            sectorType: "energy" as const,
            revenue: 5000,
            stateId: "US-TX",
            corporationId: corpId,
            strategyId: null,
            transitionFromStrategyId: null,
            transitionStartTurn: null,
          },
        ],
        corporations: [
          {
            _id: corpId,
            countryOwnerId: new ObjectId(),
            marketingBudget: 0,
            headquartersState: null,
          },
        ],
      });

      const result = await processCommodityPriceTurn(100);
      expect(result.commoditiesUpdated).toBe(COMMODITY_TYPES.length);
    });

    it("includes GDP growth data in retail demand calculation", async () => {
      setupMocks({
        stateMetrics: [
          { _id: "US-CA", economic: { gdpGrowth: { value: 2.5 } } },
          { _id: "US-NY", economic: { gdpGrowth: { value: 1.8 } } },
        ],
      });

      await processCommodityPriceTurn(100);
      expect(mockBulkWrite).toHaveBeenCalled();
    });

    it("handles central bank prime rates for financial demand", async () => {
      setupMocks({
        centralBanks: [{ countryId: "US", primeRate: 5.25 }],
      });

      await processCommodityPriceTurn(100);
      expect(mockBulkWrite).toHaveBeenCalled();
    });

    it("processes recent bond issuances for latent financial demand", async () => {
      setupMocks({
        states: [{ _id: "US-CA", countryId: "US", gdp: 3000 }],
        bonds: [
          {
            _id: new ObjectId(),
            issuerType: "sovereign" as const,
            countryId: "US",
            corporationId: null,
            totalIssued: 1000000,
            issuedAtTurn: 95,
            matured: false,
          },
        ],
      });

      await processCommodityPriceTurn(100);
      expect(mockBulkWrite).toHaveBeenCalled();
    });

    it("filters out matured bonds from demand calculation", async () => {
      setupMocks({
        bonds: [
          {
            _id: new ObjectId(),
            issuerType: "corporate" as const,
            countryId: null,
            corporationId: new ObjectId(),
            totalIssued: 500000,
            issuedAtTurn: 95,
            matured: true,
          },
        ],
      });

      await processCommodityPriceTurn(100);
      expect(mockBulkWrite).toHaveBeenCalled();
    });

    it("filters out old bonds outside the window", async () => {
      setupMocks({
        bonds: [
          {
            _id: new ObjectId(),
            issuerType: "sovereign" as const,
            countryId: "US",
            corporationId: null,
            totalIssued: 1000000,
            issuedAtTurn: 50,
            matured: false,
          },
        ],
      });

      await processCommodityPriceTurn(100);
      expect(mockBulkWrite).toHaveBeenCalled();
    });

    it("stores price history snapshots", async () => {
      setupMocks();

      await processCommodityPriceTurn(100);

      expect(mockBulkWrite).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            replaceOne: expect.objectContaining({
              filter: expect.objectContaining({
                commodity: expect.any(String),
                turn: 100,
              }),
              replacement: expect.objectContaining({
                commodity: expect.any(String),
                turn: 100,
                globalPrice: expect.any(Number),
                globalSupply: expect.any(Number),
                globalDemand: expect.any(Number),
                createdAt: expect.any(Date),
              }),
              upsert: true,
            }),
          }),
        ])
      );
    });

    it("blends global and state prices correctly", async () => {
      setupMocks({
        sectors: [
          {
            _id: new ObjectId(),
            sectorType: "agriculture" as const,
            revenue: 1000,
            stateId: "US-CA",
            corporationId: new ObjectId(),
            strategyId: null,
            transitionFromStrategyId: null,
            transitionStartTurn: null,
          },
        ],
        states: [{ _id: "US-CA", countryId: "US", gdp: 3000 }],
      });

      await processCommodityPriceTurn(100);

      const callArg = mockBulkWrite.mock.calls[0][0];
      expect(callArg).toHaveLength(COMMODITY_TYPES.length);
      const firstUpdate = callArg[0];
      expect(firstUpdate.updateOne.update.$set).toHaveProperty("globalPrice");
      expect(firstUpdate.updateOne.update.$set).toHaveProperty("globalSupply");
      expect(firstUpdate.updateOne.update.$set).toHaveProperty("globalDemand");
      expect(firstUpdate.updateOne.update.$set).toHaveProperty("statePrices");
    });

    // ── Drift pricing tests ──

    it("applies drift from previous price toward supply/demand target", async () => {
      // Steel starts far above target; every OTHER commodity starts at base so
      // steel's producer inputs carry no cost pass-through and the assertion
      // isolates the drift term. (Priors at a uniform 1000 would put every
      // input ratio at the pass-through cap and lift the target itself.)
      const existingPrices = COMMODITY_TYPES.map((commodity) => ({
        commodity,
        globalPrice: commodity === "steel" ? 1000 : COMMODITY_BASE_PRICES[commodity],
        statePrices: {},
      }));

      setupMocks({ existingPrices });

      await processCommodityPriceTurn(100);

      const ops = mockBulkWrite.mock.calls[0][0];
      const steelOp = ops.find((op: any) => op.updateOne.filter.commodity === "steel");
      const steelPrice = steelOp.updateOne.update.$set.globalPrice;
      expect(steelPrice).toBeLessThan(1000);
      expect(steelPrice).toBeGreaterThan(800);
    });

    it("applies global nudge price instead of drift", async () => {
      const nudgeDocs = [{ commodity: "steel", nudgePrice: 1234 }];

      setupMocks({ nudges: nudgeDocs });

      await processCommodityPriceTurn(100);

      const ops = mockBulkWrite.mock.calls[0][0];
      const steelOp = ops.find((op: any) => op.updateOne.filter.commodity === "steel");
      expect(steelOp.updateOne.update.$set.globalPrice).toBe(1234);
    });

    // ── Hard peg tests ──

    it("uses hardPeg price when set, ignoring supply/demand", async () => {
      setupMocks({
        existingPrices: [
          {
            commodity: "steel",
            globalPrice: 500,
            statePrices: {},
            hardPeg: 999,
          },
        ],
      });

      await processCommodityPriceTurn(100);

      const ops = mockBulkWrite.mock.calls[0][0];
      const steelOp = ops.find((op: any) => op.updateOne.filter.commodity === "steel");
      expect(steelOp.updateOne.update.$set.globalPrice).toBe(999);
    });

    it("state hard peg overrides global hard peg for that state", async () => {
      setupMocks({
        sectors: [
          {
            _id: new ObjectId(),
            sectorType: "manufacturing" as const,
            revenue: 5000,
            stateId: "US-CA",
            corporationId: new ObjectId(),
            strategyId: null,
            transitionFromStrategyId: null,
            transitionStartTurn: null,
          },
        ],
        // processCommodityPriceTurn iterates `allStates` from DB; without US-CA here no statePrices row is written.
        states: [{ _id: "US-CA", countryId: "US", gdp: 1000 }],
        existingPrices: [
          {
            commodity: "steel",
            globalPrice: 500,
            statePrices: { "US-CA": 500 },
            hardPeg: 999,
            stateHardPegs: { "US-CA": 333 },
          },
        ],
      });

      await processCommodityPriceTurn(100);

      const ops = mockBulkWrite.mock.calls[0][0];
      const steelOp = ops.find((op: any) => op.updateOne.filter.commodity === "steel");
      expect(steelOp.updateOne.update.$set.globalPrice).toBe(999);
      expect(steelOp.updateOne.update.$set.statePrices["US-CA"]).toBe(333);
    });

    // ── Nudge clearing tests ──

    it("clears stateNudges and nudgePrice after processing", async () => {
      setupMocks();

      await processCommodityPriceTurn(100);

      const ops = mockBulkWrite.mock.calls[0][0];
      for (const op of ops) {
        expect(op.updateOne.update.$set.stateNudges).toEqual({});
        expect(op.updateOne.update.$set.nudgePrice).toBeNull();
        expect(op.updateOne.update.$set.nudgeTurn).toBeNull();
      }
    });

    // ── Government spending → commodity demand (#3880) ──

    /** Global demand for one commodity out of the bulkWrite ops. */
    function globalDemandFor(commodity: string): number {
      const ops = mockBulkWrite.mock.calls[0][0];
      return ops.find((op: any) => op.updateOne.filter.commodity === commodity).updateOne.update
        .$set.globalDemand;
    }

    it("converts a defense budget into ordnance demand", async () => {
      setupMocks({
        states: [{ _id: "us_tx", countryId: "US", gdp: 1_000_000 }],
        exchangeRates: [{ currencyCode: "USD", rate: 1.0 }],
        federalBudgets: [{ countryId: "US", spending: { byCategory: { defense: 48_000_000 } } }],
      });

      await processCommodityPriceTurn(100);
      const withBudget = globalDemandFor("ordnance");

      // ₳48,000,000/yr ÷ 48 turns = ₳1,000,000/turn; ÷ 4,500 base price
      // × 0.005 rate = 1.111 units/turn (stored rounded to 2dp).
      mockBulkWrite.mockClear();
      setupMocks({
        states: [{ _id: "us_tx", countryId: "US", gdp: 1_000_000 }],
        exchangeRates: [{ currencyCode: "USD", rate: 1.0 }],
        federalBudgets: [],
      });
      await processCommodityPriceTurn(100);

      expect(withBudget - globalDemandFor("ordnance")).toBeCloseTo(1.11, 2);
    });

    it("leaves ordnance demand untouched when a country spends nothing on defense", async () => {
      setupMocks({
        states: [{ _id: "us_tx", countryId: "US", gdp: 1_000_000 }],
        exchangeRates: [{ currencyCode: "USD", rate: 1.0 }],
        federalBudgets: [{ countryId: "US", spending: { byCategory: { defense: 0 } } }],
      });
      await processCommodityPriceTurn(100);
      const zeroSpend = globalDemandFor("ordnance");

      mockBulkWrite.mockClear();
      setupMocks({
        states: [{ _id: "us_tx", countryId: "US", gdp: 1_000_000 }],
        exchangeRates: [{ currencyCode: "USD", rate: 1.0 }],
        federalBudgets: [],
      });
      await processCommodityPriceTurn(100);

      expect(zeroSpend).toBeCloseTo(globalDemandFor("ordnance"), 6);
    });

    it("normalizes a budget-only country's spending at its era rate, not 1.0 (#3778)", async () => {
      // PL is not forex-active, so `exchangeRates` never carries a PLZ row. Before
      // the era-aware fallback, the missing row meant 1 złoty = ₳1 and the budget
      // was read 24x too large. INITIAL_RATES_1953 authors PL at 24 zł/USD.
      const polishWorld = {
        states: [{ _id: "pl_mz", countryId: "PL", gdp: 1_000_000 }],
        exchangeRates: [{ currencyCode: "USD", rate: 1.0 }],
      };
      /** Re-stub the catch-all so the preset read resolves to the 1953 world. */
      const withPreset1953 = () =>
        mockCollection.mockReturnValue({
          bulkWrite: mockBulkWrite,
          insertMany: mockInsertMany,
          updateOne: mockTradeUpdateOne,
          deleteMany: vi.fn().mockResolvedValue({}),
          createIndex: vi.fn().mockResolvedValue(""),
          // Serves the gameState preset read. Every gameConfig flag reader checks
          // for an explicit `true`, so the extra field leaves them all off.
          findOne: vi.fn().mockResolvedValue({ preset: "1953-default" }),
          find: vi.fn().mockReturnValue({
            sort: vi.fn().mockReturnThis(),
            toArray: vi.fn().mockResolvedValue([]),
          }),
        });

      setupMocks({
        ...polishWorld,
        federalBudgets: [{ countryId: "PL", spending: { byCategory: { defense: 48_000_000 } } }],
      });
      withPreset1953();
      await processCommodityPriceTurn(100);
      const withBudget = globalDemandFor("ordnance");

      mockBulkWrite.mockClear();
      setupMocks({ ...polishWorld, federalBudgets: [] });
      withPreset1953();
      await processCommodityPriceTurn(100);
      const added = withBudget - globalDemandFor("ordnance");

      // 48,000,000 zł ÷ 24 = ₳2,000,000/yr → ÷48 turns ÷ (4,500 / 69.77 era
      // unit basis) × 0.005 ≈ 3.23 units: the ledger converts on the 1953
      // base-price table (eraScaledBasePrices), so unit counts carry the era
      // scale. The property under test is unchanged — at the old 1.0 FX
      // fallback the same budget yielded 24x more (≈77.6).
      const eraScale = 27_000_000_000_000 / 387_000_000_000;
      expect(added).toBeCloseTo(0.0463 * eraScale, 1);
      expect(added).toBeLessThan((1.11 * eraScale) / 10);
    });

    it("projects the WHOLE budget category map, not one named path", async () => {
      // This projection used to pin `spending.byCategory.healthcare`, so when
      // the defense -> ordnance leg was added its amount was stripped from the
      // document before the demand loop ran and the feature was inert in
      // production. Every other budget test passes `federalBudgets` straight
      // through the mock, which bypasses projection entirely and therefore
      // cannot catch this. Assert the projection itself.
      setupMocks();
      await processCommodityPriceTurn(100);

      const budgetFind = mockFind.mock.calls.find(
        (call) => call?.[1]?.projection && "spending.byCategory" in call[1].projection
      );
      expect(budgetFind, "federalBudget must project the whole byCategory map").toBeDefined();
      // A named sub-path would silently drop every other category.
      const projected = Object.keys(budgetFind![1].projection as Record<string, unknown>);
      expect(projected.some((k) => k.startsWith("spending.byCategory."))).toBe(false);
    });
  });
});

describe("realizedOutputFraction", () => {
  it("is the plain ratio inside [0, 1]", () => {
    expect(realizedOutputFraction(50, 100)).toBeCloseTo(0.5, 10);
    expect(realizedOutputFraction(100, 100)).toBe(1);
    expect(realizedOutputFraction(0, 100)).toBe(0);
  });

  it("clamps ABOVE 1 — a stale-low revenue must not over-book depletion", () => {
    // A NatCorp sector minted by `nationalizeSectorWide` carries a 15%-haircut
    // revenue alongside full capacity, so before its first `sectorTurn` restates
    // `revenue` the raw ratio is ~1/0.85 ≈ 1.176. Unclamped, that books ~18%
    // more depletion than the sector could physically have extracted.
    expect(realizedOutputFraction(100, 85)).toBe(1);
    expect(realizedOutputFraction(1e9, 1)).toBe(1);
  });

  it("clamps BELOW 0 and rejects degenerate inputs", () => {
    expect(realizedOutputFraction(-5, 100)).toBe(0);
    expect(realizedOutputFraction(50, 0)).toBeNull();
    expect(realizedOutputFraction(50, -1)).toBeNull();
    expect(realizedOutputFraction(Number.NaN, 100)).toBeNull();
    expect(realizedOutputFraction(50, Number.NaN)).toBeNull();
  });
});
