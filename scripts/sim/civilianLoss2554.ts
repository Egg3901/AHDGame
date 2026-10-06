/** Actual authored outcome resolution and frozen civilian stock replay in disposable Mongo. */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { BSON, MongoClient, ObjectId, type Db, type BulkWriteOptions } from "mongodb";
import { startIsolatedMongod, stopIsolatedMongod } from "@/lib/test-utils/realMongoFixture";
import { resolveGlobalResponse } from "@/lib/livingConflict/globalResponse";
import { YUGOSLAVIA_DEF } from "@/lib/livingConflict/defs/yugoslavia";
import { emptyConflictState } from "@/lib/livingConflict/engine";
import { applyTensionEvent, type ColdWarTensionState } from "@/lib/coldwar/tension";
import { runDemographicFlows } from "@/lib/demographics/phase";
import { recoverDemographicFlowsBeforeContext } from "@/lib/demographics/recoverFlows";
import { totalPopulation, type AgeSexVector } from "@/lib/demographics/cohortVector";
import type { GameState } from "@/lib/db/types/gameState";
import type { CrisisInteraction } from "@/lib/db/types/crisis";
import type { ConflictCivilianLossResult } from "@/lib/livingConflict/rules/civilianLoss";

type StringIdFixture = { _id: string } & Record<string, unknown>;
type ResponseFixture = {
  _id: ObjectId;
  leaderResponses: Array<{ countryId: string; responseScores: Record<string, number> }>;
};
type Boundary =
  | "none"
  | "outcome-claim"
  | "trajectory"
  | "tension-before"
  | "tension-after"
  | "vector"
  | "history"
  | "outcome-completion"
  | "header-completion";
const sourceFiles = [
  "src/lib/livingConflict/rules/civilianLoss.ts",
  "src/lib/livingConflict/civilianLoss.ts",
  "src/lib/livingConflict/globalResponse.ts",
  "src/lib/livingConflict/defs/yugoslavia.ts",
  "src/lib/demographics/phase.ts",
  "src/lib/demographics/flowJournal.ts",
  "src/lib/db/types/crisis.ts",
  "src/lib/livingConflict/types.ts",
  "src/lib/coldwar/tension.ts",
  "src/lib/coldwar/rules/tensionEvent.ts",
];

async function main() {
  const owned = await startIsolatedMongod("ahd_civilian_fixture_");
  const client = new MongoClient(owned.uri, { monitorCommands: true });
  const databases: Db[] = [];
  let commands = 0;
  let reads = 0;
  let replyBytes = 0;
  client.on("commandStarted", () => commands++);
  client.on("commandSucceeded", (event) => {
    if (typeof event.reply === "object" && event.reply !== null)
      replyBytes += BSON.calculateObjectSize(event.reply as Record<string, unknown>);
    if (["find", "aggregate", "getMore", "count", "distinct"].includes(event.commandName)) reads++;
  });
  const counters = () => ({ commands, reads, replyBytes });
  const cost = (before: ReturnType<typeof counters>) => ({
    commands: commands - before.commands,
    reads: reads - before.reads,
    replyBsonBytes: replyBytes - before.replyBytes,
  });
  async function seed(escalation = 7, owner = "YU") {
    const db = client.db(`civilian_loss_${randomUUID().replaceAll("-", "")}`);
    databases.push(db);
    const crisisId = new ObjectId();
    const interactionId = new ObjectId();
    await db.collection<StringIdFixture>("gameState").insertOne({
      _id: "current",
      worldEpochId: "fixture-world",
      currentTurn: 7,
      currentYear: 1991,
      startingYear: 1991,
      livingConflictsEnabled: true,
    });
    await db
      .collection<StringIdFixture>("gameConfig")
      .insertOne({ _id: "default", labourSystemMode: "legacy" });
    const male = Array.from({ length: 101 }, (_, age) => (age >= 20 && age < 60 ? 1250 : 0));
    for (const [regionId, countryId] of [
      ["YU_ONE", owner],
      ["YU_TWO", owner],
      ["AT_HOST", "AT"],
    ]) {
      await db
        .collection<StringIdFixture>("states")
        .insertOne({ _id: regionId, countryId, population: 100_000 });
      await db
        .collection<StringIdFixture>("regionDemographics")
        .insertOne({ _id: regionId, countryId, ages: { male, female: [...male] } });
      await db.collection<StringIdFixture>("macroMetrics").insertOne({
        _id: regionId,
        population: { birthRate: { value: 50 }, migrationRate: { value: 0 } },
      });
    }
    await db
      .collection("militaryUnits")
      .insertOne({ countryId: "YU", personnel: 1000, homeRegionId: "YU_ONE" });
    await db.collection("livingConflicts").insertOne({
      ...emptyConflictState("yugoslav_dissolution"),
      hasOpened: true,
      status: "active",
      intensity: 10,
    });
    const authored = YUGOSLAVIA_DEF.phases[0].events[0].response!;
    await db.collection("crises").insertOne({
      _id: crisisId,
      startTurn: 7,
      livingConflictEventId: "fixture-escalation",
      globalResponse: {
        conflictKey: "yugoslav_dissolution",
        eventKey: "fixture",
        roleByCountry: { YU: "belligerent", US: "backer_a", AT: "neighbor" },
        outcomes: authored.outcomes,
        defaultOutcomeId: authored.defaultOutcomeId,
      },
    });
    await db.collection("crisisInteractions").insertOne({
      _id: interactionId,
      crisisId,
      decisionTree: [],
      currentNodeId: "response",
      leaderResponses: [{ countryId: "YU", responseScores: { escalation } }],
    });
    return { db, crisisId, interactionId };
  }
  async function snapshot(db: Db) {
    const ages = await db
      .collection<{ _id: string; ages: AgeSexVector }>("regionDemographics")
      .find({})
      .project<{ _id: string; ages: AgeSexVector }>({ _id: 1, ages: 1 })
      .sort({ _id: 1 })
      .toArray();
    const states = await db
      .collection("states")
      .find({})
      .project({
        _id: 1,
        population: 1,
        votingEligiblePopulation: 1,
        workingAgePopulation: 1,
        militaryServicePopulation: 1,
      })
      .sort({ _id: 1 })
      .toArray();
    const metrics = await db
      .collection("macroMetrics")
      .find({})
      .project({ _id: 1, population: 1 })
      .sort({ _id: 1 })
      .toArray();
    return {
      ages,
      states,
      metrics,
      population: ages.reduce((sum, row) => sum + totalPopulation(row.ages), 0),
    };
  }
  function interrupted(db: Db, boundary: Boundary): Db {
    let fired = false;
    return new Proxy(db, {
      get(target, key) {
        if (key !== "collection") {
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (name: string) => {
          const collection = db.collection(name);
          return new Proxy(collection, {
            get(original, method) {
              if (method === "bulkWrite")
                return async (
                  operations: Parameters<typeof collection.bulkWrite>[0],
                  options?: BulkWriteOptions
                ) => {
                  if (
                    !fired &&
                    ((boundary === "vector" && name === "regionDemographics") ||
                      (boundary === "history" && name === "conflictCivilianLossHistory") ||
                      (boundary === "outcome-completion" && name === "crisisInteractions"))
                  ) {
                    fired = true;
                    await original.bulkWrite(operations.slice(0, 1), options);
                    throw new Error(`Injected ${boundary}`);
                  }
                  return original.bulkWrite(operations, options);
                };
              if (method === "updateOne")
                return async (...args: Parameters<typeof collection.updateOne>) => {
                  const update = args[1];
                  const stop =
                    !fired &&
                    ((boundary === "outcome-claim" &&
                      name === "crisisInteractions" &&
                      "$set" in update &&
                      update.$set?.globalResponseOutcome) ||
                      (boundary === "trajectory" && name === "livingConflicts") ||
                      (["tension-before", "tension-after"].includes(boundary) &&
                        name === "coldWarTension" &&
                        "$set" in update &&
                        update.$set?.value != null) ||
                      (boundary === "header-completion" &&
                        name === "demographicFlowReceipts" &&
                        "$set" in update &&
                        update.$set?.status === "complete"));
                  if (stop) {
                    fired = true;
                    if (!["header-completion", "tension-before"].includes(boundary))
                      await original.updateOne(...args);
                    throw new Error(`Injected ${boundary}`);
                  }
                  return original.updateOne(...args);
                };
              const value = Reflect.get(original, method);
              return typeof value === "function" ? value.bind(original) : value;
            },
          });
        };
      },
    });
  }
  try {
    await client.connect();
    if (global._mongoClientPromise)
      throw new Error("Fixture requires its own empty Mongo client slot");
    global._mongoClientPromise = Promise.resolve(client);
    Object.assign(process.env, { NODE_ENV: "test", MONGODB_URI: owned.uri });
    const control = await seed(0);
    process.env.MONGODB_DB = control.db.databaseName;
    await resolveGlobalResponse(control.db, control.crisisId);
    await runDemographicFlows(control.db, 8);
    const baseline = await snapshot(control.db);
    const cases = [];
    let uninterrupted: Awaited<ReturnType<typeof snapshot>> | undefined;
    for (const boundary of [
      "none",
      "outcome-claim",
      "trajectory",
      "tension-before",
      "tension-after",
      "vector",
      "history",
      "outcome-completion",
      "header-completion",
    ] as const) {
      const fixture = await seed();
      process.env.MONGODB_DB = fixture.db.databaseName;
      const wrapped = interrupted(fixture.db, boundary);
      const before = counters();
      if (["outcome-claim", "trajectory", "tension-before", "tension-after"].includes(boundary)) {
        try {
          await resolveGlobalResponse(wrapped, fixture.crisisId);
          throw new Error("Injection did not fire");
        } catch (error) {
          if (!(error instanceof Error) || error.message !== `Injected ${boundary}`) throw error;
        }
      }
      await resolveGlobalResponse(fixture.db, fixture.crisisId);
      const firstTrajectory = await fixture.db
        .collection("livingConflicts")
        .findOne({ defKey: "yugoslav_dissolution" });
      await resolveGlobalResponse(fixture.db, fixture.crisisId);
      const replayTrajectory = await fixture.db
        .collection("livingConflicts")
        .findOne({ defKey: "yugoslav_dissolution" });
      const tension = await fixture.db
        .collection<ColdWarTensionState & { _id: string }>("coldWarTension")
        .findOne({ _id: "current" });
      if (tension?.value !== 20 || tension.events.length !== 1)
        throw new Error("Tension was omitted or applied twice");
      if (
        firstTrajectory?.intensity !== 25 ||
        JSON.stringify(firstTrajectory?.tracks) !== JSON.stringify(replayTrajectory?.tracks) ||
        JSON.stringify(firstTrajectory?.campaign) !== JSON.stringify(replayTrajectory?.campaign)
      )
        throw new Error("Trajectory was skipped or repeated");
      if (["vector", "history", "outcome-completion", "header-completion"].includes(boundary)) {
        try {
          await runDemographicFlows(wrapped, 8);
          throw new Error("Injection did not fire");
        } catch (error) {
          if (!(error instanceof Error) || error.message !== `Injected ${boundary}`) throw error;
        }
        const world = await fixture.db
          .collection<GameState>("gameState")
          .findOne({ _id: "current" });
        await recoverDemographicFlowsBeforeContext(
          fixture.db,
          world!,
          new Set(["demographicFlows"])
        );
      } else await runDemographicFlows(fixture.db, 8);
      const executionCost = cost(before);
      const actual = await snapshot(fixture.db);
      if (!uninterrupted) uninterrupted = actual;
      if (JSON.stringify(actual) !== JSON.stringify(uninterrupted))
        throw new Error(`Recovery diverged for ${boundary}`);
      const history = await fixture.db
        .collection<ConflictCivilianLossResult>("conflictCivilianLossHistory")
        .find({})
        .toArray();
      if (
        history.length !== 1 ||
        Math.abs(history[0].deaths - 10) > 1e-7 ||
        Math.abs(baseline.population - actual.population - 10) > 1e-7
      )
        throw new Error("Actual population did not match the one recorded civilian loss");
      const replayBefore = await snapshot(fixture.db);
      await runDemographicFlows(fixture.db, 8);
      if (JSON.stringify(await snapshot(fixture.db)) !== JSON.stringify(replayBefore))
        throw new Error("Population replay removed residents again");
      const completed = await fixture.db
        .collection<CrisisInteraction>("crisisInteractions")
        .findOne({ _id: fixture.interactionId });
      if (
        completed?.civilianLossPending ||
        completed?.globalResponseOutcome?.civilianLossOrder?.status !== "complete" ||
        completed?.globalResponseOutcome?.civilianLossResult?.deaths !== history[0].deaths
      )
        throw new Error("Outcome completion disagrees with history");
      const unit = await fixture.db.collection("militaryUnits").findOne({ countryId: "YU" });
      if (unit?.personnel !== 1000) throw new Error("Civilian loss debited military personnel");
      cases.push({
        boundary,
        deaths: history[0].deaths,
        regions: history[0].regions,
        populationMatchesRecordedLoss: true,
        replayMatchesUninterrupted: true,
        historyEntries: 1,
        militaryPersonnel: unit.personnel,
        trajectoryAppliedOnce: true,
        tensionValue: tension.value,
        tensionEvents: tension.events.length,
        executionCost,
      });
    }
    const delayedReplay = await seed();
    process.env.MONGODB_DB = delayedReplay.db.databaseName;
    await resolveGlobalResponse(delayedReplay.db, delayedReplay.crisisId);
    const laterId = new ObjectId();
    const originalCrisis = await delayedReplay.db
      .collection("crises")
      .findOne({ _id: delayedReplay.crisisId });
    await delayedReplay.db.collection("crises").insertOne({
      ...originalCrisis,
      _id: laterId,
      livingConflictEventId: "fixture-later-negotiation",
    });
    await delayedReplay.db.collection("crisisInteractions").insertOne({
      crisisId: laterId,
      decisionTree: [],
      leaderResponses: [{ countryId: "US", responseScores: { mediation: 8, restraint: 4 } }],
    });
    await resolveGlobalResponse(delayedReplay.db, laterId);
    for (let turn = 8; turn <= 32; turn++)
      await applyTensionEvent(delayedReplay.db, turn, "decay", "Synthetic neutral event", 0);
    const laterTension = await delayedReplay.db
      .collection<ColdWarTensionState & { _id: string }>("coldWarTension")
      .findOne({ _id: "current" });
    const laterTrajectory = await delayedReplay.db
      .collection("livingConflicts")
      .findOne({ defKey: "yugoslav_dissolution" });
    await resolveGlobalResponse(delayedReplay.db, delayedReplay.crisisId);
    const oldReplay = await delayedReplay.db
      .collection("livingConflicts")
      .findOne({ defKey: "yugoslav_dissolution" });
    const oldTensionReplay = await delayedReplay.db
      .collection<ColdWarTensionState & { _id: string }>("coldWarTension")
      .findOne({ _id: "current" });
    if (
      JSON.stringify(laterTension) !== JSON.stringify(oldTensionReplay) ||
      laterTension?.events.length !== 24
    )
      throw new Error("Tension replay fence was lost after visible history truncation");
    if (JSON.stringify(laterTrajectory) !== JSON.stringify(oldReplay))
      throw new Error("An older outcome replayed after a later outcome");
    const race = await seed();
    process.env.MONGODB_DB = race.db.databaseName;
    let appended = false;
    const raceDb = new Proxy(race.db, {
      get(target, key) {
        if (key !== "collection") {
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (name: string) => {
          const collection = target.collection<ResponseFixture>(name);
          if (name !== "crisisInteractions") return collection;
          return new Proxy(collection, {
            get(original, method) {
              if (method === "updateOne")
                return async (...args: Parameters<typeof collection.updateOne>) => {
                  if (!appended) {
                    appended = true;
                    await original.updateOne(
                      { _id: race.interactionId },
                      {
                        $push: {
                          leaderResponses: {
                            countryId: "US",
                            responseScores: { mediation: 8, restraint: 4 },
                          },
                        },
                      }
                    );
                  }
                  return original.updateOne(...args);
                };
              const value = Reflect.get(original, method);
              return typeof value === "function" ? value.bind(original) : value;
            },
          });
        };
      },
    });
    try {
      await resolveGlobalResponse(raceDb, race.crisisId);
      throw new Error("Stale resolution unexpectedly claimed");
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("retry from current responses"))
        throw error;
    }
    const retallied = await resolveGlobalResponse(race.db, race.crisisId);
    const preserved = await race.db
      .collection<CrisisInteraction>("crisisInteractions")
      .findOne({ _id: race.interactionId });
    if (
      retallied?.outcomeId !== "negotiated_restructuring" ||
      retallied.civilianLossOrder ||
      preserved?.leaderResponses?.length !== 2
    )
      throw new Error("Concurrent response was lost or ignored");
    const successor = await seed(7, "HR");
    process.env.MONGODB_DB = successor.db.databaseName;
    await resolveGlobalResponse(successor.db, successor.crisisId);
    await runDemographicFlows(successor.db, 8);
    const successorLoss = await successor.db
      .collection<ConflictCivilianLossResult>("conflictCivilianLossHistory")
      .findOne({});
    if (successorLoss?.deaths !== 0 || successorLoss.reason !== "no-sovereign-region")
      throw new Error("Successor inherited unapproved losses");
    console.log(
      JSON.stringify(
        {
          sourceHashes: Object.fromEntries(
            sourceFiles.map((path) => [
              path,
              createHash("sha256").update(readFileSync(path)).digest("hex"),
            ])
          ),
          model:
            "Three synthetic regions; actual Yugoslav outcome conditions, resolution, demographics and recovery",
          baselinePopulation: baseline.population,
          cases,
          concurrentResponsePreservedAndRetallied: true,
          olderOutcomeReplayAfterLaterOutcomeNeutral: true,
          tensionReplayNeutralAfterVisibleHistoryTruncation: true,
          successorCivilianDeaths: 0,
          assumptions: {
            residentPopulationShare: 0.00005,
            profile: "Proportional available civilian age/sex cohorts",
          },
          limitations: [
            "Gameplay quantities are uncalibrated assumptions, not historical estimates.",
            "Military unit deaths already belong to battle settlement; no new deployment/home-cohort attribution is modeled.",
            "No productive-capacity impairment, funded reconstruction or source-pinned whole-world qualification is established.",
            "Trajectory retry covers Yugoslav campaign/track deltas; other post-claim side effects and final wire delivery are not a generic outcome outbox.",
            "Costs include first per-Db index setup and synthetic resolution/replays, not full-world performance.",
          ],
        },
        null,
        2
      )
    );
  } finally {
    const cleanup = await Promise.allSettled(databases.map((db) => db.dropDatabase()));
    global._mongoClientPromise = undefined;
    await client.close();
    await stopIsolatedMongod(owned);
    const failure = cleanup.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
