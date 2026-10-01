import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId, type Db, type Document } from "mongodb";
import { expect, it, vi } from "vitest";
import { processChallengerGeneration } from "./challengerSupply";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const enabled = process.env.AHD_SUCCESSOR_CANDIDATES_REAL_MONGO === "1";

it.skipIf(!enabled)(
  "files distinct successor candidates, converges on retry and preserves No Parties player contests",
  async () => {
    const client = await new MongoClient("mongodb://127.0.0.1:27018").connect();
    const name = `ahd_sim_issue2072_candidates_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const db = client.db(name);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as Db);
    try {
      await db.collection<Document & { _id: string }>("gameState").insertOne({
        _id: "current",
        currentTurn: 3,
        preset: "1991-default",
        preIteration: { active: false },
        startingPartiesMode: "none",
      });
      const cases = [
        ["HU", "nationalAssembly", "HU_BUD"],
        ["BG", "nationalAssembly", "BG_SOF"],
        ["PL", "sejm", "PL_MAZ"],
        ["PL", "senat", "PL_MAZ"],
        ["RO", "chamberOfDeputies", "RO_BUC"],
        ["RO", "senat", "RO_BUC"],
      ] as const;
      const parties = ["HU", "BG", "PL", "RO"].flatMap((countryId, countryIndex) =>
        [1, 2].map((partyIndex) => ({
          countryId,
          sequentialId: countryIndex * 2 + partyIndex,
          isDefault: true,
          name: `Fixture ${countryId} ${partyIndex}`,
          economicPosition: 0,
          socialPosition: 0,
        }))
      );
      await db.collection("politicalParties").insertMany(parties);
      const elections = [...cases, ["US", "house", "VT"], ["US", "president", "US"]].map(
        ([countryId, electionType, state]) => ({
          _id: new ObjectId(),
          countryId,
          electionType,
          state,
          status: "active",
          cycle: 1,
          primaryEndTurn: 24,
          endTurn: 48,
          startTurn: 1,
        })
      );
      await db.collection("elections").insertMany(elections);
      await db.collection("statePartyOrg").insertMany(
        [...new Set(cases.map(([countryId, , state]) => `${countryId}:${state}`))].flatMap(
          (key) => {
            const [countryId, stateId] = key.split(":");
            return parties
              .filter((party) => party.countryId === countryId)
              .map((party) => ({
                countryId,
                stateId,
                partyId: String(party.sequentialId),
                hasPresence: true,
                organization: 50,
              }));
          }
        )
      );
      await db
        .collection("electionCandidates")
        .createIndex(
          { characterId: 1 },
          { unique: true, partialFilterExpression: { status: "active" } }
        );

      expect(await processChallengerGeneration(new Date())).toBe(12);
      expect(await db.collection("npps").countDocuments({})).toBe(12);
      const candidates = await db.collection("electionCandidates").find({}).toArray();
      expect(new Set(candidates.map((candidate) => String(candidate.characterId))).size).toBe(12);
      for (const election of elections.filter((election) => election.countryId !== "US")) {
        expect(
          candidates.filter((candidate) => candidate.electionId.equals(election._id))
        ).toHaveLength(2);
      }
      expect(candidates.some((candidate) => candidate.countryId === "US")).toBe(false);
      expect(await db.collection("politicalParties").countDocuments({ countryId: "US" })).toBe(0);

      expect(await processChallengerGeneration(new Date())).toBe(0);
      expect(await db.collection("electionCandidates").countDocuments({})).toBe(12);
      expect(await db.collection("npps").countDocuments({})).toBe(12);
    } finally {
      if (!/^ahd_sim_issue2072_candidates_[a-f0-9]{12}$/.test(db.databaseName))
        throw new Error("Refusing cleanup outside the disposable sandbox fixture");
      await db.dropDatabase();
      await client.close();
    }
  },
  60_000
);
