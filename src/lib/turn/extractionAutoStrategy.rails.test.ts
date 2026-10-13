import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { spawnNppCorporation } from "@/lib/admin/spawnNppCorporation";
import {
  extractionShortageWeight,
  isExtractionShortage,
  processExtractionAutoStrategy,
} from "./extractionAutoStrategy";

vi.mock("@/lib/admin/spawnNppCorporation", () => ({
  generateNppCorpName: vi.fn(() => "Shortage Mining"),
  spawnNppCorporation: vi.fn(),
  NPP_CAPITAL_STATES: { US: "DC", FI: "FI_UUS" },
}));

function cursor<T>(rows: T[]) {
  const c = { toArray: vi.fn().mockResolvedValue(rows), project: vi.fn(() => c) };
  return c;
}

const ENABLED = { extractionAutoStrategyEnabled: true, lastExtractionAutoStrategyTurn: 0 };
const NPC_USER_ID = new ObjectId("000000000000000000000000");
const npcCorp = (_id: ObjectId, countryId = "US") => ({
  _id,
  countryId,
  ceoType: "npp",
  userId: NPC_USER_ID,
});

// Rare earth as live on 2026-10-13: S/D 0.67 sits above both S/D gates, but the
// price is 2.3x base.
const RARE_EARTH_SHORT_BY_PRICE = {
  commodity: "rare_earth",
  globalSupply: 670,
  globalDemand: 1000,
  globalPrice: 230,
  basePrice: 100,
  stateSupply: { AZ: 0 },
};

describe("extraction shortage signal", () => {
  it("counts a resource priced at the shared shortage bar as short", () => {
    expect(isExtractionShortage(0.67, 2.3, 0.6)).toBe(true);
    expect(isExtractionShortage(0.67, 1.2, 0.6)).toBe(false);
    expect(isExtractionShortage(0.5, null, 0.6)).toBe(true);
  });

  it("weights by the larger of the S/D gap and the price gap", () => {
    expect(extractionShortageWeight(0.67, 2.3)).toBeCloseTo(1 - 1 / 2.3);
    expect(extractionShortageWeight(0.4, 1.1)).toBeCloseTo(0.6);
    expect(extractionShortageWeight(1.5, 0.8)).toBe(0);
  });
});

describe("processExtractionAutoStrategy rails", () => {
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
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "capital",
    });
    db.collectionMocks.corporations.find.mockReturnValue(cursor([]));
    vi.mocked(spawnNppCorporation).mockResolvedValue({
      corporationId: new ObjectId().toString(),
      sequentialId: 1,
      name: "Shortage Mining",
      type: "extraction",
      countryId: "US",
      headquartersState: "AZ",
      startingCapital: 2_000_000,
      startingRevenue: 100_000,
      sectorId: new ObjectId().toString(),
      nppId: new ObjectId().toString(),
      nppName: "NPC Miner",
      tickerSymbol: "MINE",
    });
  });

  it("retools a standard NPP miner onto a resource short by price, not S/D", async () => {
    const corpId = new ObjectId();
    const sectorId = new ObjectId();
    db.collectionMocks.commodityPrices.find.mockReturnValue(cursor([RARE_EARTH_SHORT_BY_PRICE]));
    db.collectionMocks.stateResourceCapacity.find.mockReturnValue(
      cursor([{ stateId: "AZ", countryId: "US", resources: { rare_earth: 50_000 } }])
    );
    db.collectionMocks.corporations.find.mockReturnValue(cursor([npcCorp(corpId)]));
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([{ _id: sectorId, corporationId: corpId, stateId: "AZ", strategyId: "standard" }])
    );

    const res = await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);

    expect(res.converted).toBe(1);
    expect(res.byResource).toEqual({ rare_earth: 1 });
  });

  it("places a focused mine in a deposit state another mine already occupies", async () => {
    db.collectionMocks.commodityPrices.find.mockReturnValue(cursor([RARE_EARTH_SHORT_BY_PRICE]));
    db.collectionMocks.stateResourceCapacity.find.mockReturnValue(
      cursor([{ stateId: "AZ", countryId: "US", resources: { rare_earth: 50_000, oil: 9_000 } }])
    );
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          corporationId: new ObjectId(),
          stateId: "AZ",
          strategyId: "oil_gas",
        },
      ])
    );

    const res = await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);

    expect(res.placed).toBe(1);
    expect(spawnNppCorporation).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ headquartersState: "AZ", initialStrategyId: "rare_earth_mining" })
    );
  });

  it("does not stack a second focused mine where one already works the deposit", async () => {
    db.collectionMocks.commodityPrices.find.mockReturnValue(cursor([RARE_EARTH_SHORT_BY_PRICE]));
    db.collectionMocks.stateResourceCapacity.find.mockReturnValue(
      cursor([{ stateId: "AZ", countryId: "US", resources: { rare_earth: 50_000 } }])
    );
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          corporationId: new ObjectId(),
          stateId: "AZ",
          strategyId: "rare_earth_mining",
        },
      ])
    );

    const res = await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);

    expect(res.placed).toBe(0);
    expect(spawnNppCorporation).not.toHaveBeenCalled();
  });

  describe("dead deposits (plants mode, every alternative forecasts a loss)", () => {
    const prices = [
      // Inputs priced far above base, timber glutted: every recipe loses money.
      ...["energy", "chemicals", "vehicles", "freight", "ordnance", "steel"].map((commodity) => ({
        commodity,
        globalSupply: 100,
        globalDemand: 1000,
        globalPrice: 1000,
        basePrice: 100,
      })),
      {
        commodity: "timber",
        globalSupply: 3000,
        globalDemand: 1000,
        globalPrice: 30,
        basePrice: 100,
      },
      { ...RARE_EARTH_SHORT_BY_PRICE, stateSupply: {} },
    ];

    function seed(sectors: Array<Record<string, unknown>>, corpId: ObjectId) {
      db.collectionMocks.gameConfig.findOne.mockResolvedValue({ marketSystemMode: "plants" });
      db.collectionMocks.commodityPrices.find.mockReturnValue(cursor(prices));
      db.collectionMocks.stateResourceCapacity.find.mockReturnValue(
        cursor([
          { stateId: "FI_EAS", countryId: "FI", resources: { timber: 1_000_000 } },
          { stateId: "AT_VIE", countryId: "FI", resources: {} },
        ])
      );
      db.collectionMocks.corporations.find.mockReturnValue(cursor([npcCorp(corpId, "FI")]));
      db.collectionMocks.corporateSectors.find
        .mockReturnValueOnce(cursor([]))
        .mockReturnValueOnce(cursor(sectors.map((s) => ({ corporationId: corpId, ...s }))));
      db.collection("tradeFlowSnapshots").findOne.mockResolvedValue(null);
    }

    it("moves a rare earth mine off a timber-only deposit to the least-bad live recipe", async () => {
      const sectorId = new ObjectId();
      seed([{ _id: sectorId, stateId: "FI_EAS", strategyId: "rare_earth_mining" }], new ObjectId());

      const res = await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);

      expect(res.restrategized).toBe(1);
      expect(res.relocatedOffDeadDeposit).toBe(1);
      expect(res.restrategizedByStrategy).toEqual({ timber_logging: 1 });
      const op = db.collectionMocks.corporateSectors.bulkWrite.mock.calls[0][0][0].updateOne;
      expect(op.filter._id).toEqual(sectorId);
      expect(op.update.$set.transitionFromStrategyId).toBe("rare_earth_mining");
    });

    it("mothballs a mine whose state holds nothing any recipe can extract", async () => {
      const sectorId = new ObjectId();
      seed(
        [{ _id: sectorId, stateId: "AT_VIE", strategyId: "standard", capitalStock: 2_500 }],
        new ObjectId()
      );

      const res = await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);

      expect(res.restrategized).toBe(0);
      expect(res.deadDepositMothballed).toBe(1);
      const op = db.collectionMocks.corporateSectors.bulkWrite.mock.calls[0][0][0].updateOne;
      expect(op.filter._id).toEqual(sectorId);
      expect(op.update.$set.mothballed).toBe(true);
    });

    it("leaves a mine on a live deposit alone even when it forecasts a loss", async () => {
      seed(
        [{ _id: new ObjectId(), stateId: "FI_EAS", strategyId: "timber_logging" }],
        new ObjectId()
      );

      const res = await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);

      expect(res.restrategized).toBe(0);
      expect(res.deadDepositMothballed).toBe(0);
    });
  });
});

describe("dead-deposit mothball for system-run state companies", () => {
  let db: MockDb;
  const soeVacant = { _id: new ObjectId(), countryOwnerId: "RU", ceoVacant: true };
  const soePlayerCeo = { _id: new ObjectId(), countryOwnerId: "DE", ceoVacant: false };

  function seed(sectors: Array<Record<string, unknown>>) {
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
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({ marketSystemMode: "capital" });
    db.collectionMocks.commodityPrices.find.mockReturnValue(cursor([]));
    db.collectionMocks.stateResourceCapacity.find.mockReturnValue(
      cursor([
        { stateId: "SU_UKR", countryId: "RU", resources: {} },
        { stateId: "DD_SN", countryId: "DD", resources: {} },
        { stateId: "FI_EAS", countryId: "RU", resources: { timber: 1_000_000 } },
        { stateId: "SU_NOR", countryId: "RU", resources: { coal: 50_000 } },
      ])
    );
    // Honour the query the way Mongo would: NPC corps for the npp query, only
    // vacant-CEO state companies for the state-company query.
    db.collectionMocks.corporations.find.mockImplementation((filter: Record<string, unknown>) =>
      cursor(filter.ceoVacant === true ? [soeVacant, soePlayerCeo].filter((c) => c.ceoVacant) : [])
    );
    db.collectionMocks.corporateSectors.find.mockImplementation(
      (filter: { corporationId?: { $in?: ObjectId[] } }) => {
        const ids = filter.corporationId?.$in?.map(String);
        return cursor(ids ? sectors.filter((s) => ids.includes(String(s.corporationId))) : sectors);
      }
    );
  }

  const mothballedIds = () =>
    (db.collectionMocks.corporateSectors.bulkWrite.mock.calls.at(-1)?.[0] ?? []).map(
      (op: { updateOne: { filter: { _id: ObjectId } } }) => String(op.updateOne.filter._id)
    );

  it("mothballs a vacant-CEO state company's mine on an empty deposit", async () => {
    const dead = {
      _id: new ObjectId(),
      corporationId: soeVacant._id,
      stateId: "SU_UKR",
      capitalStock: 97_000,
    };
    seed([dead]);

    const res = await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);

    expect(res.deadDepositMothballed).toBe(1);
    expect(res.stateCompanyDeadDepositMothballed).toBe(1);
    expect(mothballedIds()).toEqual([String(dead._id)]);
  });

  it("mothballs rather than retools a state company mine with a live alternative", async () => {
    const dead = {
      _id: new ObjectId(),
      corporationId: soeVacant._id,
      stateId: "FI_EAS",
      strategyId: "rare_earth_mining",
      capitalStock: 400,
    };
    seed([dead]);

    const res = await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);

    expect(res.restrategized).toBe(0);
    expect(res.stateCompanyDeadDepositMothballed).toBe(1);
  });

  it("leaves live state company mines and player-run state companies alone", async () => {
    seed([
      {
        _id: new ObjectId(),
        corporationId: soeVacant._id,
        stateId: "SU_NOR",
        capitalStock: 20_000,
      },
      {
        _id: new ObjectId(),
        corporationId: soePlayerCeo._id,
        stateId: "DD_SN",
        capitalStock: 9_000,
      },
    ]);

    const res = await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);

    expect(res.deadDepositMothballed).toBe(0);
    expect(db.collectionMocks.corporateSectors.bulkWrite).not.toHaveBeenCalled();
  });

  it("shares the per-run cap, largest dead mines first", async () => {
    const mines = [5, 97, 25, 12, 19].map((k) => ({
      _id: new ObjectId(),
      corporationId: soeVacant._id,
      stateId: "SU_UKR",
      capitalStock: k * 1000,
    }));
    seed(mines);

    const res = await processExtractionAutoStrategy(db as unknown as Db, 10, ENABLED);

    expect(res.deadDepositMothballed).toBe(3);
    const largest = [...mines].sort((a, b) => b.capitalStock - a.capitalStock).slice(0, 3);
    expect(mothballedIds()).toEqual(largest.map((m) => String(m._id)));
  });
});
