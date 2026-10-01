/** Isolated presidential transition qualification; synthetic actors, real writes. */
import assert from "node:assert/strict";
import { MongoClient, ObjectId } from "mongodb";
import { seatPresidentialExecutive } from "../../src/lib/turn/election/presidentExecutiveSeating";
import type { Election, ElectionCandidate } from "../../src/lib/db/types";

async function main() {
  const uri = process.env.SIM_MONGODB_URI;
  const target = process.argv.find((v) => v.startsWith("--target="))?.slice(9);
  assert(uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri));
  assert(target && /^ahd_sim_[a-zA-Z0-9_]{1,64}$/.test(target));
  Object.assign(process.env, { NODE_ENV: "test", MONGODB_URI: uri, MONGODB_DB: target });
  const client = await new MongoClient(uri).connect();
  global._mongoClientPromise = Promise.resolve(client);
  const db = client.db(target);
  try {
    assert.equal((await db.listCollections().toArray()).length, 0, "Preserve prior evidence");
    await db.collection("gameState").insertOne({
      _id: "current" as never,
      preset: "1991-default",
      currentYear: 1991,
      currentTurn: 96,
    });
    const now = new Date("1992-11-01T00:00:00Z");
    const president = new ObjectId(),
      vicePresident = new ObjectId(),
      prior = new ObjectId();
    for (const [id, name, office] of [
      [president, "Synthetic president", null],
      [vicePresident, "Synthetic vice president", null],
      [prior, "Synthetic incumbent", { type: "president" }],
    ] as const) {
      await db.collection("characters").insertOne({
        _id: id,
        name,
        countryId: "US",
        party: "2",
        currentOffice: office,
        careerHistory: [],
        executiveTermsServed: { US: 0 },
      });
    }
    await db.collection("electedOfficials").insertOne({
      countryId: "US",
      officeType: "president",
      characterId: prior,
      party: "1",
      isNPP: false,
    });
    const election = {
      _id: new ObjectId(),
      countryId: "US",
      electionType: "president",
      status: "completed",
      cycle: 1,
      createdAt: now,
      updatedAt: now,
    } as Election;
    const candidate = {
      _id: new ObjectId(),
      electionId: election._id,
      characterId: president,
      characterName: "Synthetic president",
      isNPP: false,
      countryId: "US",
      party: "2",
      status: "active",
    } as ElectionCandidate;
    const input = { election, winnerCandidate: candidate, vpCharId: vicePresident, now };
    await seatPresidentialExecutive(db, input);
    const first = await db.collection("characters").findOne({ _id: president });
    assert.equal(first?.executiveTermsServed.US, 1);
    await seatPresidentialExecutive(db, { ...input, now: new Date(now.getTime() + 60000) });
    const second = await db.collection("characters").findOne({ _id: president });
    const vp = await db.collection("characters").findOne({ _id: vicePresident });
    assert.equal(
      second?.executiveTermsServed.US,
      1,
      "Seating retry must not consume another presidential term"
    );
    assert.equal(second?.careerHistory.length, 1, "One presidential career event per election");
    assert.equal(vp?.careerHistory.length, 1, "One vice-presidential career event per election");
    console.log(
      JSON.stringify({
        status: "passed",
        presidentTerms: second?.executiveTermsServed.US,
        presidentCareer: second?.careerHistory.length,
        vicePresidentCareer: vp?.careerHistory.length,
      })
    );
  } finally {
    await client.close();
  }
}
main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
