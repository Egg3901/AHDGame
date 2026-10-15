/**
 * Real-mongod proof for the retroactive dissolution-successor heal.
 *
 * Opt-in only: runs when `AHD_TEST_REAL_MONGO=1` (see realMongoFixture).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  REAL_MONGO_ENABLED,
  startIsolatedMongod,
  stopIsolatedMongod,
  type IsolatedMongod,
} from "@/lib/test-utils/realMongoFixture";
import type { Corporation, CorporateSector } from "@/lib/db/types";

let fixtureDb: Db | null = null;

vi.mock("@/lib/npp/generator", () => ({
  createNPP: vi.fn(async () => {
    const npp = {
      _id: new ObjectId(),
      name: `NPP ${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date(),
    };
    await fixtureDb!.collection("npps").insertOne(npp);
    return npp;
  }),
}));

const { defect } = await import("./AHD-dissolution-npp-successors");

const EXIT_AT = new Date("2026-10-12T05:17:21.038Z");
const now = new Date("2026-10-14T20:00:00.000Z");
const ctx = { env: "sandbox" as const, dryRun: true, now };

async function seed(db: Db): Promise<{ exitId: ObjectId; poolIds: ObjectId[] }> {
  await db.collection("gameState").insertOne({
    _id: "current" as unknown as ObjectId,
    currentTurn: 194,
    currentYear: 1991,
  });
  await db.collection("gameConfig").insertOne({
    _id: "default" as unknown as ObjectId,
    marketSystemMode: "plants",
  });
  await db
    .collection("states")
    .insertMany(
      ["GA", "FL", "NY"].map((id) => ({ _id: id as unknown as ObjectId, countryId: "US" }))
    );
  await db.collection("exchangeRates").insertOne({ currencyCode: "USD", rate: 1 });

  // A live financial fleet: 2 capacity units per unit of output.
  await db.collection("corporateSectors").insertOne({
    _id: new ObjectId(),
    corporationId: new ObjectId(),
    countryId: "US",
    stateId: "NY",
    sectorType: "financial",
    industryModel: null,
    mediaDiscriminator: null,
    capitalStock: 200,
    producedUnits: 100,
  });

  const exitId = new ObjectId();
  await db.collection("corporationExits").insertOne({
    _id: exitId,
    corporationId: exitId,
    name: "Old House",
    countryId: "US",
    corporationType: "financial",
    ownerKind: "player",
    turn: 133,
    reason: "voluntary_closure",
    currencyCode: "USD",
    finalCash: 0,
    finalMarketCap: 0,
    finalRevenue: 1,
    createdAt: EXIT_AT,
  });
  await db.collection("corporationHistory").insertOne({
    corporationId: exitId,
    turn: 133,
    commodityOutput: { financial_services: 30 },
    taxPaidByState: { GA: 2, FL: 1 },
  });
  const poolIds = [new ObjectId(), new ObjectId()];
  await db.collection("unownedSectors").insertMany([
    {
      _id: poolIds[0],
      stateId: "GA",
      countryId: "US",
      sectorType: "financial",
      industryModel: null,
      mediaDiscriminator: null,
      headroomUnits: 1000,
      revenue: 4_000_000,
      recentCorporateSectorRestores: [{ sectorId: "a", restoredAt: EXIT_AT }],
    },
    {
      _id: poolIds[1],
      stateId: "FL",
      countryId: "US",
      sectorType: "financial",
      industryModel: null,
      mediaDiscriminator: null,
      // Mostly claimed since: the rebuild is capped here.
      headroomUnits: 5,
      revenue: 20_000,
      recentCorporateSectorRestores: [{ sectorId: "b", restoredAt: EXIT_AT }],
    },
  ]);
  return { exitId, poolIds };
}

describe.runIf(REAL_MONGO_ENABLED)("AHD-dissolution-npp-successors heal", () => {
  let fixture: IsolatedMongod | null = null;
  let db: Db;

  beforeAll(async () => {
    fixture = await startIsolatedMongod("ahd-dissolution-heal-");
    db = fixture.db;
    fixtureDb = db;
  }, 120_000);

  afterAll(async () => {
    await stopIsolatedMongod(fixture);
    fixture = null;
  }, 120_000);

  beforeEach(async () => {
    await db.dropDatabase();
  });

  it("sizes from output, caps at unclaimed headroom, and is a no-op on rerun", async () => {
    const { exitId, poolIds } = await seed(db);

    const detected = await defect.detect(db, ctx);
    expect(detected.affected).toBe(1);

    const healPlan = await defect.plan(db, ctx);
    // 30 output x 2 capacity/output = 60 units, 75% picked up = 45:
    // GA 2/3 = 30, FL 1/3 = 15 capped at its 5 units of headroom.
    const pickups = (healPlan.payload as { events: Array<{ pickups: Array<{ units: number }> }> })
      .events[0].pickups;
    expect(pickups.map((p) => p.units).sort((a, b) => a - b)).toEqual([5, 30]);

    await defect.apply(db, healPlan, { ...ctx, dryRun: false, runId: "r1" });

    // No financial NPP existed, so one is spawned and takes both states.
    const npps = await db
      .collection<Corporation>("corporations")
      .find({ ceoType: "npp" })
      .toArray();
    expect(npps).toHaveLength(1);
    const rebuilt = await db
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: npps[0]._id })
      .toArray();
    expect(rebuilt.map((s) => Math.round(s.capitalStock ?? 0)).sort((a, b) => a - b)).toEqual([
      5, 30,
    ]);
    expect(rebuilt.every((s) => s.capacityBookAnchor === 0)).toBe(true);

    const [ga, fl] = await Promise.all(
      poolIds.map((id) => db.collection("unownedSectors").findOne({ _id: id }))
    );
    expect(ga?.headroomUnits).toBeCloseTo(970, 3);
    expect(fl?.headroomUnits).toBeCloseTo(0, 3);

    const exit = await db.collection("corporationExits").findOne({ _id: exitId });
    expect(exit?.successorIds).toHaveLength(1);

    expect((await defect.verify(db, ctx)).ok).toBe(true);
    expect((await defect.detect(db, ctx)).affected).toBe(0);

    // Re-applying the same plan creates nothing new and draws nothing more.
    await defect.apply(db, healPlan, { ...ctx, dryRun: false, runId: "r2" });
    expect(await db.collection("corporations").countDocuments({ ceoType: "npp" })).toBe(1);
    expect(
      await db.collection("corporateSectors").countDocuments({ corporationId: npps[0]._id })
    ).toBe(2);
    const gaAgain = await db.collection("unownedSectors").findOne({ _id: poolIds[0] });
    expect(gaAgain?.headroomUnits).toBeCloseTo(970, 3);
  });

  it("skips exits whose restore evidence has pruned away", async () => {
    await seed(db);
    await db
      .collection("unownedSectors")
      .updateMany({}, { $set: { recentCorporateSectorRestores: [] } });
    expect((await defect.detect(db, ctx)).affected).toBe(0);
  });
});
