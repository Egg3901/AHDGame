/**
 * Real-mongod proof that leaving plants are 75% picked up by NPP operators and
 * 25% returned to the unowned pool.
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
import { seedPlantLedger } from "@/lib/corporations/plantLedger";

let fixtureDb: Db | null = null;

vi.mock("@/lib/npp/generator", () => ({
  createNPP: vi.fn(async () => {
    const npp = { _id: new ObjectId(), name: "Fresh NPP", createdAt: new Date() };
    await fixtureDb!.collection("npps").insertOne(npp);
    return npp;
  }),
}));

const { disposeLeavingSectors, NPP_PICKUP_SHARE } = await import("./nppPickup");

const owner = { _id: new ObjectId() };

function plantSector(
  corporationId: ObjectId,
  stateId: string,
  capitalStock: number,
  extra: Partial<CorporateSector> = {}
): CorporateSector {
  return {
    _id: new ObjectId(),
    corporationId,
    countryId: "US",
    stateId,
    sectorType: "logistics",
    industryModel: null,
    mediaDiscriminator: null,
    revenue: 1000,
    profitMargin: 10,
    workers: 100,
    capitalStock,
    ...seedPlantLedger("logistics", capitalStock),
    capacityBookAnchor: capitalStock * 10,
    buildQueue: [],
    constructionPropertyTransition: { key: `restore:${stateId}`, kind: "restore" },
    ...extra,
  } as unknown as CorporateSector;
}

async function seed(db: Db) {
  await db.collection("gameState").insertOne({
    _id: "current" as unknown as ObjectId,
    worldEpochId: "test-world-epoch",
    currentTurn: 50,
    currentYear: 1991,
  });
  await db.collection("gameConfig").insertOne({
    _id: "default" as unknown as ObjectId,
    marketSystemMode: "plants",
  });
  await db
    .collection("states")
    .insertMany(
      ["S1", "S2", "S3"].map((id) => ({ _id: id as unknown as ObjectId, countryId: "US" }))
    );
  await db.collection("exchangeRates").insertOne({ currencyCode: "USD", rate: 1 });
  await db.collection<Corporation>("corporations").insertOne({
    _id: owner._id,
    name: "Leaving Co",
    countryId: "US",
    ceoType: "character",
  } as unknown as Corporation);
  // An NPP logistics operator already in S1, and one with plants only in S2.
  const nppA = new ObjectId();
  const nppB = new ObjectId();
  await db.collection<Corporation>("corporations").insertMany([
    { _id: nppA, name: "NPP A", countryId: "US", ceoType: "npp" },
    { _id: nppB, name: "NPP B", countryId: "US", ceoType: "npp" },
  ] as unknown as Corporation[]);
  const aRow = plantSector(nppA, "S1", 40, { constructionPropertyTransition: undefined });
  await db
    .collection<CorporateSector>("corporateSectors")
    .insertMany([
      aRow,
      plantSector(nppA, "S2", 10, { constructionPropertyTransition: undefined }),
      plantSector(nppB, "S2", 10, { constructionPropertyTransition: undefined }),
    ]);
  return { nppA, nppB, aRow };
}

describe.runIf(REAL_MONGO_ENABLED)("NPP pickup against isolated mongod", () => {
  let fixture: IsolatedMongod | null = null;
  let db: Db;

  beforeAll(async () => {
    fixture = await startIsolatedMongod("ahd-npp-pickup-");
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

  it("merges into an in-state NPP, adds a row for an in-country NPP, returns the rest", async () => {
    const { nppB, aRow } = await seed(db);
    // 2000 units is 20 whole 100-unit plants, so the carve is exact.
    const leavingS1 = plantSector(owner._id, "S1", 2000);
    const leavingS3 = plantSector(owner._id, "S3", 2000, {
      buildQueue: [
        { unitsOrdered: 500, costPaidAnchor: 1, startTurn: 49, onlineTurn: 60 },
      ] as unknown as CorporateSector["buildQueue"],
    });
    await db.collection<CorporateSector>("corporateSectors").insertMany([leavingS1, leavingS3]);

    const result = await disposeLeavingSectors(db, owner, [leavingS1, leavingS3], new Date());

    expect(result.recipientIds).toHaveLength(2);
    const sectors = db.collection<CorporateSector>("corporateSectors");
    expect(await sectors.countDocuments({ corporationId: owner._id })).toBe(0);

    const merged = await sectors.findOne({ _id: aRow._id });
    expect(merged?.capitalStock).toBeCloseTo(40 + 2000 * NPP_PICKUP_SHARE, 6);
    expect(merged?.workers).toBe(100 + 75);

    // S3 had no NPP operator in-state; the in-country NPP with the fewest
    // logistics rows gets a new row there, without the build queue.
    const s3 = await sectors.findOne({ stateId: "S3" });
    expect(s3?.capitalStock).toBeCloseTo(2000 * NPP_PICKUP_SHARE, 6);
    expect(s3?.buildQueue).toEqual([]);
    expect(s3?.corporationId.equals(nppB)).toBe(true);

    // The pool got the 25% kept share, plus the queued 500 at S3.
    const pools = await db.collection("unownedSectors").find({}).toArray();
    expect(pools.map((p) => p.stateId).sort()).toEqual(["S1", "S3"]);
  });

  it("does not credit a receiver twice when a disposal is retried", async () => {
    const { aRow } = await seed(db);
    const leaving = plantSector(owner._id, "S1", 2000);
    const key = `npp-pickup:${leaving._id.toHexString()}`;
    // State after a crash between the credit and the pool restore: the row
    // carries its pickup marker and the receiver already holds the receipt.
    const marked = {
      ...leaving,
      nppPickup: {
        key,
        receiverCorporationId: aRow.corporationId,
        receiverSectorId: aRow._id,
        merge: true,
      },
    };
    await db.collection<CorporateSector>("corporateSectors").insertOne(marked);
    await db
      .collection<CorporateSector>("corporateSectors")
      .updateOne({ _id: aRow._id }, { $set: { capitalStock: 1540, nppPickupReceipts: [key] } });

    const result = await disposeLeavingSectors(db, owner, [marked], new Date());

    const receiver = await db
      .collection<CorporateSector>("corporateSectors")
      .findOne({ _id: aRow._id });
    expect(receiver?.capitalStock).toBe(1540);
    expect(result.unitsPickedUp).toBe(0);
    expect(await db.collection("corporateSectors").countDocuments({ _id: leaving._id })).toBe(0);
  });

  it("spawns an NPP when the lane has no operator in the country", async () => {
    await seed(db);
    const leaving = plantSector(owner._id, "S2", 2000, { sectorType: "media" });
    await db.collection<CorporateSector>("corporateSectors").insertOne(leaving);
    const result = await disposeLeavingSectors(db, owner, [leaving], new Date());
    expect(result.recipientIds).toHaveLength(1);
    const spawned = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: result.recipientIds[0] });
    expect(spawned?.ceoType).toBe("npp");
    expect(spawned?.producerPayables).toEqual({
      worldEpoch: "test-world-epoch",
      turn: 50,
      claims: [],
    });
  });

  it("returns everything to the pool for unbuilt sectors", async () => {
    await seed(db);
    const leaving = plantSector(owner._id, "S3", 0, {
      buildQueue: [
        { unitsOrdered: 500, costPaidAnchor: 1, startTurn: 49, onlineTurn: 60 },
      ] as unknown as CorporateSector["buildQueue"],
    });
    await db.collection<CorporateSector>("corporateSectors").insertOne(leaving);
    const result = await disposeLeavingSectors(db, owner, [leaving], new Date());
    expect(result.recipientIds).toHaveLength(0);
    expect(await db.collection("corporateSectors").countDocuments({ _id: leaving._id })).toBe(0);
  });
});
