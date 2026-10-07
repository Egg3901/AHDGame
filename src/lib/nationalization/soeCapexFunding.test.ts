import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { processSoeOperations } from "./soeOperations";
import { loadTreasuryCashContext } from "./treasuryLedger";
import { runSoeBackingSweep } from "@/lib/turn/corporation/soeBackingSweep";

/**
 * A state capex grant under funded Treasury cash (#3365). The grant is a
 * funded expense: a Treasury that cannot cover it buys nothing, and that
 * refusal must not abort the rest of the SOE pass or the corporation phase.
 */

const NOW = new Date("2026-10-07T00:00:00Z");
const TURN = 2;
const RU_CORP = new ObjectId("650000000000000000003365");
const UK_CORP = new ObjectId("650000000000000000003366");
const RU_SECTOR = new ObjectId("650000000000000000003367");
const UK_SECTOR = new ObjectId("650000000000000000003368");

function world(ruCash: number) {
  const db = createInMemoryDb();
  db.seed("gameConfig", [
    { _id: "default", marketSystemMode: "plants", treasuryCashLedgerEnabled: true },
  ]);
  db.seed("gameState", [{ _id: "current", currentTurn: TURN, preset: "1991-default" }]);
  db.seed("exchangeRates", [
    { currencyCode: "SUR", rate: 1 },
    { currencyCode: "GBP", rate: 1 },
  ]);
  db.seed("federalBudget", [
    {
      _id: "RU",
      countryId: "RU",
      currencyCode: "SUR",
      treasuryBalance: -1_000_000,
      treasuryCashLocal: ruCash,
    },
    {
      _id: "UK",
      countryId: "UK",
      currencyCode: "GBP",
      treasuryBalance: 1_000_000_000,
      treasuryCashLocal: 1_000_000_000,
    },
  ]);
  const corp = (id: ObjectId, countryId: string) => ({
    _id: id,
    name: `${countryId} state enterprise`,
    countryId,
    countryOwnerId: countryId,
    type: "manufacturing",
    liquidCapital: 1_000,
    createdAt: NOW,
  });
  const sector = (id: ObjectId, corporationId: ObjectId, countryId: string) => ({
    _id: id,
    corporationId,
    countryId,
    stateId: `${countryId}-X`,
    sectorType: "manufacturing",
    revenue: 1_000,
    profitMargin: 10,
    capitalStock: 10_000,
    createdAt: NOW,
  });
  // RU sorts first so the unfunded country is the one that fails mid-loop.
  db.seed("corporations", [corp(RU_CORP, "RU"), corp(UK_CORP, "UK")]);
  db.seed("corporateSectors", [sector(RU_SECTOR, RU_CORP, "RU"), sector(UK_SECTOR, UK_CORP, "UK")]);
  return db;
}

async function run(db: ReturnType<typeof createInMemoryDb>) {
  const context = await loadTreasuryCashContext(db as unknown as Db, TURN);
  return processSoeOperations(db as unknown as Db, NOW, 1991, undefined, { context });
}

function sectorDoc(db: ReturnType<typeof createInMemoryDb>, id: ObjectId) {
  return db
    .collection("corporateSectors")
    .docs.find((doc) => String(doc._id) === id.toHexString()) as Record<string, number>;
}

function budget(db: ReturnType<typeof createInMemoryDb>, countryId: string) {
  return db.collection("federalBudget").docs.find((doc) => doc.countryId === countryId) as Record<
    string,
    number
  >;
}

describe("state capex grant under funded Treasury cash", () => {
  it("skips an unfunded country's grant without capacity and still pays the funded one", async () => {
    const db = world(0);

    await expect(run(db)).resolves.toMatchObject({ soeCorps: 2 });

    // Unpaid: no capacity, no basis change, no Treasury movement.
    expect(sectorDoc(db, RU_SECTOR).capitalStock).toBe(10_000);
    expect(sectorDoc(db, RU_SECTOR).capacityBookAnchor).toBeUndefined();
    expect(budget(db, "RU")).toMatchObject({ treasuryCashLocal: 0, treasuryBalance: -1_000_000 });

    // Paid: capacity and the Treasury debit settle under one receipt.
    const ukStock = sectorDoc(db, UK_SECTOR).capitalStock;
    expect(ukStock).toBeGreaterThan(10_000);
    const ukDebit = 1_000_000_000 - budget(db, "UK").treasuryCashLocal;
    expect(ukDebit).toBeGreaterThan(0);
    expect(budget(db, "UK").treasuryBalance).toBe(1_000_000_000 - ukDebit);
    expect(sectorDoc(db, UK_SECTOR).capacityBookAnchor).toBeGreaterThan(0);

    const moves = db.collection("bankMoneyMoves").docs;
    expect(
      moves.find((m) => m._id === `treasury-nationalization:soe-capex-grant:${TURN}:UK`)
    ).toMatchObject({ status: "applied" });
    expect(
      moves.find((m) => m._id === `treasury-nationalization:soe-capex-grant:${TURN}:RU`)?.status
    ).not.toBe("applied");

    // A retry of the same turn neither double-pays nor double-builds, and the
    // RU refusal stays a refusal even if cash has since arrived.
    await db
      .collection("federalBudget")
      .updateOne({ countryId: "RU" }, { $set: { treasuryCashLocal: 1_000_000_000 } });
    await expect(run(db)).resolves.toMatchObject({ soeCorps: 2 });
    expect(sectorDoc(db, UK_SECTOR).capitalStock).toBe(ukStock);
    expect(budget(db, "UK").treasuryCashLocal).toBe(1_000_000_000 - ukDebit);
    expect(sectorDoc(db, RU_SECTOR).capitalStock).toBe(10_000);
    expect(budget(db, "RU").treasuryCashLocal).toBe(1_000_000_000);
  });

  it("refuses a grant the Treasury can only partly cover", async () => {
    const db = world(1);
    await expect(run(db)).resolves.toMatchObject({ soeCorps: 2 });
    expect(sectorDoc(db, RU_SECTOR).capitalStock).toBe(10_000);
    expect(budget(db, "RU")).toMatchObject({ treasuryCashLocal: 1, treasuryBalance: -1_000_000 });
  });

  it("binds the funded grant's capacity to the Treasury debit", async () => {
    const db = world(1_000_000_000);
    await run(db);
    const ruDebit = 1_000_000_000 - budget(db, "RU").treasuryCashLocal;
    expect(ruDebit).toBeGreaterThan(0);
    expect(sectorDoc(db, RU_SECTOR).capitalStock).toBeGreaterThan(10_000);
    expect(budget(db, "RU").treasuryBalance).toBe(-1_000_000 - ruDebit);
  });

  it("lets the corporation sweep go on to remittance after an unfunded grant", async () => {
    const db = world(0);
    const marks: string[] = [];

    await runSoeBackingSweep({
      db: db as unknown as Db,
      now: NOW,
      turn: TURN,
      currentYear: 1991,
      corpSnapshots: [],
      corpById: new Map(),
      mark: (label) => marks.push(label),
    });

    expect(marks).toEqual(["soeOperations", "soeRemittance"]);
    expect(sectorDoc(db, RU_SECTOR).capitalStock).toBe(10_000);
    expect(sectorDoc(db, UK_SECTOR).capitalStock).toBeGreaterThan(10_000);
  });
});
