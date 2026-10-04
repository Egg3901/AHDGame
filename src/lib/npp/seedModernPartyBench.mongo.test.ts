import { randomUUID } from "node:crypto";
import { MongoClient, type Document } from "mongodb";
import { expect, it, vi } from "vitest";
import { seedModernPartyBench } from "./seedModernPartyBench";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
const enabled = process.env.AHD_MODERN_PARTY_BENCH_REAL_MONGO === "1";

it.skipIf(!enabled).each(["1991-default", "2019-default"])(
  "%s supplies modern party actors without seating officials, reviving retired actors or changing 1953",
  async (preset) => {
    const client = await new MongoClient("mongodb://127.0.0.1:27018").connect();
    const name = `ahd_sim_issue2072_bench_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const db = client.db(name);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockRejectedValue(
      new Error("Ambient database access is forbidden in this seed")
    );
    try {
      await db.collection<Document & { _id: string }>("states").insertMany([
        { _id: "PL_MAZ", countryId: "PL" },
        { _id: "PL_POM", countryId: "PL" },
        { _id: "HU_BUD", countryId: "HU" },
        { _id: "UKR_KYI", countryId: "UKR" },
      ]);
      await db.collection<Document & { _id: string }>("gameState").insertOne({
        _id: "current",
        startingPartiesMode: "none",
      });
      await db.collection("statePartyOrg").insertOne({
        countryId: "PL",
        partyId: "2",
        stateId: "PL_POM",
        organization: 90,
        hasPresence: true,
      });
      await db.collection("politicalParties").insertMany(
        [
          { sequentialId: 1, countryId: "PL", isDefault: true, memberCount: 0 },
          { sequentialId: 2, countryId: "PL", isDefault: true, memberCount: 0 },
          { sequentialId: 1, countryId: "HU", isDefault: true, memberCount: 0 },
          { sequentialId: 2, countryId: "HU", isDefault: true, memberCount: 0 },
          { sequentialId: 3, countryId: "HU", isDefault: false, memberCount: 0 },
          { sequentialId: 1, countryId: "UKR", isDefault: true, memberCount: 0 },
          { sequentialId: 1, countryId: "US", isDefault: true, memberCount: 0 },
          { sequentialId: 1, countryId: "UK", isDefault: true, memberCount: 0 },
          { sequentialId: 1, countryId: "JP", isDefault: true, memberCount: 0 },
        ].map((party) => ({ ...party, economicPosition: 0, socialPosition: 0 }))
      );
      const parties = await db.collection("politicalParties").find({}).toArray();
      await db.collection("npps").insertMany([
        { name: "Existing Polish actor", party: "1", countryId: "PL", retiredAt: null },
        { name: "Retired Polish actor", party: "2", countryId: "PL", retiredAt: new Date() },
        { name: "Foreign actor", party: "2", countryId: "US", retiredAt: null },
      ]);
      expect(await seedModernPartyBench(db, "1953-default")).toBe(0);
      expect(await db.collection("npps").countDocuments({})).toBe(3);
      expect(await seedModernPartyBench(db, preset)).toBe(3);
      const created = await db
        .collection("npps")
        .find({ sequentialId: { $exists: true } })
        .toArray();
      expect(created).toHaveLength(3);
      expect(new Set(created.map((npp) => npp.name)).size).toBe(3);
      expect(new Set(created.map((npp) => npp.sequentialId)).size).toBe(3);
      expect(created.find((actor) => actor.countryId === "PL")?.homeState).toBe("PL_POM");
      expect(getDb).not.toHaveBeenCalled();
      for (const actor of created) {
        expect(actor.currentOffice).toBeNull();
        expect(actor.funds).toBe(0);
        expect(actor.retiredAt).toBeNull();
        expect(Number.isFinite(actor.policies.economic)).toBe(true);
        expect(Number.isFinite(actor.policies.social)).toBe(true);
        expect(actor.countryId).not.toBe("US");
        expect(actor.countryId).not.toBe("UKR");
      }
      expect(await seedModernPartyBench(db, preset)).toBe(0);
      expect(await seedModernPartyBench(db, "2019-default")).toBe(0);
      expect(await db.collection("electedOfficials").countDocuments({})).toBe(0);
      expect(await db.collection("politicalParties").find({}).toArray()).toEqual(parties);
      await db.collection("politicalParties").insertOne({
        countryId: "DE",
        sequentialId: 1,
        isDefault: true,
        memberCount: 0,
      });
      await expect(seedModernPartyBench(db, preset)).rejects.toThrow(
        "no valid identity or authored region"
      );
      expect(await db.collection("npps").countDocuments({})).toBe(6);
    } finally {
      if (!/^ahd_sim_issue2072_bench_[a-f0-9]{12}$/.test(db.databaseName))
        throw new Error("Refusing cleanup outside the disposable sandbox fixture");
      await db.dropDatabase();
      await client.close();
    }
  },
  60_000
);
