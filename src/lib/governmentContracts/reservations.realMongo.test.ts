import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  REAL_MONGO_ENABLED,
  startIsolatedMongod,
  stopIsolatedMongod,
  type IsolatedMongod,
} from "@/lib/test-utils/realMongoFixture";
import {
  reserveDefenceTender,
  convertDefenceReservation,
  fenceDefenceReservation,
  expireGovernmentTenders,
} from "./reservations";
import { ensureGovernmentContractIndexes, tenders } from "./persistence";
import { lockContractPlant, releaseContractPlant } from "./plantSlots";
import { setContractFactories } from "@/lib/db/collections/defenceContracts";
import { DEFENCE_FACTORY_SLOTS_PER_PLANT } from "@/lib/military/defenceLotEconomics";
import { computeContractedShare } from "@/lib/extraction/computeContractedShare";
import { listGovernmentTenders } from "./queries";
import { migration } from "@/lib/migrations/entries/2026-10-14-government-contract-bidding";
import type { GovernmentTender } from "./types";
describe.skipIf(!REAL_MONGO_ENABLED)("government tender standalone-Mongo accounting", () => {
  let fixture: IsolatedMongod;
  const tender = (amount = 200): GovernmentTender => ({
    _id: new ObjectId().toHexString(),
    countryId: "US",
    title: "Equipment order",
    description: "Synthetic equipment order",
    terms: {
      type: "defence",
      component: "ground",
      grade: 0,
      lots: 2,
      maximumPricePerLot: amount / 2,
    },
    issuerLevel: "national",
    publishedBy: "test",
    publishedTurn: 1,
    closesTurn: 3,
    awardDeadlineTurn: 5,
    status: "open",
    bids: {},
    revision: 0,
    contractId: new ObjectId().toHexString(),
    allocationWindowId: "US:0",
    reservedAmount: amount,
    updatedAt: new Date(),
  });
  beforeAll(async () => {
    fixture = await startIsolatedMongod("ahd-government-contracts-");
  }, 40000);
  afterAll(async () => {
    if (fixture) await stopIsolatedMongod(fixture);
  }, 25000);
  beforeEach(async () => {
    await fixture.db.dropDatabase();
    await ensureGovernmentContractIndexes(fixture.db);
    await fixture.db.collection("federalBudget").insertOne({
      countryId: "US",
      defenseAppropriation: {
        balance: 300,
        encumbered: 0,
        accruedThroughTurn: 1,
        arrearsRatio: 0,
      },
    });
  });
  it("allows only one of two concurrent reservations against the same money", async () => {
    const a = tender(),
      b = tender();
    await tenders(fixture.db).insertMany([a, b]);
    const result = await Promise.all([
      reserveDefenceTender(fixture.db, a, 10000),
      reserveDefenceTender(fixture.db, b, 10000),
    ]);
    expect(result.filter(Boolean)).toHaveLength(1);
    const pot = await fixture.db.collection("federalBudget").findOne({ countryId: "US" });
    expect(pot?.defenseAppropriation.encumbered).toBe(200);
  });
  it("replays a reservation and a supplier conversion without charging twice", async () => {
    const row = tender();
    await tenders(fixture.db).insertOne(row);
    expect(await reserveDefenceTender(fixture.db, row, 10000)).toBe(true);
    expect(await reserveDefenceTender(fixture.db, row, 10000)).toBe(true);
    for (let i = 0; i < 2; i++)
      expect(
        await convertDefenceReservation(fixture.db, row, "a".repeat(24), 150, 10000, false)
      ).toBe(true);
    const pot = await fixture.db.collection("federalBudget").findOne({ countryId: "US" });
    const quota = await fixture.db.collection("defenceProcurementAllocations").findOne({});
    expect(pot?.defenseAppropriation.encumbered).toBe(150);
    expect(quota?.countryAmount).toBe(150);
    expect(quota?.supplierAmounts["a".repeat(24)]).toBe(150);
  });
  it("releases canceled reservations once, preserving a different tender", async () => {
    const a = tender(100),
      b = tender(100);
    await tenders(fixture.db).insertMany([a, b]);
    await reserveDefenceTender(fixture.db, a, 10000);
    await reserveDefenceTender(fixture.db, b, 10000);
    await tenders(fixture.db).updateOne({ _id: a._id }, { $set: { status: "canceled" } });
    await expireGovernmentTenders(fixture.db, 2);
    await expireGovernmentTenders(fixture.db, 2);
    const pot = await fixture.db.collection("federalBudget").findOne({ countryId: "US" });
    expect(pot?.defenseAppropriation.encumbered).toBe(100);
  });
  it("blocks holds from a publisher that resumes after cancellation", async () => {
    const row = { ...tender(), status: "canceled" as const };
    await tenders(fixture.db).insertOne(row);
    await expireGovernmentTenders(fixture.db, 2);
    expect(await reserveDefenceTender(fixture.db, row, 10000)).toBe(false);
    expect(
      (await fixture.db.collection("federalBudget").findOne({ countryId: "US" }))
        ?.defenseAppropriation.encumbered
    ).toBe(0);
    expect(
      (await fixture.db.collection("defenceProcurementAllocations").findOne({}))?.countryAmount
    ).toBe(0);
  });
  it("blocks a late appropriation hold after quota cancellation", async () => {
    const row = tender();
    await tenders(fixture.db).insertOne(row);
    let paused = false;
    const interrupted = new Proxy(fixture.db, {
      get(target, key) {
        if (key !== "collection") {
          const v = Reflect.get(target, key);
          return typeof v === "function" ? v.bind(target) : v;
        }
        return (name: string) =>
          new Proxy(target.collection(name), {
            get(col, method) {
              if (name === "federalBudget" && method === "updateOne")
                return async (...args: unknown[]) => {
                  const update = args[1] as { $set?: Record<string, { state?: string }> };
                  if (
                    !paused &&
                    Object.values(update.$set ?? {}).some((v) => v?.state === "held")
                  ) {
                    paused = true;
                    await tenders(fixture.db).updateOne(
                      { _id: row._id },
                      { $set: { status: "canceled" } }
                    );
                    await expireGovernmentTenders(fixture.db, 2);
                  }
                  return (col.updateOne as (...args: unknown[]) => Promise<unknown>).apply(
                    col,
                    args
                  );
                };
              const v = Reflect.get(col, method);
              return typeof v === "function" ? v.bind(col) : v;
            },
          });
      },
    }) as import("mongodb").Db;
    expect(await reserveDefenceTender(interrupted, row, 10000)).toBe(false);
    expect(paused).toBe(true);
    expect(
      (await fixture.db.collection("federalBudget").findOne({ countryId: "US" }))
        ?.defenseAppropriation.encumbered
    ).toBe(0);
    expect(
      (await fixture.db.collection("defenceProcurementAllocations").findOne({}))?.countryAmount
    ).toBe(0);
  });
  it("fences stale requests from both reservation conversion and plant takeover", async () => {
    const row = tender();
    await tenders(fixture.db).insertOne(row);
    await reserveDefenceTender(fixture.db, row, 10000);
    expect(await fenceDefenceReservation(fixture.db, { ...row, awardLeaseRevision: 2 })).toBe(true);
    expect(await fenceDefenceReservation(fixture.db, { ...row, awardLeaseRevision: 1 })).toBe(
      false
    );
    expect(
      await convertDefenceReservation(
        fixture.db,
        { ...row, awardLeaseRevision: 1 },
        "a".repeat(24),
        150,
        10000,
        false
      )
    ).toBe(false);
    expect(
      await convertDefenceReservation(
        fixture.db,
        { ...row, awardLeaseRevision: 2 },
        "a".repeat(24),
        150,
        10000,
        false
      )
    ).toBe(true);
    const plant = new ObjectId();
    await fixture.db.collection("corporateSectors").insertOne({ _id: plant });
    expect(await lockContractPlant(fixture.db, plant, row._id, "new", 2)).toBeTruthy();
    expect(await lockContractPlant(fixture.db, plant, row._id, "old", 1)).toBeNull();
    await releaseContractPlant(fixture.db, plant, row._id, "old");
    expect(await lockContractPlant(fixture.db, plant, "other")).toBeNull();
  });
  it("prevents a delayed CEO allocation from overbooking after a resumed allocation", async () => {
    const plant = new ObjectId(),
      a = new ObjectId(),
      b = new ObjectId();
    await fixture.db
      .collection("corporateSectors")
      .insertOne({ _id: plant, strategyId: "standard" });
    await fixture.db.collection("defenceContracts").insertMany([
      { _id: a, sectorId: plant, status: "active", assignedFactories: 0 },
      { _id: b, sectorId: plant, status: "active", assignedFactories: 0 },
    ]);
    let signal!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      signal = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delayed = new Proxy(fixture.db, {
      get(target, key) {
        if (key !== "collection") {
          const v = Reflect.get(target, key);
          return typeof v === "function" ? v.bind(target) : v;
        }
        return (name: string) =>
          new Proxy(target.collection(name), {
            get(col, method) {
              if (name === "defenceContracts" && method === "updateOne")
                return async (...args: unknown[]) => {
                  const update = args[1] as { $set?: { assignedFactories?: number } };
                  if (update.$set?.assignedFactories === DEFENCE_FACTORY_SLOTS_PER_PLANT) {
                    signal();
                    await paused;
                  }
                  return (col.updateOne as (...args: unknown[]) => Promise<unknown>).apply(
                    col,
                    args
                  );
                };
              const v = Reflect.get(col, method);
              return typeof v === "function" ? v.bind(col) : v;
            },
          });
      },
    }) as import("mongodb").Db;
    const first = setContractFactories(delayed, a, DEFENCE_FACTORY_SLOTS_PER_PLANT);
    await started;
    try {
      expect(await setContractFactories(fixture.db, a, DEFENCE_FACTORY_SLOTS_PER_PLANT / 2)).toBe(
        true
      );
      expect(await setContractFactories(fixture.db, b, DEFENCE_FACTORY_SLOTS_PER_PLANT / 2)).toBe(
        true
      );
    } finally {
      release();
    }
    expect(await first).toBe(false);
    const contracts = await fixture.db
      .collection("defenceContracts")
      .find({ sectorId: plant })
      .toArray();
    expect(contracts.reduce((total, c) => total + c.assignedFactories, 0)).toBe(
      DEFENCE_FACTORY_SLOTS_PER_PLANT
    );
  });
  it("cannot let two operations own a production plant", async () => {
    const plant = new ObjectId();
    await fixture.db
      .collection("corporateSectors")
      .insertOne({ _id: plant, strategyId: "standard" });
    const locks = await Promise.all([
      lockContractPlant(fixture.db, plant, "a"),
      lockContractPlant(fixture.db, plant, "b"),
    ]);
    expect(locks.filter(Boolean)).toHaveLength(1);
    const held = (await fixture.db.collection("corporateSectors").findOne({ _id: plant }))
      ?.contractMutationOwner;
    expect(await lockContractPlant(fixture.db, plant, held)).toBeTruthy();
    await releaseContractPlant(fixture.db, plant, "wrong");
    expect(await lockContractPlant(fixture.db, plant, "c")).toBeNull();
    await releaseContractPlant(fixture.db, plant, held);
    expect(await lockContractPlant(fixture.db, plant, "c")).toBeTruthy();
  });
  it("does not let a stale award request release its resumed plant lock", async () => {
    const plant = new ObjectId();
    await fixture.db.collection("corporateSectors").insertOne({ _id: plant });
    expect(await lockContractPlant(fixture.db, plant, "tender", "first")).toBeTruthy();
    expect(await lockContractPlant(fixture.db, plant, "tender", "resumed")).toBeTruthy();
    await releaseContractPlant(fixture.db, plant, "tender", "first");
    expect(await lockContractPlant(fixture.db, plant, "other")).toBeNull();
    await releaseContractPlant(fixture.db, plant, "tender", "resumed");
    expect(await lockContractPlant(fixture.db, plant, "other")).toBeTruthy();
  });
  it("counts extraction reservations once through conversion and scopes colliding state ids", async () => {
    const t: GovernmentTender = {
      ...tender(0),
      terms: {
        type: "extraction",
        stateId: "HB",
        resource: "oil",
        share: 0.5,
        termTurns: 48,
        royaltyRatePerTurn: 0.01,
        minimumSigningFeeAnchor: 100,
      },
    };
    await tenders(fixture.db).insertOne(t);
    await fixture.db.collection("extractionContracts").insertMany([
      {
        stateId: "HB",
        countryId: "US",
        resource: "oil",
        share: 0.5,
        tenderId: t._id,
        status: "offered",
      },
      { stateId: "HB", countryId: "DE", resource: "oil", share: 0.7 },
    ]);
    expect(await computeContractedShare(fixture.db, "HB", "oil", "US")).toBe(0.5);
    await tenders(fixture.db).updateOne({ _id: t._id }, { $set: { status: "awarded" } });
    expect(await computeContractedShare(fixture.db, "HB", "oil", "US")).toBe(0.5);
  });
  it("paginates and type-filters countries on the server without returning sealed bids", async () => {
    const rows = Array.from({ length: 23 }, () => tender(0));
    rows[0].bids = {
      ["a".repeat(24)]: {
        corporationId: "a".repeat(24),
        corporationName: "Secret",
        userId: "secret",
        amount: 123,
        submittedTurn: 1,
        revision: 1,
        withdrawn: false,
      },
    };
    await tenders(fixture.db).insertMany([...rows, { ...tender(0), countryId: "JP" }]);
    const one = await listGovernmentTenders(fixture.db, "US", "active", "defence", 1, 1),
      three = await listGovernmentTenders(fixture.db, "US", "active", "defence", 3, 1);
    expect(one.total).toBe(23);
    expect(one.tenders).toHaveLength(10);
    expect(three.tenders).toHaveLength(3);
    expect(one.pageSize).toBe(10);
    expect(JSON.stringify(one)).not.toContain("Secret");
    expect(await tenders(fixture.db).countDocuments({ countryId: "JP" })).toBe(1);
  });
  it("withdraws unanswered direct offers with replay-safe refunds and leaves signed contracts alone", async () => {
    const corp = new ObjectId(),
      pending = new ObjectId();
    await fixture.db
      .collection("federalBudget")
      .updateOne({ countryId: "US" }, { $set: { "defenseAppropriation.encumbered": 200 } });
    await fixture.db.collection("defenceProcurementAllocations").insertOne({
      _id: "US:0" as never,
      countryAmount: 200,
      supplierAmounts: { [corp.toHexString()]: 200 },
    });
    await fixture.db.collection("defenceContracts").insertMany([
      {
        _id: pending,
        countryId: "US",
        corporationId: corp,
        status: "pending",
        allocationWindowId: "US:0",
        allocatedLots: 2,
        pricePerLot: 100,
        encumberedAmount: 200,
      },
      { countryId: "US", corporationId: corp, status: "active", pricePerLot: 90 },
    ]);
    await migration.execute(fixture.db, { dryRun: false });
    await migration.execute(fixture.db, { dryRun: false });
    expect(
      (await fixture.db.collection("defenceContracts").findOne({ _id: pending }))?.termination
        .lotsCancelled
    ).toBe(2);
    expect(
      (await fixture.db.collection("federalBudget").findOne({ countryId: "US" }))
        ?.defenseAppropriation.encumbered
    ).toBe(0);
    expect(
      await fixture.db.collection("defenceContracts").countDocuments({ status: "active" })
    ).toBe(1);
    expect(
      (await fixture.db.collection("defenceProcurementAllocations").findOne({}))?.countryAmount
    ).toBe(0);
  });
});
