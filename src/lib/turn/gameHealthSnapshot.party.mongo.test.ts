import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { expect, it, vi } from "vitest";
import { processGameHealthSnapshot } from "./gameHealthSnapshot";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const enabled = process.env.AHD_NPC_PARTY_HEALTH_REAL_MONGO === "1";

it.skipIf(!enabled)(
  "counts active NPC members without hiding retired, foreign or genuinely empty parties",
  async () => {
    const client = await new MongoClient("mongodb://127.0.0.1:27018").connect();
    const name = `ahd_sim_issue2072_party_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const db = client.db(name);
    try {
      await db.collection("characters").insertOne({ countryId: "US", funds: 0 });
      await db.collection("politicalParties").insertMany([
        { sequentialId: 1, countryId: "DE", memberCount: 0 },
        { sequentialId: 2, countryId: "DE", memberCount: 0 },
        { sequentialId: 3, countryId: "DE", memberCount: 0 },
        { sequentialId: 4, countryId: "DE", memberCount: 0 },
        { sequentialId: 5, countryId: "DE", memberCount: 1 },
        { sequentialId: 6, memberCount: 0 },
        { countryId: "DE", memberCount: 0 },
      ]);
      await db
        .collection("npps")
        .insertMany([
          { party: "1", countryId: "DE", retiredAt: null },
          { party: "2", countryId: "DE", retiredAt: new Date() },
          { party: "4", countryId: "JP", retiredAt: null },
          { party: "6" },
          { countryId: "DE", retiredAt: null },
        ]);
      const originalParties = await db.collection("politicalParties").find({}).toArray();
      await processGameHealthSnapshot(db, 1, 1991, 0, true, []);
      const snapshot = await db.collection("gameHealthSnapshots").findOne({ turn: 1 });
      expect(
        snapshot?.dataIntegrity.issues.filter(
          (issue: { category: string }) => issue.category === "emptyParty"
        )
      ).toEqual([
        {
          category: "emptyParty",
          severity: "warning",
          message: "4 parties have zero members",
          collection: "politicalParties",
        },
      ]);
      expect(snapshot?.health.integrityErrorCount).toBe(0);
      expect(await db.collection("politicalParties").find({}).toArray()).toEqual(originalParties);
    } finally {
      if (!/^ahd_sim_issue2072_party_[a-f0-9]{12}$/.test(db.databaseName))
        throw new Error("Refusing cleanup outside the disposable sandbox fixture");
      await db.dropDatabase();
      await client.close();
    }
  },
  60_000
);
