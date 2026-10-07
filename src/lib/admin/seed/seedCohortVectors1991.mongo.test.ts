/**
 * #3369: 1991 cohort coverage for the eleven countries without a census bundle,
 * against an isolated mongod. Covers an empty database, a reset over an existing
 * world that still holds prior-world stocks, and real demographic turns after
 * both, so a reseeded region cannot jump to a stale stock on turn one.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import {
  REAL_MONGO_ENABLED,
  startIsolatedMongod,
  stopIsolatedMongod,
  type IsolatedMongod,
} from "@/lib/test-utils/realMongoFixture";
import { sovietUnionRegions1991 } from "@/lib/countries/ru/data/sovietUnionRegions1991";
import { plRegions1991 } from "@/lib/countries/pl/data/plRegions1991";
import { csRegions1991 } from "@/lib/countries/cs/data/csRegions1991";
import { huRegions1991 } from "@/lib/countries/hu/data/huRegions1991";
import { roRegions1991 } from "@/lib/countries/ro/data/roRegions1991";
import { bgRegions1991 } from "@/lib/countries/bg/data/bgRegions1991";
import { yuRegions1991 } from "@/lib/countries/yu/data/yuRegions1991";
import { itRegions1991 } from "@/lib/countries/it/data/itRegions1991";
import { atRegions1991 } from "@/lib/countries/at/data/atRegions1991";
import { fiRegions1991 } from "@/lib/countries/fi/data/fiRegions1991";
import { grRegions1991 } from "@/lib/countries/gr/data/grRegions1991";
import { runDemographicFlows } from "@/lib/demographics/phase";
import { seedCohortVectors } from "./seedCohortVectors";

type Stock = { _id: string; countryId: string; ages: { male: number[]; female: number[] } };
type Row = { _id?: string; id?: string; population: number };

const ROSTERS: Array<[string, readonly Row[]]> = [
  ["RU", sovietUnionRegions1991 as readonly Row[]],
  ["PL", plRegions1991 as readonly Row[]],
  ["CS", csRegions1991 as readonly Row[]],
  ["HU", huRegions1991 as readonly Row[]],
  ["RO", roRegions1991 as readonly Row[]],
  ["BG", bgRegions1991 as readonly Row[]],
  ["YU", yuRegions1991 as readonly Row[]],
  ["IT", itRegions1991 as readonly Row[]],
  ["AT", atRegions1991 as readonly Row[]],
  ["FI", fiRegions1991 as readonly Row[]],
  ["GR", grRegions1991 as readonly Row[]],
];
const STATES = ROSTERS.flatMap(([countryId, rows]) =>
  rows.map((row) => ({ _id: String(row._id ?? row.id), countryId, population: row.population }))
);
const opening = new Map(STATES.map((s) => [s._id, s.population]));
const people = (stock: Stock) =>
  [...stock.ages.male, ...stock.ages.female].reduce((sum, value) => sum + value, 0);

describe.runIf(REAL_MONGO_ENABLED)("1991 cohort coverage against isolated mongod", () => {
  let fixture: IsolatedMongod | null = null;
  let db: Db;

  beforeAll(async () => {
    fixture = await startIsolatedMongod("ahd-cohort-1991-");
    db = fixture.db;
  }, 60_000);
  afterAll(async () => {
    await stopIsolatedMongod(fixture);
    fixture = null;
  });
  beforeEach(async () => {
    await db.dropDatabase();
    await db.collection("states").insertMany(STATES as never[]);
    // Neutral turn inputs; the coverage under test does not depend on them.
    await db.collection("macroMetrics").insertMany(
      STATES.map((s) => ({
        _id: s._id,
        population: {
          medianAge: { value: 34 },
          birthRate: { value: 45 },
          migrationRate: { value: 0 },
        },
      })) as never[]
    );
    await db.collection("gameState").insertOne({
      _id: "current",
      preset: "1991-default",
      startingYear: 1991,
      currentYear: 1991,
      currentTurn: 1,
      livingConflictsEnabled: false,
    } as never);
  });

  async function expectStocksMatchOpening() {
    const stocks = await db.collection<Stock>("regionDemographics").find().toArray();
    expect(stocks.map((s) => s._id).sort()).toEqual([...opening.keys()].sort());
    for (const stock of stocks) {
      expect(Math.abs(people(stock) - opening.get(stock._id)!), stock._id).toBeLessThanOrEqual(101);
    }
  }

  async function expectBoundedTurns(turns: number) {
    for (let turn = 1; turn <= turns; turn++) {
      const phase = await runDemographicFlows(db, turn);
      expect(phase.regionsProcessed).toBe(STATES.length);
    }
    const [states, stocks] = await Promise.all([
      db.collection<{ _id: string; population: number }>("states").find().toArray(),
      db.collection<Stock>("regionDemographics").find().toArray(),
    ]);
    const stockById = new Map(stocks.map((s) => [s._id, s]));
    for (const state of states) {
      // The phase writes the cohort total back over states.population.
      expect(Math.abs(people(stockById.get(state._id)!) - state.population)).toBeLessThanOrEqual(
        0.500001
      );
      // A 1991 region moves by bounded annual rates over a few weekly turns,
      // never by the 31.6% stale-stock jump observed in CEN.
      const drift = Math.abs(state.population / opening.get(state._id)! - 1);
      expect(drift, state._id).toBeLessThan(0.01);
    }
  }

  it("seeds a stock for all 87 regions on an empty database, then evolves them smoothly", async () => {
    expect(STATES).toHaveLength(87);
    const stats = await seedCohortVectors(db, "1991-default", () => {}, { replace: true });
    expect(stats.skipped).toEqual([]);
    expect(stats.covered).toBe(87);
    await expectStocksMatchOpening();
    await expectBoundedTurns(3);
  }, 120_000);

  it("replaces prior-world stocks on reset of an existing world", async () => {
    // Prior world: CEN evolved to the stale 39.86M, a union republic carried a
    // stock, and a retired region id still has one.
    const scaled = (pop: number) => ({
      male: Array.from({ length: 101 }, () => pop / 202),
      female: Array.from({ length: 101 }, () => pop / 202),
    });
    await db.collection<Stock>("regionDemographics").insertMany([
      { _id: "CEN", countryId: "RU", ages: scaled(39_862_013) },
      { _id: "SU_UKR", countryId: "RU", ages: scaled(60_000_000) },
      { _id: "RU_RETIRED", countryId: "RU", ages: scaled(1_000_000) },
    ]);
    await seedCohortVectors(db, "1991-default", () => {}, { replace: true });
    await expectStocksMatchOpening();
    expect(
      await db.collection<Stock>("regionDemographics").countDocuments({ _id: "RU_RETIRED" })
    ).toBe(0);
    await expectBoundedTurns(3);
  }, 120_000);

  it("fails closed and writes nothing when a populated region has no dated profile", async () => {
    await db
      .collection("states")
      .insertOne({ _id: "SU_UNKNOWN", countryId: "RU", population: 1_000_000 } as never);
    await expect(
      seedCohortVectors(db, "1991-default", () => {}, { replace: true })
    ).rejects.toThrow(/SU_UNKNOWN \(RU\): no census/);
    expect(await db.collection("regionDemographics").countDocuments()).toBe(0);
  }, 60_000);
});
