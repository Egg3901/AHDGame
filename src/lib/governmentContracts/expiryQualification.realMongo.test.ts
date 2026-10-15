import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { ObjectId, MongoClient, BSON } from "mongodb";
import { writeFileSync } from "node:fs";
import {
  REAL_MONGO_ENABLED,
  startIsolatedMongod,
  stopIsolatedMongod,
  assertOwnedMongod,
  type IsolatedMongod,
} from "@/lib/test-utils/realMongoFixture";
import { expireGovernmentTenders } from "./reservations";
import { tenders } from "./persistence";
import type { GovernmentTender } from "./types";
import { PHASE_ROUND_TRIP_BUDGETS } from "@/simulation/engine/turnPhaseBudgets";
describe.skipIf(!REAL_MONGO_ENABLED)("government expiry bounded phase qualification", () => {
  let fixture: IsolatedMongod;
  beforeAll(async () => {
    fixture = await startIsolatedMongod("ahd-tender-expiry-");
  }, 40000);
  afterAll(async () => {
    if (fixture) await stopIsolatedMongod(fixture);
  }, 25000);
  it("keeps 100 expiry releases inside the command budget and measures returned BSON", async () => {
    const client = new MongoClient(fixture.uri, { monitorCommands: true });
    await client.connect();
    await assertOwnedMongod(fixture.proc, client);
    try {
      const db = client.db(fixture.dbName);
      let commands = 0,
        bytes = 0,
        documents = 0;
      client.on("commandStarted", () => {
        commands++;
      });
      client.on("commandSucceeded", (event) => {
        const reply = event.reply as import("mongodb").Document;
        bytes += BSON.calculateObjectSize(reply);
        documents += reply.cursor?.firstBatch?.length ?? 0;
      });
      await expireGovernmentTenders(db, 5);
      const idle = { commands, returnedBsonBytes: bytes, documents };
      const rows: GovernmentTender[] = Array.from({ length: 100 }, () => ({
        _id: new ObjectId().toHexString(),
        countryId: "US",
        title: "Synthetic expiry",
        description: "Synthetic tender workload",
        terms: { type: "defence", component: "ground", lots: 1, grade: 0, maximumPricePerLot: 1 },
        issuerLevel: "national",
        publishedBy: "synthetic",
        publishedTurn: 1,
        closesTurn: 3,
        awardDeadlineTurn: 5,
        status: "open",
        bids: {},
        revision: 0,
        contractId: new ObjectId().toHexString(),
        allocationWindowId: "US:0",
        reservedAmount: 1,
        updatedAt: new Date(),
      }));
      await tenders(db).insertMany(rows);
      const reservations = Object.fromEntries(
        rows.map((t) => [t._id, { state: "held", amount: 1 }])
      );
      await db.collection("federalBudget").insertOne({
        countryId: "US",
        defenseAppropriation: {
          balance: 1000,
          encumbered: 100,
          governmentTenderReservations: reservations,
        },
      });
      await db.collection("defenceProcurementAllocations").insertOne({
        _id: "US:0" as never,
        countryAmount: 100,
        governmentTenderReservations: reservations,
      });
      commands = 0;
      bytes = 0;
      documents = 0;
      await expireGovernmentTenders(db, 5);
      const expiration = { commands, returnedBsonBytes: bytes, documents };
      expect(expiration.commands).toBeLessThanOrEqual(
        PHASE_ROUND_TRIP_BUDGETS.governmentContractExpiry
      );
      expect(expiration.commands).toBe(5);
      expect(expiration.documents).toBe(100);
      expect(
        (await db.collection("federalBudget").findOne({ countryId: "US" }))?.defenseAppropriation
          .encumbered
      ).toBe(0);
      expect(
        (await db.collection("defenceProcurementAllocations").findOne({}))?.countryAmount
      ).toBe(0);
      expect(
        await tenders(db).countDocuments({ status: "canceled", reservationReleased: true })
      ).toBe(100);
      commands = 0;
      bytes = 0;
      documents = 0;
      await expireGovernmentTenders(db, 5);
      const replay = { commands, returnedBsonBytes: bytes, documents };
      expect(replay.commands).toBe(2);
      const report = {
        scope:
          "Owned standalone Mongo, synthetic expiry phase only; no configured world or production data",
        cases: { idle, expiration, replay },
        budget: PHASE_ROUND_TRIP_BUDGETS.governmentContractExpiry,
        outcome: "passed",
      };
      if (process.env.AHD_CONTRACT_QUALIFICATION_RECEIPT)
        writeFileSync(
          process.env.AHD_CONTRACT_QUALIFICATION_RECEIPT,
          JSON.stringify(report, null, 2)
        );
    } finally {
      await client.close();
    }
  });
});
