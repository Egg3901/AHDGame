/** Persisted election flips and holds through the production resolver, on isolated Mongo. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { BSON, MongoClient, ObjectId, type Document, type CollectionOptions } from "mongodb";
import type { Election, ElectionCandidate, ElectionVoteTally } from "../../src/lib/db/types";
import { resolveOneGeneralElection } from "../../src/lib/turn/election/generalResolution";
import { getUkCommonsSeats } from "../../src/lib/constants/states";
import { getElectionMethod } from "../../src/lib/elections/electionMethod";
import { updateCountryState } from "../../src/lib/countryState";
import { maybeReconcileBundestag } from "../../src/lib/turn/election/germanyAMS";

const arg = (name: string) =>
  process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3);
let serial = 0;
const id = () => new ObjectId((++serial).toString(16).padStart(24, "0"));
const families = [
  { name: "single_winner", country: "US", type: "governor", state: "CA", seats: 1 },
  { name: "generic_multi", country: "US", type: "stateSenate", state: "CA", seats: 6 },
  { name: "districted_house", country: "US", type: "house", state: "OR", seats: 5 },
  { name: "commons", country: "UK", type: "commons", state: "LON", seats: 1 },
  { name: "irish_hare_quota", country: "IE", type: "dail", state: "DUB", seats: 6 },
  { name: "bloc_list", country: "DD", type: "volkskammerDeputy", state: "BER", seats: 100 },
  { name: "converted_bloc", country: "DD", type: "volkskammerDeputy", state: "BER", seats: 100 },
  { name: "german_landtag", country: "DE", type: "landtag", state: "BW", seats: 120 },
  { name: "german_ams", country: "DE", type: "bundestag", state: "BW", seats: 40 },
  { name: "german_ams_list_only", country: "DE", type: "bundestag", state: "BW", seats: 40 },
] as const;
const fields = ["npp_only", "player_vs_npp", "opposing_players", "mixed_same_party"] as const;

async function main() {
  const uri = process.env.SIM_MONGODB_URI,
    target = arg("target"),
    out = arg("out");
  assert(uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri));
  assert(target && /^ahd_sim_[a-zA-Z0-9_]{1,64}$/.test(target) && out);
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = () => execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  const development = !!dirty();
  assert(!development || process.argv.includes("--development"), "Commit before acceptance");
  Object.assign(process.env, {
    NODE_ENV: "test",
    MONGODB_URI: uri,
    MONGODB_DB: target,
    RAILWAY_SERVICE_NAME: "general-election-qualification",
  });
  globalThis.fetch = async () => {
    throw new Error("External fetch disabled in qualification");
  };
  const client = await new MongoClient(uri, { monitorCommands: true }).connect();
  let measuring = false,
    commandCount = 0,
    returnedBson = 0;
  client.on("commandStarted", () => {
    if (measuring) commandCount++;
  });
  client.on("commandSucceeded", (event) => {
    if (measuring && event.reply && typeof event.reply === "object")
      returnedBson += BSON.calculateObjectSize(event.reply);
  });
  global._mongoClientPromise = Promise.resolve(client);
  const results: Document[] = [];
  try {
    assert.equal(
      (await client.db(target).listCollections().toArray()).length,
      0,
      "Preserve evidence"
    );
    for (const family of families)
      for (const field of fields) {
        if (arg("family") && arg("family") !== family.name) continue;
        // A new Db object also isolates the country-state request cache between fixtures.
        const db = client.db(target);
        for (const c of await db.listCollections().toArray())
          await db.collection(c.name).deleteMany({});
        const preset = "1991-default",
          now = new Date("1993-01-01T00:00:00Z");
        await db.collection("gameState").insertOne({
          _id: "current" as never,
          preset,
          currentYear: 1993,
          currentTurn: 96,
          eraSystemEnabled: true,
          redistrictingEnabled: family.name === "districted_house",
        });
        await db
          .collection("gameConfig")
          .insertOne({ discordWebhookOwnerService: "disabled-qualification" });
        if (family.country === "DD")
          await updateCountryState(db, "DD", {
            governmentType: family.name === "bloc_list" ? "onePartyState" : "parliamentaryRepublic",
          });
        await db.collection("politicalParties").insertMany(
          [1, 2].map((n) => ({
            _id: id(),
            countryId: family.country,
            sequentialId: n,
            name: `Synthetic party ${n}`,
            abbreviation: family.country === "DE" ? (n === 1 ? "SPD" : "CDU") : `P${n}`,
            economicPosition: n === 1 ? -50 : 50,
            socialPosition: 0,
          }))
        );
        const actors = [
          { _id: id(), party: "1", npp: field === "npp_only" },
          { _id: id(), party: "2", npp: field !== "opposing_players" },
          ...(field === "mixed_same_party" ? [{ _id: id(), party: "1", npp: true }] : []),
        ];
        const listActors =
          family.name === "german_ams_list_only"
            ? [
                { _id: id(), party: "1", npp: false },
                { _id: id(), party: "2", npp: false },
              ]
            : [];
        const roster = [...actors, ...listActors];
        for (const a of roster)
          await db.collection(a.npp ? "npps" : "characters").insertOne({
            _id: a._id,
            userId: id(),
            name: `Synthetic ${a._id}`,
            countryId: family.country,
            party: a.party,
            state: family.state,
            currentOffice: null,
            careerHistory: [],
            retiredAt: null,
            policies: { economic: a.party === "1" ? -50 : 50, social: 0 },
          });
        if (listActors.length)
          await db.collection("landeslisten").insertMany(
            [1, 2, 3].flatMap((cycle) =>
              listActors.map((a) => ({
                countryId: "DE",
                cycle,
                partyId: a.party,
                landId: "BW",
                candidates: [a._id],
              }))
            )
          );
        const seats =
          family.name === "commons" ? getUkCommonsSeats(preset)[family.state] : family.seats;
        if (family.name === "districted_house")
          await db.collection("congressionalDistricts").insertMany(
            Array.from({ length: seats }, (_, index) => ({
              _id: id(),
              countryId: "US",
              stateId: family.state,
              index,
              netLean: index * 10 - 20,
              holderCharacterId: null,
              holderNppId: null,
              holderParty: null,
            }))
          );
        const cycles: Document[] = [];
        for (let cycle = 1; cycle <= 3; cycle++) {
          const aShare =
            family.seats === 1 && field === "mixed_same_party"
              ? cycle === 1
                ? 0.8
                : cycle === 2
                  ? 0.7
                  : 0.2
              : cycle === 1
                ? 0.7
                : cycle === 2
                  ? 0.6
                  : 0.3;
          const election: Election = {
            _id: id(),
            countryId: family.country,
            electionType: family.type,
            state: family.state,
            cycle,
            status: "completed",
            totalSeats: seats,
            startTime: now,
            endTime: now,
            createdAt: now,
            updatedAt: now,
          } as Election;
          const candidates: ElectionCandidate[] = actors.map((a) => ({
            _id: id(),
            electionId: election._id,
            characterId: a._id,
            ...(a.npp ? { nppId: a._id } : {}),
            isNPP: a.npp,
            characterName: `Synthetic ${a._id}`,
            party: a.party,
            status: "active",
            enteredAt: now,
          }));
          const totalVotes = Object.fromEntries(
            candidates.map((c, i) => [
              c._id.toString(),
              Math.round(
                100_000 *
                  (c.party === "2"
                    ? 1 - aShare
                    : field === "mixed_same_party"
                      ? aShare * (i === 0 ? 0.6 : 0.4)
                      : aShare)
              ),
            ])
          );
          const tally: ElectionVoteTally = {
            _id: id(),
            electionId: election._id,
            state: family.state,
            totalVotes,
            candidateNames: Object.fromEntries(
              candidates.map((c) => [c._id.toString(), c.characterName])
            ),
            candidateParties: Object.fromEntries(
              candidates.map((c) => [c._id.toString(), c.party])
            ),
            turnSnapshots: [],
            finalized: false,
            createdAt: now,
            updatedAt: now,
          } as ElectionVoteTally;
          await db.collection<Election>("elections").insertOne(election);
          await db.collection<ElectionCandidate>("electionCandidates").insertMany(candidates);
          await db.collection<ElectionVoteTally>("electionVoteTallies").insertOne(tally);
          commandCount = 0;
          returnedBson = 0;
          measuring = true;
          if (process.argv.includes("--fault-ams-holder") && cycle === 1 && field === "npp_only") {
            const original = db.collection.bind(db);
            let failed = false;
            db.collection = ((name: string, options?: CollectionOptions) => {
              const coll = original(name, options);
              if (name === "npps") {
                const bulk = coll.bulkWrite.bind(coll);
                coll.bulkWrite = async (operations, options) => {
                  if (!failed) {
                    failed = true;
                    throw new Error("Injected AMS holder interruption");
                  }
                  return bulk(operations, options);
                };
              }
              return coll;
            }) as typeof db.collection;
            await assert.rejects(
              resolveOneGeneralElection(db, election, tally, 96 + cycle, now),
              /Injected AMS holder interruption/
            );
            db.collection = original;
            assert.equal(
              (await db.collection("elections").findOne({ _id: election._id }))?.status,
              "completed"
            );
            const interrupted = await db
              .collection<ElectionVoteTally>("electionVoteTallies")
              .findOne({ _id: tally._id });
            assert(interrupted?.finalized);
            await resolveOneGeneralElection(db, election, interrupted, 96 + cycle, now);
          } else if (
            process.argv.includes("--fault-after-finalize") &&
            cycle === 1 &&
            field === "player_vs_npp"
          ) {
            const original = db.collection.bind(db);
            let failed = false;
            db.collection = ((name: string, options?: CollectionOptions) => {
              const coll = original(name, options);
              if (name === "electionCandidates") {
                const update = coll.updateMany.bind(coll);
                coll.updateMany = async (filter, changes, options) => {
                  if (!failed) {
                    failed = true;
                    throw new Error("Injected candidate cleanup failure");
                  }
                  return update(filter, changes, options);
                };
              }
              return coll;
            }) as typeof db.collection;
            await assert.rejects(
              resolveOneGeneralElection(db, election, tally, 96 + cycle, now),
              /Injected candidate cleanup failure/
            );
            db.collection = original;
            const interrupted = await db
              .collection<ElectionVoteTally>("electionVoteTallies")
              .findOne({ _id: tally._id });
            assert(interrupted?.finalized, "Failure occurs after result finalization");
            await resolveOneGeneralElection(db, election, interrupted, 96 + cycle, now);
          } else await resolveOneGeneralElection(db, election, tally, 96 + cycle, now);
          measuring = false;
          const performance = { commandCount, returnedBson };
          if (process.argv.includes("--profile-only")) {
            writeFileSync(
              out,
              JSON.stringify({ sourceCommit, family: family.name, field, performance }, null, 2)
            );
            return;
          }
          assert.equal(
            (await db.collection("elections").findOne({ _id: election._id }))?.status,
            "resolved"
          );
          const persisted = await db
            .collection<ElectionVoteTally>("electionVoteTallies")
            .findOne({ _id: tally._id });
          assert(persisted?.finalized);
          assert.equal(persisted.resolvedAtTurn, 96 + cycle);
          const expectedPath =
            family.type === "bundestag"
              ? "ams"
              : family.name === "german_landtag"
                ? "sainte_lague"
                : family.name === "districted_house"
                  ? "districted_house"
                  : family.name === "bloc_list"
                    ? "bloc_list"
                    : family.name === "single_winner"
                      ? "single_winner"
                      : "hare_quota";
          assert.equal(persisted.resolutionPath, expectedPath, "Actual resolver receipt");
          assert.equal(
            await db
              .collection("electionCandidates")
              .countDocuments({ electionId: election._id, status: "active" }),
            0
          );
          const officials = await db
            .collection("electedOfficials")
            .find({ countryId: family.country, officeType: family.type, state: family.state })
            .sort({ party: 1, seatSource: 1 })
            .toArray();
          const partySeats: Record<string, number> = {};
          for (const o of officials) {
            partySeats[o.party] = (partySeats[o.party] ?? 0) + (o.seatsHeld ?? 1);
            assert(o.characterName && (o.characterId || o.nppId), "No phantom holder");
            const a = roster.find((a) => a._id.equals(o.nppId ?? o.characterId));
            assert(a, "Every holder exists");
            const actor = await db
              .collection(a.npp ? "npps" : "characters")
              .findOne({ _id: a._id });
            assert.equal(
              actor?.currentOffice?.type,
              family.type,
              "Official and currentOffice agree"
            );
          }
          const total = Object.values(partySeats).reduce((a, b) => a + b, 0);
          assert.equal(total, family.type === "bundestag" ? 630 : seats, "Complete chamber");
          assert.equal(persisted.resolvedTotalSeats, total, "Frozen complete seat total");
          const normalizeHolders = (
            holders: { identity: string; party: string; seats: number; seatSource: string }[]
          ) => holders.map((holder) => JSON.stringify(holder)).sort();
          assert.deepEqual(
            normalizeHolders(persisted.resolvedSeatHolders ?? []),
            normalizeHolders(
              officials.map((holder) => ({
                identity: `${holder.nppId ? "npp" : "player"}:${holder.nppId ?? holder.characterId}`,
                party: holder.party,
                seats: holder.seatsHeld ?? 1,
                seatSource: holder.seatSource === "list" ? "list" : "direct",
              }))
            ),
            "Frozen receipts include every direct and list holder"
          );
          const leader = Object.entries(partySeats).sort((a, b) => b[1] - a[1])[0][0];
          assert.equal(
            leader,
            family.name === "bloc_list" || cycle < 3 ? "1" : "2",
            "Expected control"
          );
          if (family.name === "bloc_list") assert.deepEqual(partySeats, { "1": 83, "2": 17 });
          for (const a of actors) {
            const actor = await db
              .collection(a.npp ? "npps" : "characters")
              .findOne({ _id: a._id });
            const held = officials.filter((o) => a._id.equals(o.nppId ?? o.characterId));
            if (held.length === 0)
              assert.equal(actor?.currentOffice, null, "Losing incumbent vacated");
            else if (family.seats > 1)
              assert.equal(
                actor?.currentOffice?.seatsHeld,
                held.reduce((sum, o) => sum + (o.seatsHeld ?? 1), 0),
                "Office seat count matches persisted holdings"
              );
          }
          if (family.name === "districted_house") {
            const districts = await db.collection("congressionalDistricts").find({}).toArray();
            assert.equal(districts.length, seats);
            for (const d of districts) {
              assert(!!d.holderCharacterId !== !!d.holderNppId, "Exactly one holder identity type");
              const a = roster.find((a) => a._id.equals(d.holderNppId ?? d.holderCharacterId));
              assert(a && a.party === d.holderParty && a.npp === !!d.holderNppId);
            }
          }
          // Await the production resolver's asynchronous local wiki writes before comparing retry state.
          const playerCount =
            family.name === "german_landtag" ? 0 : actors.filter((a) => !a.npp).length;
          for (let n = 0; n < 200; n++) {
            const done = await db
              .collection("politicianOverrides")
              .countDocuments({ "electionHistory.electionId": election._id.toString() });
            if (done === playerCount) break;
            assert(n < 199, "Local election history completed");
            await new Promise((r) => setTimeout(r, 10));
          }
          const stable = async () =>
            JSON.stringify(
              await Promise.all(
                [
                  "electedOfficials",
                  "characters",
                  "npps",
                  "electionCandidates",
                  "notifications",
                  "congressionalDistricts",
                  "politicianOverrides",
                ].map(async (name) => [
                  name,
                  await db.collection(name).find({}).sort({ _id: 1 }).toArray(),
                ])
              )
            );
          const before = await stable();
          await resolveOneGeneralElection(db, election, persisted, 96 + cycle, now);
          assert.equal(await stable(), before, "Repeat resolution makes no extra writes");
          if (family.type === "bundestag")
            assert.equal(await maybeReconcileBundestag(db, cycle, now), null);
          cycles.push({
            cycle,
            votesParty1: aShare,
            leader,
            partySeats,
            total,
            officials: officials.map((o) => ({
              party: o.party,
              seats: o.seatsHeld ?? 1,
              npp: o.isNPP,
              source: o.seatSource ?? "direct",
            })),
            repeatStable: true,
            performance,
            resolutionPath: persisted.resolutionPath,
            resolvedSeatHolders: persisted.resolvedSeatHolders,
            resolvedTotalSeats: persisted.resolvedTotalSeats,
          });
        }
        results.push({
          family: family.name,
          country: family.country,
          electionType: family.type,
          configuredMethod: getElectionMethod(family.country, family.type),
          field,
          cycles,
        });
        console.log(`PASS ${family.name}/${field}`);
      }
    assert.equal(
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      sourceCommit
    );
    assert(development || !dirty(), "Source unchanged");
    writeFileSync(
      out,
      JSON.stringify(
        {
          sourceCommit,
          development,
          preset: "1991-default",
          schemaVersion: 1,
          syntheticActorsAndVotes: true,
          fullCampaignAccumulation: false,
          results,
        },
        null,
        2
      ) + "\n"
    );
  } finally {
    await client.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
