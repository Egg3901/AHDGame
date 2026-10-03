import { ObjectId, MongoClient, type Db, type Document } from "mongodb";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";

import { seedModernOpeningCandidates } from "./seedModernOpeningCandidates";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(() => {
    throw new Error("Ambient DB forbidden");
  }),
}));

it
  .skipIf(process.env.AHD_OPENING_CANDIDATES_REAL_MONGO !== "1")
  .each(["1991-default", "2019-default"])(
  "%s opens named seed cases with eligible distinct candidates and retries without writes",
  async (preset) => {
    const client = await MongoClient.connect("mongodb://127.0.0.1:27018", { maxPoolSize: 2 });
    const target = `ahd_sim_issue2072_fields_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const db: Db = client.db(target);
    try {
      const now = new Date("2026-01-01T00:00:00Z");
      await db
        .collection<Document & { _id: string }>("gameState")
        .insertOne({ _id: "current", currentTurn: 1 });
      const regions = [
        ["IE", "IE_DUB"],
        ["NG", "NG_NW"],
        ["DE", "DE_BY"],
        ["US", "VT"],
      ];
      await db
        .collection<Document & { _id: string }>("states")
        .insertMany(regions.map(([countryId, _id]) => ({ countryId, _id })));
      await db.collection("politicalParties").insertMany(
        regions.flatMap(([countryId]) =>
          [1, 2].map((sequentialId) => ({
            countryId,
            sequentialId,
            isDefault: true,
            economicPosition: 0,
            socialPosition: 0,
          }))
        )
      );
      await db.collection("statePartyOrg").insertMany(
        regions.flatMap(([countryId, stateId]) =>
          [1, 2].map((party) => ({
            countryId,
            stateId,
            partyId: String(party),
            hasPresence: party === 2,
            organization: 50,
          }))
        )
      );
      const officialId = new ObjectId();
      await db.collection("npps").insertOne({
        _id: officialId,
        countryId: "DE",
        party: "2",
        homeState: "DE_BY",
        name: "Existing incumbent",
        retiredAt: null,
      });
      await db
        .collection("electedOfficials")
        .insertOne({ nppId: officialId, office: "ministerPresident", state: "DE_BY" });
      const races = [
        ["IE", "IE_DUB", "localCouncil"],
        ["NG", "NG_NW", "regionalCouncil"],
        ["DE", "DE_BY", "ministerPresident"],
        ["US", "US", "president"],
        ["US", "VT", "house"],
        ["US", "VT", "house"],
      ];
      await db.collection("elections").insertMany(
        races.map(([countryId, state, electionType]) => ({
          countryId,
          state,
          electionType,
          status: "active",
          startTurn: 1,
          primaryEndTurn: 10,
        }))
      );
      const officials = await db.collection("electedOfficials").find({}).toArray();
      expect(await seedModernOpeningCandidates(db, "1953-default", now)).toBe(0);
      expect(await seedModernOpeningCandidates(db, preset, now)).toBe(6);
      const candidates = await db.collection("electionCandidates").find({}).toArray();
      const actors = await db
        .collection("npps")
        .find({ _id: { $ne: officialId } })
        .toArray();
      expect(candidates).toHaveLength(6);
      expect(new Set(candidates.map((c) => String(c.nppId))).size).toBe(6);
      expect(new Set(actors.map((a) => a.sequentialId)).size).toBe(6);
      expect(candidates.every((c) => c.party === "2" && c.status === "active" && c.isNPP)).toBe(
        true
      );
      expect(actors.every((a) => a.currentOffice === null && a.funds === 0)).toBe(true);
      expect(actors.find((a) => a.countryId === "US")?.homeState).toBe("VT");
      expect(await seedModernOpeningCandidates(db, preset, now)).toBe(0);
      expect(await db.collection("electedOfficials").find({}).toArray()).toEqual(officials);
    } finally {
      expect(db.databaseName).toBe(target);
      await db.dropDatabase();
      await client.close();
    }
  }
);
