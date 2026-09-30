/** Real candidate supply and resolution for overlapping upper/lower chamber races. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { MongoClient, ObjectId, type Document } from "mongodb";
import type { Election, ElectionCandidate, ElectionVoteTally } from "../../src/lib/db/types";
import { processChallengerGeneration } from "../../src/lib/turn/npp/challengerSupply";
import { resolveOneGeneralElection } from "../../src/lib/turn/election/generalResolution";
import { officeKeyForElectionType } from "../../src/lib/utils/electionLabels";
import { findBlockingActiveCandidacy } from "../../src/lib/elections/activeCandidacy";

const arg = (name: string) =>
  process.argv.find((s) => s.startsWith(`--${name}=`))?.slice(name.length + 3);
const fields = ["npp_only", "player_vs_npp", "opposing_players", "mixed_same_party"] as const;
const pairs = [
  { country: "US", state: "OR", lower: "house", upper: "senate", lowerSeats: 5, upperSeats: 1 },
  {
    country: "TR",
    state: "TR_IST",
    lower: "milletMeclisi",
    upper: "senato",
    lowerSeats: 6,
    upperSeats: 3,
  },
] as const;

async function main() {
  const uri = process.env.SIM_MONGODB_URI,
    target = arg("target"),
    out = arg("out");
  assert(uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri));
  assert(target && /^ahd_sim_[a-zA-Z0-9_]{1,64}$/.test(target) && out);
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const sourceCommit = git("rev-parse", "HEAD"),
    development = !!git("status", "--porcelain");
  assert(!development || process.argv.includes("--development"), "Commit acceptance source");
  Object.assign(process.env, {
    NODE_ENV: "test",
    MONGODB_URI: uri,
    MONGODB_DB: target,
    RAILWAY_SERVICE_NAME: "overlap-qualification",
  });
  globalThis.fetch = async () => {
    throw new Error("External fetch disabled");
  };
  let randomState = 2159;
  const oldRandom = Math.random;
  Math.random = () =>
    (randomState = (Math.imul(1664525, randomState) + 1013904223) >>> 0) / 4294967296;
  const client = await new MongoClient(uri).connect();
  global._mongoClientPromise = Promise.resolve(client);
  const results: Document[] = [];
  const now = new Date("1993-01-01T00:00:00Z");
  try {
    const db = client.db(target);
    assert.equal((await db.listCollections().toArray()).length, 0, "Preserve earlier evidence");
    await db.collection("electionCandidates").createIndex(
      { characterId: 1 },
      {
        name: "unique_active_election_candidate_per_character",
        unique: true,
        partialFilterExpression: { status: "active" },
      }
    );
    for (const pair of pairs)
      for (const field of fields)
        for (const lowerFirst of [true, false]) {
          if (arg("country") && arg("country") !== pair.country) continue;
          for (const collection of await db.listCollections().toArray())
            await db.collection(collection.name).deleteMany({});
          await db.collection("gameState").insertOne({
            _id: "current" as never,
            preset: "1991-default",
            currentYear: 1993,
            currentTurn: 96,
            eraSystemEnabled: true,
            redistrictingEnabled: false,
          });
          await db
            .collection("gameConfig")
            .insertOne({ discordWebhookOwnerService: "disabled-qualification" });
          await db.collection("politicalParties").insertMany(
            [1, 2].map((party) => ({
              _id: new ObjectId(),
              countryId: pair.country,
              sequentialId: party,
              name: `Synthetic party ${party}`,
              isDefault: true,
              economicPosition: party === 1 ? -2 : 2,
              socialPosition: 0,
            }))
          );
          await db.collection("statePartyOrg").insertMany(
            [1, 2].map((party) => ({
              _id: new ObjectId(),
              stateId: pair.state,
              partyId: String(party),
              hasPresence: true,
              organization: 50,
            }))
          );
          const races = [
            { type: pair.lower, seats: pair.lowerSeats },
            { type: pair.upper, seats: pair.upperSeats },
          ].map(
            (race) =>
              ({
                _id: new ObjectId(),
                countryId: pair.country,
                state: pair.state,
                electionType: race.type,
                totalSeats: race.seats,
                cycle: 1,
                status: "active",
                startTime: now,
                primaryEndTurn: 99,
                endTurn: 100,
                endTime: now,
                createdAt: now,
                updatedAt: now,
              }) as Election
          );
          if (!lowerFirst) races.reverse();
          await db.collection<Election>("elections").insertMany(races);
          // Exhaust the four-member local pool in the first race, reproducing the
          // historical overlap failure. Players take distinct identities per race.
          for (let n = 0; n < 4; n++) {
            const id = new ObjectId(),
              party = String((n % 2) + 1);
            await db.collection("npps").insertOne({
              _id: id,
              name: `Synthetic busy ${n}`,
              countryId: pair.country,
              party,
              homeState: pair.state,
              currentOffice: null,
            });
            await db.collection<ElectionCandidate>("electionCandidates").insertOne({
              _id: new ObjectId(),
              electionId: races[0]._id,
              characterId: id,
              nppId: id,
              isNPP: true,
              characterName: `Synthetic busy ${n}`,
              party,
              status: "active",
              enteredAt: now,
            } as ElectionCandidate);
          }
          for (const race of races) {
            const playerParties =
              field === "npp_only" ? [] : field === "opposing_players" ? ["1", "2"] : ["1"];
            // For pure opposing-player and player-vs-NPP fields, replace that
            // party's fixture candidates, leaving them busy in a reserve race.
            for (const party of playerParties) {
              if (field !== "mixed_same_party") {
                const reserve = {
                  ...race,
                  _id: new ObjectId(),
                  electionType: "governor",
                  status: "upcoming",
                } as Election;
                await db.collection<Election>("elections").insertOne(reserve);
                await db
                  .collection("electionCandidates")
                  .updateMany(
                    { electionId: race._id, party },
                    { $set: { electionId: reserve._id } }
                  );
              }
              const id = new ObjectId();
              await db.collection("characters").insertOne({
                _id: id,
                userId: new ObjectId(),
                countryId: pair.country,
                firstName: "Synthetic",
                lastName: party,
                party,
                state: pair.state,
                currentOffice: null,
              });
              await db.collection<ElectionCandidate>("electionCandidates").insertOne({
                _id: new ObjectId(),
                electionId: race._id,
                characterId: id,
                isNPP: false,
                characterName: `Synthetic player ${party}`,
                party,
                status: "active",
                enteredAt: now,
              } as ElectionCandidate);
            }
          }
          if (field === "mixed_same_party") {
            const id = new ObjectId();
            await db.collection("npps").insertOne({
              _id: id,
              name: "Synthetic mixed bench",
              countryId: pair.country,
              party: "1",
              homeState: pair.state,
              currentOffice: null,
            });
            await db.collection<ElectionCandidate>("electionCandidates").insertOne({
              _id: new ObjectId(),
              electionId: races[1]._id,
              characterId: id,
              nppId: id,
              isNPP: true,
              characterName: "Synthetic mixed bench",
              party: "1",
              status: "active",
              enteredAt: now,
            } as ElectionCandidate);
          }
          const beforeNpps = await db.collection("npps").countDocuments();
          const filed = await processChallengerGeneration(now);
          assert.equal(
            await processChallengerGeneration(now),
            0,
            "Candidate supply self-extinguishes"
          );
          const checkFields = async (unresolved: Election[]) => {
            const active = await db
              .collection<ElectionCandidate>("electionCandidates")
              .find({ status: "active" })
              .toArray();
            assert.equal(
              new Set(active.map((c) => c.characterId?.toString())).size,
              active.length,
              "One active candidacy per actor"
            );
            for (const race of unresolved) {
              const candidates = active.filter((c) => c.electionId.equals(race._id));
              assert(candidates.length >= 2, "Every overlapping chamber remains contested");
              const players = candidates.filter((candidate) => !candidate.isNPP);
              const npps = candidates.filter((candidate) => candidate.isNPP);
              if (field === "npp_only") assert.equal(players.length, 0);
              else if (field === "opposing_players") assert.equal(npps.length, 0);
              else {
                assert(players.length > 0 && npps.length > 0);
                if (field === "mixed_same_party")
                  assert(
                    npps.some((candidate) =>
                      players.some((player) => player.party === candidate.party)
                    )
                  );
              }
              assert.deepEqual([...new Set(candidates.map((c) => c.party))].sort(), ["1", "2"]);
              for (const candidate of candidates)
                assert(
                  await db
                    .collection(candidate.isNPP ? "npps" : "characters")
                    .findOne({ _id: candidate.nppId ?? candidate.characterId }),
                  "Every candidate has an actor"
                );
            }
          };
          await checkFields(races);
          const firstCandidate = await db
            .collection<ElectionCandidate>("electionCandidates")
            .findOne({ electionId: races[0]._id, status: "active" });
          assert(firstCandidate?.characterId);
          assert(await findBlockingActiveCandidacy(db, firstCandidate.characterId, races[1]._id));
          await assert.rejects(
            db
              .collection("electionCandidates")
              .insertOne({ ...firstCandidate, _id: new ObjectId(), electionId: races[1]._id }),
            (error: unknown) =>
              typeof error === "object" && error !== null && "code" in error && error.code === 11000
          );
          const outcomes: Document[] = [];
          for (let index = 0; index < races.length; index++) {
            const race = races[index];
            await db
              .collection("elections")
              .updateOne({ _id: race._id }, { $set: { status: "completed" } });
            const candidates = await db
              .collection<ElectionCandidate>("electionCandidates")
              .find({ electionId: race._id, status: "active" })
              .toArray();
            for (const candidate of candidates) {
              assert(candidate.characterId);
              assert(
                await findBlockingActiveCandidacy(db, candidate.characterId, races[1 - index]._id),
                "Completed races still block duplicate entry before resolution"
              );
            }
            const totalVotes = Object.fromEntries(
              candidates.map((candidate) => [
                String(candidate._id),
                (candidate.party === "1" ? 80000 : 20000) /
                  candidates.filter((c) => c.party === candidate.party).length,
              ])
            );
            const tally = {
              _id: new ObjectId(),
              electionId: race._id,
              state: pair.state,
              totalVotes,
              candidateNames: Object.fromEntries(
                candidates.map((c) => [String(c._id), c.characterName])
              ),
              candidateParties: Object.fromEntries(candidates.map((c) => [String(c._id), c.party])),
              turnSnapshots: [],
              finalized: false,
              createdAt: now,
              updatedAt: now,
            } as ElectionVoteTally;
            await db.collection<ElectionVoteTally>("electionVoteTallies").insertOne(tally);
            const resolution = await resolveOneGeneralElection(
              db,
              { ...race, status: "completed" },
              tally,
              100,
              now
            );
            assert(resolution.resolved);
            const players = candidates.filter((c) => !c.isNPP).length;
            for (let attempt = 0; attempt < 200; attempt++) {
              const histories = await db
                .collection("politicianOverrides")
                .countDocuments({ "electionHistory.electionId": String(race._id) });
              if (histories === players) break;
              assert(attempt < 199, "Local history completes before next fixture");
              await new Promise((done) => setTimeout(done, 10));
            }
            assert.equal(
              await db
                .collection("electionCandidates")
                .countDocuments({ electionId: race._id, status: "active" }),
              0
            );
            await checkFields(races.slice(index + 1));
            const persisted = await db
              .collection<ElectionVoteTally>("electionVoteTallies")
              .findOne({ _id: tally._id });
            assert(persisted?.finalized);
            assert.equal(persisted.resolvedTotalSeats, race.totalSeats);
            const officials = await db
              .collection("electedOfficials")
              .find({
                countryId: pair.country,
                state: pair.state,
                officeType: officeKeyForElectionType(race.electionType, race.countryId),
              })
              .toArray();
            assert.equal(
              officials.reduce((sum, o) => sum + (o.seatsHeld ?? 1), 0),
              race.totalSeats
            );
            for (const official of officials) {
              const actor = await db
                .collection(official.nppId ? "npps" : "characters")
                .findOne({ _id: official.nppId ?? official.characterId });
              assert.equal(
                actor?.currentOffice?.type,
                officeKeyForElectionType(race.electionType, race.countryId),
                "Holder office uses the canonical office key"
              );
            }
            outcomes.push({
              chamber: race.electionType,
              candidates: candidates.length,
              players: candidates.filter((c) => !c.isNPP).length,
              npps: candidates.filter((c) => c.isNPP).length,
              seats: persisted.resolvedTotalSeats,
              resolved: true,
            });
          }
          results.push({
            country: pair.country,
            state: pair.state,
            field,
            lowerFirst,
            initiallyBusyNpps: beforeNpps,
            filed,
            generatedNpps: (await db.collection("npps").countDocuments()) - beforeNpps,
            outcomes,
            overlappingFieldsValid: true,
            duplicateEntryRejected: true,
          });
          console.log(
            `PASS ${pair.country}/${field}/${lowerFirst ? "lower-first" : "upper-first"}`
          );
        }
    assert.equal(git("rev-parse", "HEAD"), sourceCommit);
    assert(development || !git("status", "--porcelain"));
    writeFileSync(
      out,
      JSON.stringify(
        {
          sourceCommit,
          development,
          preset: "1991-default",
          syntheticActorsAndVotes: true,
          randomSeed: 2159,
          schemaVersion: 1,
          results,
        },
        null,
        2
      ) + "\n"
    );
  } finally {
    Math.random = oldRandom;
    await client.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
