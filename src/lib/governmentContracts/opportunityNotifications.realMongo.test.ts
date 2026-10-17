import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { ObjectId, MongoClient } from "mongodb";
import {
  REAL_MONGO_ENABLED,
  startIsolatedMongod,
  stopIsolatedMongod,
  assertOwnedMongod,
  type IsolatedMongod,
} from "@/lib/test-utils/realMongoFixture";
import { notifyTenderBidders } from "./opportunityNotifications";
import type { GovernmentTender } from "./types";

describe.skipIf(!REAL_MONGO_ENABLED)("tender alerts on owned Mongo", () => {
  let fixture: IsolatedMongod;
  beforeAll(async () => {
    fixture = await startIsolatedMongod("ahd-tender-alerts-");
  }, 40000);
  afterAll(async () => {
    if (fixture) await stopIsolatedMongod(fixture);
  }, 25000);
  it("batches eligible CEOs, groups corporations, excludes vacant/NPP/ineligible corps and retries without duplicates", async () => {
    const client = new MongoClient(fixture.uri, { monitorCommands: true });
    await client.connect();
    await assertOwnedMongod(fixture.proc, client);
    try {
      const db = client.db(fixture.dbName);
      await db.dropDatabase();
      const owner = new ObjectId(),
        unrelated = new ObjectId(),
        vacant = new ObjectId(),
        npp = new ObjectId();
      const eligible = Array.from({ length: 100 }, (_, i) => ({
        _id: new ObjectId(),
        name: "Synthetic extraction " + i,
        userId: owner,
        type: "extraction",
        countryId: "US",
      }));
      const excluded = [
        { _id: new ObjectId(), userId: unrelated, name: "Elsewhere", type: "extraction" },
        {
          _id: new ObjectId(),
          userId: vacant,
          name: "Vacant",
          type: "extraction",
          ceoVacant: true,
        },
        { _id: new ObjectId(), userId: npp, name: "NPP", type: "extraction", ceoType: "npp" },
        { _id: new ObjectId(), userId: "invalid", name: "Malformed", type: "extraction" },
      ];
      await db.collection("corporations").insertMany([...eligible, ...excluded]);
      await db.collection("corporateSectors").insertMany(
        [...eligible, ...excluded].map((c) => ({
          corporationId: c._id,
          stateId: c.userId === unrelated ? "CA" : "TX",
          sectorType: "extraction",
        }))
      );
      const tender = {
        _id: new ObjectId().toHexString(),
        countryId: "US",
        status: "open",
        title: "Synthetic oil concession",
        closesTurn: 25,
        awardDeadlineTurn: 49,
        publishedTurn: 1,
        terms: { type: "extraction", stateId: "TX", resource: "oil", minimumSigningFeeAnchor: 0 },
      } as GovernmentTender;
      let commands = 0;
      client.on("commandStarted", () => {
        commands++;
      });
      await notifyTenderBidders(db, tender, 1, new Date("2026-10-16T12:00:00Z"));
      const deliveryCommands = commands;
      // 102 queried corporations need one cursor getMore at Mongo\'s default batch size.
      expect(deliveryCommands).toBeLessThanOrEqual(4);
      const alerts = await db.collection("notifications").find({}).toArray();
      expect(alerts).toHaveLength(1);
      expect(alerts[0].userId.equals(owner)).toBe(true);
      expect(alerts[0].metadata.corporationIds).toHaveLength(100);
      expect(alerts[0].message).toContain("turn 25");
      expect(alerts[0].message).toContain("turn 49");
      await db
        .collection("notifications")
        .updateOne({ _id: alerts[0]._id }, { $set: { read: true } });
      await notifyTenderBidders(db, tender, 1, new Date());
      expect(await db.collection("notifications").countDocuments()).toBe(1);
      expect((await db.collection("notifications").findOne({ _id: alerts[0]._id }))?.read).toBe(
        true
      );
      commands = 0;
      await notifyTenderBidders(db, tender, 25, new Date());
      expect(commands).toBe(0);
      console.log(
        JSON.stringify({
          tenderDiscovery: {
            candidateCorporations: 104,
            eligibleCorporations: 100,
            recipients: 1,
            deliveryCommands,
          },
        })
      );
    } finally {
      await client.close();
    }
  });
});
