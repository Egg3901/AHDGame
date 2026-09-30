/** Deterministic presidential fixtures through the real resolver and Mongo writes. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { MongoClient, ObjectId, type Db, type Document } from "mongodb";
import type { Election, ElectionCandidate, ElectionVoteTally } from "../../src/lib/db/types";
import type { ElectionResultSnapshot } from "../../src/lib/db/types/electionResultSnapshot";
import { resolveOneGeneralElection } from "../../src/lib/turn/election/generalResolution";
import { resolvePresidentElection } from "../../src/lib/turn/election/presidentResolution";
import { loadApportionment } from "../../src/lib/elections/apportionment";
import { allocateElectoralVotes } from "../../src/lib/turn/electionCalculations";
import { snapshotParliamentSeats } from "../../src/lib/turn/parliamentSeatsSnapshot";
import {
  qualifyPresidentialRace,
  presidentialPersonTurnover,
  type PresidentialOfficeSnapshot,
} from "./presidentialQualification";

const arg = (name: string) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
let fixtureId = 0;
const nextId = () => new ObjectId((++fixtureId).toString(16).padStart(24, "0"));
const cases = [
  { name: "npp_only_flip", priorNpp: true, winnerNpp: true, loserNpp: true },
  { name: "player_beats_npp", priorNpp: true, winnerNpp: false, loserNpp: true },
  { name: "npp_beats_player", priorNpp: false, winnerNpp: true, loserNpp: false },
  { name: "opposing_players", priorNpp: false, winnerNpp: false, loserNpp: false },
  { name: "mixed_same_party", priorNpp: false, winnerNpp: false, loserNpp: true, extra: true },
  { name: "player_incumbent_hold", priorNpp: false, winnerNpp: false, loserNpp: true, hold: true },
  { name: "npp_incumbent_hold", priorNpp: true, winnerNpp: true, loserNpp: false, hold: true },
  { name: "contingent", priorNpp: false, winnerNpp: false, loserNpp: false, contingent: true },
  { name: "seating_failure_retry", priorNpp: false, winnerNpp: false, loserNpp: true, fault: true },
  {
    name: "tenure_ack_retry",
    priorNpp: false,
    winnerNpp: false,
    loserNpp: true,
    ledgerFault: true,
  },
];

async function resolveFixture(db: Db, election: Election, tally: ElectionVoteTally, now: Date) {
  return process.argv.includes("--general-dispatch")
    ? (await resolveOneGeneralElection(db, election, tally, 96, now)).resolved
    : resolvePresidentElection(db, election, tally, now);
}

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
    RAILWAY_SERVICE_NAME: "presidential-qualification",
  });
  // Qualification never sends requests to external services or player channels.
  globalThis.fetch = async () => {
    throw new Error("External fetch disabled in presidential qualification");
  };
  const client = await new MongoClient(uri).connect();
  global._mongoClientPromise = Promise.resolve(client);
  const db = client.db(target),
    results: Document[] = [];
  try {
    assert.equal((await db.listCollections().toArray()).length, 0, "Preserve prior evidence");
    for (const preset of ["1991-default", "2027-default"])
      for (const scenario of cases) {
        for (const row of await db.listCollections().toArray())
          await db.collection(row.name).deleteMany({});
        const year = Number(preset.slice(0, 4)),
          now = new Date(`${year}-11-01T00:00:00Z`);
        await db.collection("gameState").insertOne({
          _id: "current" as never,
          preset,
          currentYear: year,
          currentTurn: 96,
          eraSystemEnabled: true,
          presidentialTenureByCountry: { US: { party: "1", consecutiveTerms: 2 } },
        });
        await db
          .collection("gameConfig")
          .insertOne({ discordWebhookOwnerService: "disabled-qualification" });
        const prior = nextId(),
          winner = scenario.hold ? prior : nextId(),
          loser = nextId(),
          vp = nextId(),
          minister = nextId(),
          spare = nextId();
        const winnerParty = scenario.hold ? "1" : "2",
          loserParty = scenario.hold ? "2" : "1";
        async function actor(
          id: ObjectId,
          npp: boolean,
          party: string,
          name: string,
          office: Document | null = null
        ) {
          await db.collection(npp ? "npps" : "characters").insertOne({
            _id: id,
            name,
            countryId: "US",
            party,
            currentOffice: office,
            careerHistory: [],
            executiveTermsServed: { US: id.equals(prior) ? 2 : 0 },
            politicalInfluence: id.equals(vp) ? 100 : 50,
            retiredAt: null,
            policies: { economic: party === winnerParty ? 50 : -50, social: 0 },
          });
        }
        await actor(prior, scenario.priorNpp, "1", "Synthetic incumbent", { type: "president" });
        if (!scenario.hold)
          await actor(winner, scenario.winnerNpp, winnerParty, "Synthetic winner", {
            type: "senator",
            state: "CA",
          });
        await actor(loser, scenario.loserNpp, loserParty, "Synthetic challenger");
        await actor(vp, scenario.winnerNpp, winnerParty, "Synthetic vice president", {
          type: "senator",
          state: "TX",
        });
        await actor(minister, false, "1", "Synthetic secretary", { type: "cabinetSecretary" });
        if (scenario.extra)
          await actor(spare, true, winnerParty, "Synthetic same-party challenger");
        await db
          .collection("cabinetMembers")
          .insertOne({ positionId: "secretary_of_state", countryId: "US", characterId: minister });
        await db.collection("electedOfficials").insertOne({
          countryId: "US",
          officeType: "president",
          characterId: scenario.priorNpp ? null : prior,
          nppId: scenario.priorNpp ? prior : null,
          isNPP: scenario.priorNpp,
          party: "1",
        });
        for (const [id, state, npp] of [
          [winner, "CA", scenario.winnerNpp],
          [vp, "TX", scenario.winnerNpp],
        ] as const) {
          if (scenario.hold && id.equals(winner)) continue;
          await db.collection("electedOfficials").insertOne({
            countryId: "US",
            officeType: "senator",
            state,
            characterId: npp ? null : id,
            nppId: npp ? id : null,
            party: winnerParty,
            isNPP: npp,
          });
        }
        await db.collection("politicalParties").insertMany(
          [1, 2, 3].map((sequentialId) => ({
            countryId: "US",
            sequentialId,
            name: `Synthetic party ${sequentialId}`,
            economicPosition: sequentialId === Number(winnerParty) ? 50 : -50,
            socialPosition: 0,
          }))
        );
        const election = {
          _id: nextId(),
          countryId: "US",
          electionType: "president",
          electionYear: year,
          status: "completed",
          cycle: 1,
          startTurn: 90,
          endTurn: 96,
          createdAt: now,
          updatedAt: now,
        } as Election;
        await db.collection<Election>("elections").insertOne(election);
        const identities = [
          { id: winner, npp: scenario.winnerNpp, party: winnerParty },
          { id: loser, npp: scenario.loserNpp, party: loserParty },
        ];
        if (scenario.extra || scenario.contingent) {
          if (!scenario.extra) await actor(spare, true, "3", "Synthetic third candidate");
          identities.push({ id: spare, npp: true, party: scenario.extra ? winnerParty : "3" });
        }
        const candidates = identities.map((identity, index) => ({
          _id: nextId(),
          electionId: election._id,
          countryId: "US",
          characterId: identity.npp ? undefined : identity.id,
          nppId: identity.npp ? identity.id : undefined,
          characterName: `Synthetic candidate ${index}`,
          party: identity.party,
          isNPP: identity.npp,
          status: "active",
          enteredAt: now,
          runningMateId: index === 0 && !scenario.winnerNpp ? vp : undefined,
          policies: { economic: index === 0 ? 50 : -50, social: 0 },
        })) as ElectionCandidate[];
        await db.collection<ElectionCandidate>("electionCandidates").insertMany(candidates);
        const apportionment = await loadApportionment(db, preset, year);
        const totalVotesByUnit: Record<string, Record<string, number>> = {},
          totalVotes: Record<string, number> = Object.fromEntries(
            candidates.map((candidate) => [candidate._id.toString(), 0])
          );
        const allocated = [0, 0, 0];
        for (const unit of apportionment.electoralVoteUnits) {
          const top = scenario.contingent ? allocated.indexOf(Math.min(...allocated)) : 0;
          allocated[top] += unit.ev;
          const votes = Object.fromEntries(
            candidates.map((candidate, index) => [
              candidate._id.toString(),
              index === top ? 600 : 200,
            ])
          );
          totalVotesByUnit[unit.unitId] = votes;
          if (!unit.derivesFromDistricts)
            for (const [id, count] of Object.entries(votes)) totalVotes[id] += count;
        }
        const tally = {
          _id: nextId(),
          electionId: election._id,
          totalVotesByUnit,
          totalVotes,
          candidateNames: Object.fromEntries(
            candidates.map((candidate) => [candidate._id.toString(), candidate.characterName])
          ),
          finalized: false,
        } as ElectionVoteTally;
        if (scenario.contingent) {
          // Explicit deterministic legislative fixture: 50 House delegations and
          // 100 senators prefer the first candidate. The ballot engine still decides.
          tally.contingentChamberSnapshot = {
            capturedAt: now,
            houseDelegations: Object.keys(apportionment.houseSeats)
              .filter((state) => state !== "DC")
              .map((stateId) => ({
                stateId,
                voters: [
                  {
                    id: nextId().toString(),
                    party: winnerParty,
                    economic: 50,
                    social: 0,
                    weight: 1,
                  },
                ],
              })),
            senators: Array.from({ length: 100 }, () => ({
              id: nextId().toString(),
              party: winnerParty,
              economic: 50,
              social: 0,
              weight: 1,
            })),
          };
        }
        await db.collection<ElectionVoteTally>("electionVoteTallies").insertOne(tally);
        let faultInjected = false;
        const wrapped = new Proxy(db, {
          get(object, property) {
            if (property !== "collection") {
              const value = Reflect.get(object, property);
              return typeof value === "function" ? value.bind(object) : value;
            }
            return (name: string) => {
              const collection = object.collection(name);
              if (
                !(scenario.fault && name === "electedOfficials") &&
                !(scenario.ledgerFault && name === "gameState")
              )
                return collection;
              return new Proxy(collection, {
                get(col, key) {
                  if (key !== "updateOne") {
                    const value = Reflect.get(col, key);
                    return typeof value === "function" ? value.bind(col) : value;
                  }
                  return async (...args: Parameters<typeof col.updateOne>) => {
                    if (
                      scenario.fault &&
                      !faultInjected &&
                      args[0].officeType === "vicePresident"
                    ) {
                      faultInjected = true;
                      throw new Error("Injected interruption after president term recorded");
                    }
                    const result = await col.updateOne(...args);
                    if (
                      scenario.ledgerFault &&
                      !faultInjected &&
                      !Array.isArray(args[1]) &&
                      Object.keys(args[1].$set ?? {}).some((key) =>
                        key.startsWith("presidentialTenureByCountry.")
                      )
                    ) {
                      faultInjected = true;
                      throw new Error("Injected lost acknowledgment after durable tenure receipt");
                    }
                    return result;
                  };
                },
              });
            };
          },
        }) as Db;
        await snapshotParliamentSeats(db, 95);
        const firstResult = await resolveFixture(wrapped, election, tally, now);
        if (scenario.fault || scenario.ledgerFault) {
          assert.equal(firstResult, false);
          assert(faultInjected);
          const pending = await db
            .collection<ElectionVoteTally>("electionVoteTallies")
            .findOne({ electionId: election._id });
          assert(pending?.executiveSeatingPending);
          assert(await resolveFixture(db, election, pending, new Date(now.getTime() + 60000)));
        } else assert(firstResult);
        const finalTally = await db
          .collection<ElectionVoteTally>("electionVoteTallies")
          .findOne({ electionId: election._id });
        assert(finalTally);
        assert.equal(finalTally.executiveSeatingPending, false);
        const snapshot = await db
          .collection<ElectionResultSnapshot>("electionResultSnapshots")
          .findOne({ electionId: election._id });
        assert(snapshot, "Actual election result capture required");
        const qualification = qualifyPresidentialRace(
          election._id.toString(),
          snapshot,
          finalTally
        );
        assert.deepEqual(qualification.reconciliation, []);
        assert.equal(qualification.winnerId, candidates[0]._id.toString());
        assert.deepEqual(
          finalTally.electoralVotesByCandidate,
          allocateElectoralVotes(totalVotesByUnit, apportionment.electoralVoteUnits)
        );
        assert.equal(qualification.contingent, !!scenario.contingent);
        for (const [id, type, npp] of [
          [winner, "president", scenario.winnerNpp],
          [vp, "vicePresident", scenario.winnerNpp],
        ] as const) {
          const office = await db
            .collection("electedOfficials")
            .findOne({ countryId: "US", officeType: type });
          assert(
            (npp ? office?.nppId : office?.characterId)?.equals(id),
            `${scenario.name}: ${type} holder`
          );
          const person = await db.collection(npp ? "npps" : "characters").findOne({ _id: id });
          assert.equal(person?.currentOffice?.type, type);
          assert.equal(
            await db.collection("electedOfficials").countDocuments({
              officeType: { $nin: ["president", "vicePresident"] },
              [npp ? "nppId" : "characterId"]: id,
            }),
            0
          );
          if (!npp)
            assert.equal(
              person?.careerHistory.filter(
                (entry: Document) => entry.electionId === election._id.toString()
              ).length,
              1
            );
          if (!npp && type === "president")
            assert.equal(person?.executiveTermsServed.US, scenario.hold ? 3 : 1);
        }
        assert.equal(await db.collection("cabinetMembers").countDocuments(), scenario.hold ? 1 : 0);
        const gs = await db.collection("gameState").findOne({ _id: "current" as never });
        assert.equal(gs?.presidentialTenureByCountry.US.consecutiveTerms, scenario.hold ? 3 : 1);
        await snapshotParliamentSeats(db, 96);
        const history = await db
          .collection<PresidentialOfficeSnapshot>("parliamentSeatsHistory")
          .find({ officeType: "president" })
          .sort({ turn: 1 })
          .toArray();
        const personHistory = presidentialPersonTurnover(history);
        assert.equal(personHistory.personTurnover, scenario.hold ? 0 : 1);
        assert.equal(personHistory.unknownTurns, 0);
        assert.equal(history[0].party, "1");
        assert.equal(history[1].party, winnerParty);
        const beforeRetry = JSON.stringify(
          await db.collection("characters").find({}).sort({ _id: 1 }).toArray()
        );
        assert(await resolveFixture(db, election, finalTally, new Date(now.getTime() + 120000)));
        assert.equal(
          JSON.stringify(await db.collection("characters").find({}).sort({ _id: 1 }).toArray()),
          beforeRetry
        );
        results.push({
          preset,
          scenario: scenario.name,
          qualification,
          personHistory,
          incumbentHold: !!scenario.hold,
          featureManifest: {
            eraSystemEnabled: true,
            currentYear: year,
            currentTurn: 96,
            voteSource: "controlled-per-unit-fixture",
            apportionmentSource: "preset-election-year",
            telemetryVersion: 2,
          },
          partyAlternations: Number(history[0].party !== history[1].party),
          partyTerms: gs?.presidentialTenureByCountry.US.consecutiveTerms,
          faultInjected,
          sourceCommit,
        });
        console.log(
          JSON.stringify({
            preset,
            scenario: scenario.name,
            status: "passed",
            mode: finalTally.resolutionMode,
          })
        );
      }
    assert.equal(!!dirty(), development);
    assert.equal(
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      sourceCommit
    );
    writeFileSync(
      out,
      JSON.stringify(
        {
          sourceCommit,
          development,
          generalDispatcher: process.argv.includes("--general-dispatch"),
          outboundRequests: 0,
          results,
        },
        null,
        2
      )
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
