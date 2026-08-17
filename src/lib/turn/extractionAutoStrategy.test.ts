import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { processExtractionAutoStrategy } from "./extractionAutoStrategy";
import { capacityRescaleRatio } from "@/lib/constants/capacityEconomy";

function cursor<T>(rows: T[]) {
  const c = { toArray: vi.fn().mockResolvedValue(rows), project: vi.fn(() => c) };
  return c;
}

const ENABLED = { extractionAutoStrategyEnabled: true, lastExtractionAutoStrategyTurn: 0 };

describe("processExtractionAutoStrategy", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const n of [
      "commodityPrices",
      "stateResourceCapacity",
      "corporateSectors",
      "gameState",
      "corporations",
      "gameConfig",
    ])
      db.collection(n);
    // Market mode drives the D9 gate below; default the fleet to pre-plants so
    // only the tests that opt in exercise the rescale.
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "capital",
    });
    // Pass 2 (NPP re-strategize) is inert in these tests: no NPP corps.
    db.collectionMocks.corporations.find.mockReturnValue(cursor([]));
  });

  function seed(opts: {
    rareEarthSD: number;
    stateCap: number;
    stateSupply: number;
    sectors: unknown[];
  }) {
    db.collectionMocks.commodityPrices.find.mockReturnValue(
      cursor([
        {
          commodity: "rare_earth",
          globalSupply: opts.rareEarthSD * 1000,
          globalDemand: 1000,
          stateSupply: { HB: opts.stateSupply },
        },
      ])
    );
    db.collectionMocks.stateResourceCapacity.find.mockReturnValue(
      cursor([{ stateId: "HB", resources: { rare_earth: opts.stateCap } }])
    );
    db.collectionMocks.corporateSectors.find.mockReturnValue(cursor(opts.sectors));
  }

  it("is inert when the flag is off", async () => {
    const res = await processExtractionAutoStrategy(db as unknown as Db, 10, {});
    expect(res.converted).toBe(0);
    expect(res.skippedReason).toBe("disabled");
    expect(db.collectionMocks.corporateSectors.bulkWrite).not.toHaveBeenCalled();
  });

  it("respects the cadence interval", async () => {
    const res = await processExtractionAutoStrategy(db as unknown as Db, 2, ENABLED); // < 4 turns since 0
    expect(res.converted).toBe(0);
    expect(res.skippedReason).toBe("cadence");
  });

  it("converts a standard miner on a shortage deposit with per-state headroom", async () => {
    const sectorId = new ObjectId();
    seed({
      rareEarthSD: 0.2, // shortage
      stateCap: 1000,
      stateSupply: 50, // << capacity → headroom
      sectors: [{ _id: sectorId, stateId: "HB", revenue: 100, strategyId: "standard" }],
    });
    const res = await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);
    expect(res.converted).toBe(1);
    expect(res.byResource.rare_earth).toBe(1);
    const op = db.collectionMocks.corporateSectors.bulkWrite.mock.calls[0][0][0].updateOne;
    expect(op.filter._id).toEqual(sectorId);
    expect(op.update.$set.strategyId).toBe("rare_earth_mining");
    expect(op.update.$set.transitionFromStrategyId).toBe("standard");
    expect(op.update.$set.transitionStartTurn).toBe(10);
    // cadence stamped
    expect(db.collectionMocks.gameState.updateOne).toHaveBeenCalled();
  });

  it("does not convert when the state deposit is already maxed (no per-state headroom)", async () => {
    seed({
      rareEarthSD: 0.2,
      stateCap: 1000,
      stateSupply: 1000, // at capacity → converting yields nothing
      sectors: [{ _id: new ObjectId(), stateId: "HB", revenue: 100, strategyId: "standard" }],
    });
    const res = await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);
    expect(res.converted).toBe(0);
    expect(db.collectionMocks.corporateSectors.bulkWrite).not.toHaveBeenCalled();
  });

  it("does nothing when no resource is in global shortage", async () => {
    seed({
      rareEarthSD: 0.9, // above shortage threshold
      stateCap: 1000,
      stateSupply: 50,
      sectors: [{ _id: new ObjectId(), stateId: "HB", revenue: 100, strategyId: "standard" }],
    });
    const res = await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);
    expect(res.converted).toBe(0);
    expect(res.skippedReason).toBe("no-shortage");
  });

  // ── Pass 2: NPP expected-revenue re-strategize ─────────────────────────────

  function seedNppRestrategize(opts: { sector: Record<string, unknown>; capacities?: unknown[] }) {
    const corpId = new ObjectId();
    db.collectionMocks.commodityPrices.find.mockReturnValue(
      cursor([
        // No global shortage (S/D = 1) so pass 1 is inert; prices are lagged signals.
        {
          commodity: "iron",
          globalSupply: 1000,
          globalDemand: 1000,
          stateSupply: { HB: 1222 },
          globalPrice: 120,
          basePrice: 100,
        },
        {
          commodity: "rare_earth",
          globalSupply: 1000,
          globalDemand: 1000,
          stateSupply: { HB: 0 },
          globalPrice: 100,
          basePrice: 100,
        },
      ])
    );
    db.collectionMocks.stateResourceCapacity.find.mockReturnValue(
      cursor(opts.capacities ?? [{ stateId: "HB", resources: { iron: 1222, rare_earth: 50_000 } }])
    );
    db.collectionMocks.corporations.find.mockReturnValue(cursor([{ _id: corpId }]));
    db.collectionMocks.corporateSectors.find
      .mockReturnValueOnce(cursor([])) // pass 1 candidates (standard sectors)
      .mockReturnValueOnce(cursor([{ corporationId: corpId, ...opts.sector }])); // pass 2 NPP sectors
  }

  it("re-strategizes an NPP miner off a deposit its state cannot support (t899)", async () => {
    const sectorId = new ObjectId();
    // Focused on iron in a state whose iron capacity is fully consumed, while a
    // huge rare-earth deposit idles — the prod misallocation shape.
    seedNppRestrategize({
      sector: { _id: sectorId, stateId: "HB", strategyId: "iron_mining", soldFraction: 0.2 },
    });
    const res = await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);
    expect(res.restrategized).toBe(1);
    expect(res.restrategizedByStrategy).toEqual({ rare_earth_mining: 1 });
    const op = db.collectionMocks.corporateSectors.bulkWrite.mock.calls[0][0][0].updateOne;
    expect(op.filter._id).toEqual(sectorId);
    expect(op.update.$set.strategyId).toBe("rare_earth_mining");
    expect(op.update.$set.transitionFromStrategyId).toBe("iron_mining");
  });

  it("respects the strategy cooldown in the NPP pass", async () => {
    seedNppRestrategize({
      sector: {
        _id: new ObjectId(),
        stateId: "HB",
        strategyId: "iron_mining",
        transitionCooldownUntilTurn: 20,
      },
    });
    const res = await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);
    expect(res.restrategized).toBe(0);
    expect(db.collectionMocks.corporateSectors.bulkWrite).not.toHaveBeenCalled();
  });

  it("keeps an NPP miner whose current strategy is already the best fit", async () => {
    // Plenty of iron headroom and an iron price premium → iron_mining stays.
    seedNppRestrategize({
      sector: { _id: new ObjectId(), stateId: "HB", strategyId: "iron_mining", soldFraction: 0.9 },
      capacities: [{ stateId: "HB", resources: { iron: 1_000_000, rare_earth: 1_000_000 } }],
    });
    const res = await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);
    expect(res.restrategized).toBe(0);
    expect(db.collectionMocks.corporateSectors.bulkWrite).not.toHaveBeenCalled();
  });

  it("skips a sector whose state has no deposit for the shortage resource", async () => {
    db.collectionMocks.commodityPrices.find.mockReturnValue(
      cursor([{ commodity: "rare_earth", globalSupply: 200, globalDemand: 1000, stateSupply: {} }])
    );
    db.collectionMocks.stateResourceCapacity.find.mockReturnValue(
      cursor([{ stateId: "ZZ", resources: { iron: 1000 } }]) // no rare earth here
    );
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([{ _id: new ObjectId(), stateId: "ZZ", revenue: 100, strategyId: "standard" }])
    );
    const res = await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);
    expect(res.converted).toBe(0);
  });

  describe("D9 — capacity renormalization on an automatic retool", () => {
    /**
     * This is the worst case in the game for the D9 hazard: the auto-adopter
     * moves miners from the broad "standard" mix onto a focused one, and
     * extraction mixes differ by two orders of magnitude in revenue per output
     * unit. Un-normalized, a free system nudge would hand the miner a capacity
     * windfall it never built and never paid for.
     */
    const RATIO = capacityRescaleRatio("extraction", "standard", "rare_earth_mining");

    /** The rescale is plants-only; opt this describe's world into the tier. */
    function enablePlants() {
      db.collectionMocks.gameConfig.findOne.mockResolvedValue({
        _id: "default",
        marketSystemMode: "plants",
      });
    }

    it("scales capitalStock so the nameplate survives the mix change", async () => {
      enablePlants();
      seed({
        rareEarthSD: 0.2,
        stateCap: 1000,
        stateSupply: 50,
        sectors: [
          {
            _id: new ObjectId(),
            stateId: "HB",
            revenue: 100,
            strategyId: "standard",
            capitalStock: 4_000,
          },
        ],
      });
      await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);
      const set = db.collectionMocks.corporateSectors.bulkWrite.mock.calls[0][0][0].updateOne.update
        .$set as { capitalStock: number };
      expect(RATIO).not.toBe(1);
      expect(set.capitalStock).toBeCloseTo(4_000 * RATIO, 6);
    });

    it("scales orders in flight but never the cash already paid for them", async () => {
      enablePlants();
      seed({
        rareEarthSD: 0.2,
        stateCap: 1000,
        stateSupply: 50,
        sectors: [
          {
            _id: new ObjectId(),
            stateId: "HB",
            revenue: 100,
            strategyId: "standard",
            capitalStock: 1_000,
            buildQueue: [
              { unitsOrdered: 500, costPaidAnchor: 250_000, startTurn: 1, onlineTurn: 97 },
            ],
          },
        ],
      });
      await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);
      const set = db.collectionMocks.corporateSectors.bulkWrite.mock.calls[0][0][0].updateOne.update
        .$set as { buildQueue: Array<{ unitsOrdered: number; costPaidAnchor: number }> };
      expect(set.buildQueue[0].unitsOrdered).toBeCloseTo(500 * RATIO, 6);
      expect(set.buildQueue[0].costPaidAnchor).toBe(250_000);
    });

    it("writes nothing capacity-related for a sector that owns no capacity", async () => {
      seed({
        rareEarthSD: 0.2,
        stateCap: 1000,
        stateSupply: 50,
        sectors: [{ _id: new ObjectId(), stateId: "HB", revenue: 100, strategyId: "standard" }],
      });
      await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);
      const set = db.collectionMocks.corporateSectors.bulkWrite.mock.calls[0][0][0].updateOne.update
        .$set as Record<string, unknown>;
      expect(set).not.toHaveProperty("capitalStock");
      expect(set).not.toHaveProperty("buildQueue");
    });

    // BELOW-PLANTS BYTE-IDENTITY PIN. Under CAPITAL mode `capitalStock` is
    // production-gating state, not an RPU-denominated capacity, so an auto
    // retool must leave it (and the queue) exactly where it found it.
    it("leaves capitalStock and buildQueue untouched below plants", async () => {
      seed({
        rareEarthSD: 0.2,
        stateCap: 1000,
        stateSupply: 50,
        sectors: [
          {
            _id: new ObjectId(),
            stateId: "HB",
            revenue: 100,
            strategyId: "standard",
            capitalStock: 4_000,
            buildQueue: [
              { unitsOrdered: 500, costPaidAnchor: 250_000, startTurn: 1, onlineTurn: 97 },
            ],
          },
        ],
      });
      await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);
      const set = db.collectionMocks.corporateSectors.bulkWrite.mock.calls[0][0][0].updateOne.update
        .$set as Record<string, unknown>;
      expect(set.strategyId).toBe("rare_earth_mining");
      expect(set).not.toHaveProperty("capitalStock");
      expect(set).not.toHaveProperty("buildQueue");
      expect(set.retoolRescaleApplied).toBe(false);
    });

    it("holds total physical opex fixed when a calibrated plant is auto-retooled", async () => {
      enablePlants();
      const capitalStock = 4_000;
      const otherOpexPerUnitAnchor = 12.5;
      seed({
        rareEarthSD: 0.2,
        stateCap: 1000,
        stateSupply: 50,
        sectors: [
          {
            _id: new ObjectId(),
            stateId: "HB",
            revenue: 100,
            strategyId: "standard",
            capitalStock,
            otherOpexPerUnitAnchor,
          },
        ],
      });
      await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);
      const set = db.collectionMocks.corporateSectors.bulkWrite.mock.calls[0][0][0].updateOne.update
        .$set as {
        capitalStock: number;
        otherOpexPerUnitAnchor: number;
        retoolRescaleApplied: boolean;
      };
      expect(RATIO).not.toBe(1);
      expect(set.retoolRescaleApplied).toBe(true);
      expect(set.capitalStock).toBeCloseTo(capitalStock * RATIO, 6);
      expect(set.otherOpexPerUnitAnchor).toBeCloseTo(otherOpexPerUnitAnchor / RATIO, 8);
      expect(set.otherOpexPerUnitAnchor * set.capitalStock).toBeCloseTo(
        otherOpexPerUnitAnchor * capitalStock,
        6
      );
    });
  });

  it("scores pass 2 on host reachable prices, not the global book", async () => {
    // Global book screams timber; the US reachable book screams iron. A miner
    // in NC with headroom on both must follow the market it can actually sell
    // into. S/D is 1.0 so pass 1's shortage map is empty (the mock find does
    // not apply Mongo filters).
    const sectorId = new ObjectId();
    const corpId = new ObjectId();
    db.collectionMocks.commodityPrices.find.mockReturnValue(
      cursor([
        {
          commodity: "timber",
          globalSupply: 1000,
          globalDemand: 1000,
          stateSupply: { NC: 100 },
          globalPrice: 300,
          basePrice: 100,
          nationalPrices: { US: 100 },
          reachablePrices: { US: 100 },
        },
        {
          commodity: "iron",
          globalSupply: 1000,
          globalDemand: 1000,
          stateSupply: { NC: 100 },
          globalPrice: 100,
          basePrice: 100,
          nationalPrices: { US: 300 },
          reachablePrices: { US: 300 },
        },
      ])
    );
    db.collectionMocks.stateResourceCapacity.find.mockReturnValue(
      cursor([{ stateId: "NC", resources: { timber: 10_000, iron: 10_000 } }])
    );
    db.collectionMocks.corporations.find.mockReturnValue(
      cursor([{ _id: corpId, countryId: "US" }])
    );
    db.collectionMocks.corporateSectors.find.mockReturnValueOnce(cursor([])).mockReturnValueOnce(
      cursor([
        {
          _id: sectorId,
          corporationId: corpId,
          countryId: "US",
          stateId: "NC",
          strategyId: "timber_logging",
          soldFraction: 0.9,
          capitalStock: 4_000,
          otherOpexPerUnitAnchor: 12.5,
        },
      ])
    );
    const res = await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);
    expect(res.restrategized).toBe(1);
    expect(res.restrategizedByStrategy).toEqual({ iron_mining: 1 });
    const set = db.collectionMocks.corporateSectors.bulkWrite.mock.calls[0][0][0].updateOne.update
      .$set as Record<string, unknown>;
    expect(set.strategyId).toBe("iron_mining");
    expect(set.transitionFromStrategyId).toBe("timber_logging");
  });

  it("does not retool a chemical sector (generic pass removed)", async () => {
    const corpId = new ObjectId();
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentYear: 2019 });
    db.collectionMocks.commodityPrices.find.mockReturnValue(
      cursor([
        {
          commodity: "iron",
          globalSupply: 1000,
          globalDemand: 1000,
          stateSupply: {},
          globalPrice: 100,
          basePrice: 100,
        },
        {
          commodity: "fertilizers",
          globalSupply: 1000,
          globalDemand: 1000,
          globalPrice: 230,
          basePrice: 100,
        },
        {
          commodity: "chemicals",
          globalSupply: 1000,
          globalDemand: 1000,
          globalPrice: 80,
          basePrice: 100,
        },
      ])
    );
    db.collectionMocks.stateResourceCapacity.find.mockReturnValue(cursor([]));
    db.collectionMocks.corporations.find.mockReturnValue(
      cursor([{ _id: corpId, countryId: "US" }])
    );
    db.collectionMocks.corporateSectors.find
      .mockReturnValueOnce(cursor([])) // pass 1
      .mockReturnValueOnce(cursor([])) // pass 2 extraction
      .mockReturnValueOnce(
        cursor([
          {
            _id: new ObjectId(),
            corporationId: corpId,
            countryId: "US",
            sectorType: "chemical_industries",
            strategyId: "standard",
            soldFraction: 0.9,
          },
        ])
      ); // would have been pass 3
    const res = await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);
    expect(res.genericRestrategized).toBe(0);
    expect(res.restrategized).toBe(0);
    expect(db.collectionMocks.corporateSectors.bulkWrite).not.toHaveBeenCalled();
  });
});
