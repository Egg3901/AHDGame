/** Source-pinned ranked ballot counts through the real resolver and vote accumulator. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { BSON, MongoClient, ObjectId, type Db, type Document } from "mongodb";
import type { Election, ElectionCandidate, ElectionVoteTally } from "../../src/lib/db/types";
import { countPrStv, validateRankedBallots } from "../../src/lib/turn/election/rules/prStv";

const arg = (name: string) =>
  process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3);
let serial = 0;
const id = () => new ObjectId((++serial).toString(16).padStart(24, "0"));
const now = new Date("1993-01-01T00:00:00Z");

async function main() {
  const uri = process.env.SIM_MONGODB_URI;
  const target = arg("target");
  const out = arg("out");
  assert(uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri));
  assert(target && /^ahd_sim_[a-zA-Z0-9_]{1,48}$/.test(target) && out);
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = () => execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  const development = !!dirty();
  assert(!development || process.argv.includes("--development"), "Commit before acceptance");
  Object.assign(process.env, {
    NODE_ENV: "test",
    MONGODB_URI: uri,
    MONGODB_DB: target,
    RAILWAY_SERVICE_NAME: "ranked-election-qualification",
  });
  globalThis.fetch = async () => {
    throw new Error("External fetch disabled in qualification");
  };
  const client = await new MongoClient(uri, { monitorCommands: true, maxPoolSize: 3 }).connect();
  global._mongoClientPromise = Promise.resolve(client);
  let measuring = false,
    commands = 0,
    returnedBson = 0;
  client.on("commandStarted", (event) => {
    assert(event.databaseName === "admin" || event.databaseName.startsWith(target + "_"));
    if (measuring) commands++;
  });
  client.on("commandSucceeded", (event) => {
    if (measuring && event.reply) returnedBson += BSON.calculateObjectSize(event.reply);
  });
  const { resolveOneGeneralElection } =
    await import("../../src/lib/turn/election/generalResolution");
  const { initElectionVoteTally, accumulateVoteTurn } =
    await import("../../src/lib/electionEngine/tallyManagement");
  const { computeSeatEstimates } = await import("../../src/lib/elections/buildPollingData");
  const results: Document[] = [];

  async function fixture(suffix: string, field: string) {
    const name = target + "_" + suffix;
    process.env.MONGODB_DB = name;
    const db = client.db(name);
    assert.equal(
      (await db.listCollections().toArray()).length,
      0,
      "Preserve prior fixture evidence"
    );
    await db.collection("gameState").insertOne({
      _id: "current" as never,
      preset: "1991-default",
      currentYear: 1993,
      startingYear: 1991,
      currentTurn: 96,
      eraSystemEnabled: true,
      isActive: false,
    });
    await db
      .collection("gameConfig")
      .insertOne({ discordWebhookOwnerService: "disabled-qualification" });
    await db.collection("politicalParties").insertMany(
      [1, 2].map((n) => ({
        _id: id(),
        countryId: "IE",
        sequentialId: n,
        name: `Synthetic party ${n}`,
        abbreviation: `P${n}`,
        economicPosition: n === 1 ? -2 : 2,
        socialPosition: 0,
      }))
    );
    const parties = ["1", "2", "2", "1", "2", "1"];
    const actors = parties.map((party, i) => ({
      _id: id(),
      party,
      npp:
        field === "npp_only" ||
        (field === "player_vs_npp" && i > 0) ||
        (field === "mixed_same_party" && i % 2 === 1),
    }));
    for (const actor of actors)
      await db.collection(actor.npp ? "npps" : "characters").insertOne({
        _id: actor._id,
        userId: id(),
        name: `Synthetic ${actor._id}`,
        countryId: "IE",
        party: actor.party,
        state: "DUB",
        currentOffice: null,
        careerHistory: [],
        retiredAt: null,
        policies: { economic: actor.party === "1" ? -2 : 2, social: 0 },
        favorability: 50,
        politicalInfluence: 100,
        nationalInfluence: 100,
      });
    return { db, actors };
  }

  async function race(
    db: Db,
    actors: Awaited<ReturnType<typeof fixture>>["actors"],
    cycle: number
  ) {
    const election: Election = {
      _id: id(),
      countryId: "IE",
      electionType: "dail",
      state: "DUB",
      cycle,
      status: "completed",
      totalSeats: 3,
      startTime: now,
      endTime: now,
      createdAt: now,
      updatedAt: now,
    };
    const candidates: ElectionCandidate[] = actors.map((actor) => ({
      _id: id(),
      electionId: election._id,
      characterId: actor._id,
      ...(actor.npp ? { nppId: actor._id } : {}),
      isNPP: actor.npp,
      characterName: `Synthetic ${actor._id}`,
      party: actor.party,
      status: "active",
      enteredAt: now,
    }));
    await db.collection("elections").insertOne(election);
    await db.collection("electionCandidates").insertMany(candidates);
    const ids = candidates.map((c) => c._id.toString());
    const weights = [30, 25, 18, 14, 8, 5];
    const preferences =
      cycle === 3
        ? [
            [0, 2],
            [1, 4],
            [2, 1],
            [3, 0],
            [4, 1],
            [5, 2],
          ]
        : [
            [0, 3],
            [1, 4],
            [2, 1],
            [3, 0],
            [4, 3],
            [5, 3],
          ];
    const tally: ElectionVoteTally = {
      _id: id(),
      electionId: election._id,
      state: "DUB",
      countingMethod: "pr_stv",
      rankedBallots: preferences.map((ranking, i) => ({
        weight: weights[i],
        preferences: ranking.map((n) => ids[n]),
      })),
      totalVotes: Object.fromEntries(ids.map((candidate, i) => [candidate, weights[i]])),
      candidateNames: Object.fromEntries(
        candidates.map((c) => [c._id.toString(), c.characterName])
      ),
      candidateParties: Object.fromEntries(candidates.map((c) => [c._id.toString(), c.party])),
      turnSnapshots: [],
      finalized: false,
      createdAt: now,
      updatedAt: now,
    };
    await db.collection("electionVoteTallies").insertOne(tally);
    return { election, candidates, tally };
  }

  const snapshot = async (db: Db) =>
    Object.fromEntries(
      await Promise.all(
        [
          "electedOfficials",
          "characters",
          "npps",
          "electionCandidates",
          "notifications",
          "electionVoteTallies",
          "politicianOverrides",
        ].map(async (name) => [name, await db.collection(name).find({}).sort({ _id: 1 }).toArray()])
      )
    );

  try {
    for (const field of ["npp_only", "player_vs_npp", "opposing_players", "mixed_same_party"]) {
      const { db, actors } = await fixture(field, field);
      const cycles: Document[] = [];
      for (let cycle = 1; cycle <= 3; cycle++) {
        const { election, candidates, tally } = await race(db, actors, cycle);
        const expected = countPrStv(
          candidates.map((c) => c._id.toString()),
          3,
          tally.rankedBallots!
        );
        assert.deepEqual(
          computeSeatEstimates(
            "dail",
            3,
            tally,
            new Set(candidates.map((c) => c._id.toString())),
            "IE"
          ),
          expected.seats
        );
        measuring = true;
        commands = 0;
        returnedBson = 0;
        await resolveOneGeneralElection(db, election, tally, 96 + cycle, now);
        measuring = false;
        const performance = { commands, returnedBson };
        const persisted = await db
          .collection<ElectionVoteTally>("electionVoteTallies")
          .findOne({ _id: tally._id });
        assert(persisted?.finalized && persisted.resolutionPath === "pr_stv");
        assert.deepEqual(persisted.prStvResult, expected);
        assert.equal(persisted.resolvedTotalSeats, 3);
        const officials = await db
          .collection("electedOfficials")
          .find({ countryId: "IE", officeType: "dail", state: "DUB" })
          .toArray();
        assert.equal(officials.length, 3);
        const byParty: Record<string, number> = {};
        for (const official of officials) {
          assert.equal(official.seatsHeld, 1);
          byParty[official.party] = (byParty[official.party] ?? 0) + 1;
          const holder = await db
            .collection(official.nppId ? "npps" : "characters")
            .findOne({ _id: official.nppId ?? official.characterId });
          assert(holder?.currentOffice?.type === "dail" && holder.currentOffice.seatsHeld === 1);
        }
        assert.deepEqual(byParty, cycle === 3 ? { "1": 1, "2": 2 } : { "1": 2, "2": 1 });
        const before = await snapshot(db);
        await resolveOneGeneralElection(db, election, persisted, 96 + cycle, now);
        assert.deepEqual(
          await snapshot(db),
          before,
          "Repeated resolution must not alter holders or count receipts"
        );
        cycles.push({
          cycle,
          byParty,
          resolutionPath: persisted.resolutionPath,
          count: expected,
          performance,
        });
      }
      results.push({
        field,
        cycles,
        holdPassed: true,
        transferControlFlipPassed: true,
        repeatPassed: true,
      });
    }

    for (const failure of [
      "missing_ballots",
      "contradictory_ballots",
      "undersized_field",
      "duplicate_holders",
      "empty_ballots",
    ]) {
      const { db, actors } = await fixture(failure, "npp_only");
      const { election, candidates, tally } = await race(db, actors, 1);
      if (failure === "missing_ballots") delete tally.rankedBallots;
      if (failure === "contradictory_ballots") tally.rankedBallots![0].weight++;
      if (failure === "empty_ballots") {
        tally.rankedBallots = [];
        tally.totalVotes = Object.fromEntries(candidates.map((c) => [c._id.toString(), 0]));
      }
      if (failure === "undersized_field")
        await db
          .collection("electionCandidates")
          .updateMany(
            { _id: { $in: candidates.slice(2).map((c) => c._id) } },
            { $set: { status: "withdrawn" } }
          );
      if (failure === "duplicate_holders")
        await db
          .collection("electionCandidates")
          .updateOne(
            { _id: candidates[0]._id },
            { $set: { nppId: actors[1]._id, characterId: actors[1]._id } }
          );
      await db.collection("electionVoteTallies").replaceOne({ _id: tally._id }, tally);
      await db.collection("electedOfficials").insertOne({
        countryId: "IE",
        officeType: "dail",
        state: "DUB",
        nppId: actors[0]._id,
        party: "1",
        seatsHeld: 1,
      });
      const before = await snapshot(db);
      await assert.rejects(resolveOneGeneralElection(db, election, tally, 97, now), /PR-STV/);
      assert.deepEqual(
        await snapshot(db),
        before,
        "Rejected counts must preserve officeholders and tally"
      );
      assert.equal(
        (await db.collection("elections").findOne({ _id: election._id }))?.resolving,
        false
      );
      results.push({ field: failure, refusedBeforeSeating: true, existingHolderPreserved: true });
    }
    for (const exclusion of ["withdrawn", "retired", "deleted"]) {
      const { db, actors } = await fixture(
        exclusion,
        exclusion === "deleted" ? "opposing_players" : "npp_only"
      );
      const { election, candidates, tally } = await race(db, actors, 1);
      if (exclusion === "withdrawn")
        await db
          .collection("electionCandidates")
          .updateOne({ _id: candidates[0]._id }, { $set: { status: "withdrawn" } });
      if (exclusion === "retired")
        await db.collection("npps").updateOne({ _id: actors[0]._id }, { $set: { retiredAt: now } });
      if (exclusion === "deleted")
        await db.collection("characters").deleteOne({ _id: actors[0]._id });
      await resolveOneGeneralElection(db, election, tally, 97, now);
      const persisted = await db
        .collection<ElectionVoteTally>("electionVoteTallies")
        .findOne({ _id: tally._id });
      assert(persisted?.finalized && persisted.resolutionPath === "pr_stv");
      assert.equal(
        persisted.seatsEstimate?.[candidates[3]._id.toString()],
        1,
        "Original votes transfer past an unavailable first choice"
      );
      assert(
        !persisted.resolvedSeatHolders?.some((h) => h.identity.endsWith(actors[0]._id.toString()))
      );
      assert.equal(persisted.resolvedTotalSeats, 3);
      assert.equal(
        persisted.prStvResult?.totalBallots,
        100,
        "Unavailable first preferences remain in the quota's original valid poll"
      );
      results.push({
        field: exclusion,
        originalBallotsPreserved: true,
        transferPassed: true,
        count: persisted.prStvResult,
      });
    }

    {
      const { db, actors } = await fixture("cleanup_retry", "mixed_same_party");
      const { election, candidates, tally } = await race(db, actors, 1);
      const original = db.collection.bind(db);
      let injected = false;
      db.collection = ((name, options) => {
        const collection = original(name, options);
        if (name === "electionCandidates") {
          const update = collection.updateMany.bind(collection);
          collection.updateMany = async (filter, changes, writeOptions) => {
            if (!injected) {
              injected = true;
              throw new Error("Injected STV candidate cleanup failure");
            }
            return update(filter, changes, writeOptions);
          };
        }
        return collection;
      }) as typeof db.collection;
      await assert.rejects(resolveOneGeneralElection(db, election, tally, 97, now), /Injected STV/);
      db.collection = original;
      const finalized = await db
        .collection<ElectionVoteTally>("electionVoteTallies")
        .findOne({ _id: tally._id });
      assert(finalized?.finalized && finalized.prStvResult);
      const officialsBefore = await db
        .collection("electedOfficials")
        .find({})
        .sort({ _id: 1 })
        .toArray();
      await resolveOneGeneralElection(db, election, finalized, 97, now);
      assert.deepEqual(
        await db.collection("electedOfficials").find({}).sort({ _id: 1 }).toArray(),
        officialsBefore
      );
      assert.equal(
        await db
          .collection("electionCandidates")
          .countDocuments({ electionId: election._id, status: "active" }),
        0
      );
      assert.equal(
        (await db.collection("elections").findOne({ _id: election._id }))?.status,
        "resolved"
      );
      assert.deepEqual(
        (await db.collection<ElectionVoteTally>("electionVoteTallies").findOne({ _id: tally._id }))
          ?.prStvResult,
        finalized.prStvResult
      );
      const recovered = await snapshot(db);
      await resolveOneGeneralElection(db, election, finalized, 97, now);
      assert.deepEqual(await snapshot(db), recovered);
      results.push({
        field: "cleanup_retry",
        finalizedBeforeFailure: true,
        holdersNotReseated: true,
        candidatesCleaned: true,
        repeatedRecoveryPassed: true,
        candidates: candidates.length,
      });
    }

    const { db, actors } = await fixture("accumulation", "mixed_same_party");
    await db.collection("states").insertOne({
      _id: "DUB" as never,
      countryId: "IE",
      name: "Synthetic Dublin",
      population: 100_000,
      votingSystem: "proportional",
    });
    await db.collection("demographicCategories").insertOne({
      _id: "ideology" as never,
      name: "Synthetic ideology",
      groups: [
        {
          id: "left",
          name: "Left",
          defaultEconomicLean: -2,
          defaultSocialLean: 0,
          defaultTurnout: 60,
        },
        {
          id: "right",
          name: "Right",
          defaultEconomicLean: 2,
          defaultSocialLean: 0,
          defaultTurnout: 60,
        },
      ],
    });
    await db.collection("stateDemographics").insertOne({
      _id: "DUB" as never,
      countryId: "IE",
      categoryWeights: { ideology: 100 },
      groups: {
        left: { population: 50, turnout: 60, economicLean: -2, socialLean: 0 },
        right: { population: 50, turnout: 60, economicLean: 2, socialLean: 0 },
      },
      lastUpdated: now,
    });
    await db.collection("statePartyOrg").insertMany(
      [1, 2].map((n) => ({
        countryId: "IE",
        stateId: "DUB",
        partyId: String(n),
        organization: 50,
        registration: 50,
      }))
    );
    const actual = await race(db, actors, 1);
    await db.collection("electionVoteTallies").deleteOne({ _id: actual.tally._id });
    const active = {
      ...actual.election,
      status: "active" as const,
      startTurn: 90,
      primaryEndTurn: 90,
      endTurn: 99,
    };
    await db.collection("elections").replaceOne({ _id: active._id }, active);
    await initElectionVoteTally(active._id, actual.candidates, "DUB", undefined, {
      countingMethod: "pr_stv",
    });
    await accumulateVoteTurn(active._id, 96, now);
    const cast = await db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .findOne({ electionId: active._id });
    assert(cast?.rankedBallots?.length && cast.turnSnapshots.length === 1);
    validateRankedBallots(cast.rankedBallots, cast.totalVotes);
    assert.equal(cast.rankedPreferenceModel, "same_party_then_policy_distance_v1");
    const accrued = await snapshot(db);
    await accumulateVoteTurn(active._id, 96, now);
    assert.deepEqual(await snapshot(db), accrued, "Same turn cannot cast ballots twice");
    await assert.rejects(
      initElectionVoteTally(active._id, actual.candidates, "DUB", undefined, {
        countingMethod: "pr_stv",
      }),
      /reinitialize/
    );
    const { accumulateGeneralElectionVotes } = await import("../../src/lib/turn/primaryResolution");
    await accumulateGeneralElectionVotes(now, 97);
    const batched = await db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .findOne({ electionId: active._id });
    assert(batched?.rankedBallots && batched.turnSnapshots.length === 2);
    validateRankedBallots(batched.rankedBallots, batched.totalVotes);
    const afterBatch = await snapshot(db);
    await assert.rejects(
      accumulateVoteTurn(active._id, 98, now, {
        election: active,
        tally: cast,
        candidates: actual.candidates,
      }),
      /lost its tally revision/
    );
    assert.deepEqual(
      await snapshot(db),
      afterBatch,
      "A stale revision cannot overwrite another turn's ballots even at the same timestamp"
    );
    await accumulateGeneralElectionVotes(now, 97);
    assert.deepEqual(await snapshot(db), afterBatch, "Batched turn replay cannot cast twice");
    await db
      .collection("elections")
      .updateOne({ _id: active._id }, { $set: { status: "completed" } });
    await resolveOneGeneralElection(db, { ...active, status: "completed" }, batched, 99, now);
    const resolved = await db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .findOne({ electionId: active._id });
    assert(resolved?.finalized && resolved.resolutionPath === "pr_stv");
    assert.deepEqual(batched.seatsEstimate, resolved.seatsEstimate);
    results.push({
      field: "actual_accumulation",
      originalBallots: Object.values(cast.totalVotes).reduce((a, b) => a + b, 0),
      rankedParcels: cast.rankedBallots.length,
      replayPassed: true,
      initializationGuardPassed: true,
      projectionResolutionPassed: true,
      batchReplayPassed: true,
      staleRevisionRefused: true,
    });
    assert.equal(
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      sourceCommit
    );
    assert(development || !dirty());
    writeFileSync(
      out,
      JSON.stringify(
        {
          sourceCommit,
          development,
          preset: "1991-default",
          fixtureYear: 1993,
          productionTouched: false,
          worldAcceptance: false,
          selectedWorldStvEnabled: false,
          results,
          passed: true,
        },
        null,
        2
      )
    );
    console.log(
      JSON.stringify({
        sourceCommit,
        development,
        passed: true,
        resolutions: 17,
        results: results.length,
      })
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
