/** Controlled actual-response, population-journal and treasury replay in owned disposable Mongo. */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { BSON, MongoClient, ObjectId, type Db, type BulkWriteOptions } from "mongodb";
import { startIsolatedMongod, stopIsolatedMongod } from "@/lib/test-utils/realMongoFixture";
import { submitCrisisDecision } from "@/lib/crises/interactionEngine";
import { runDemographicFlows } from "@/lib/demographics/phase";
import { recoverDemographicFlowsBeforeContext } from "@/lib/demographics/recoverFlows";
import { totalPopulation } from "@/lib/demographics/cohortVector";
import { YUGOSLAVIA_DEF } from "@/lib/livingConflict/defs/yugoslavia";
import { loadRefugeeServiceCosts } from "@/lib/livingConflict/refugeeReception";
import { calculateFederalSpending } from "@/lib/budget/spending";
import { processTreasuryTurn } from "@/lib/turn/treasuryTurn";
import { getMongoClient } from "@/lib/mongodb";
import type { Crisis, CrisisInteraction } from "@/lib/db/types/crisis";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { GameState } from "@/lib/db/types/gameState";

const sourceFiles = [
  "src/lib/livingConflict/rules/refugeeReception.ts",
  "src/lib/livingConflict/refugeeReception.ts",
  "src/lib/crises/interactionEngine.ts",
  "src/lib/demographics/phase.ts",
  "src/lib/demographics/flowJournal.ts",
  "src/lib/budget/spending.ts",
  "src/lib/budget/revenue.ts",
  "src/lib/turn/treasuryTurn.ts",
  "src/lib/livingConflict/defs/yugoslavia.ts",
  "src/lib/livingConflict/globalResponse.ts",
  "src/lib/db/types/crisis.ts",
];

type Boundary = "none" | "vector" | "history" | "response-completion" | "header-completion";

async function main() {
  const owned = await startIsolatedMongod("ahd_refugee_fixture_");
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
  const counter = () => ({ commands, reads, replyBytes });
  const cost = (before: ReturnType<typeof counter>) => ({
    commands: commands - before.commands,
    reads: reads - before.reads,
    replyBsonBytes: replyBytes - before.replyBytes,
  });
  async function seed(host = "AT", displacement = 12, lawIndex?: number) {
    const db = client.db(`refugee_reception_${randomUUID().replaceAll("-", "")}`);
    databases.push(db);
    const interactionId = new ObjectId();
    const crisisId = new ObjectId();
    await db.collection("gameState").insertOne({
      _id: "current",
      worldEpochId: "fixture-world",
      currentTurn: 7,
      startingYear: 1991,
      currentYear: 1991,
      livingConflictsEnabled: true,
      isProcessing: false,
      preset: "1991-default",
    });
    await db.collection("gameConfig").insertOne({ _id: "default", labourSystemMode: "legacy" });
    const male = Array.from({ length: 101 }, (_, age) => (age >= 20 && age < 60 ? 1250 : 0));
    for (const [id, countryId] of [
      ["YU_ORIGIN", "YU"],
      [`${host}_HOST`, host],
    ]) {
      await db
        .collection("states")
        .insertOne({ _id: id, countryId, population: 100_000, gdp: 1000 });
      await db
        .collection("regionDemographics")
        .insertOne({ _id: id, countryId, ages: { male, female: [...male] } });
      await db.collection("macroMetrics").insertOne({
        _id: id,
        population: { birthRate: { value: 50 }, migrationRate: { value: 0 } },
        economic: {
          gdpGrowth: { value: 2.5 },
          potentialGrowth: { value: 2.5 },
          unemploymentRate: { value: 5 },
        },
      });
      await db.collection("stateMetrics").insertOne({ _id: id });
    }
    await db.collection("countryGameStates").insertOne({ _id: host, status: "active" });
    await db.collection("federalBudget").insertOne({
      _id: host,
      countryId: host,
      gdp: 1_000_000_000,
      treasuryBalance: 1_000_000,
      debt: { principal: 0, interestRate: 0 },
      revenue: { total: 0 },
      spending: { byCategory: {}, stateGrants: 0, debtInterest: 0, total: 0 },
      baselineSpendingByCategory: {},
      taxRates: {},
      fiscalYear: 1991,
    });
    await db.collection("livingConflicts").insertOne({
      defKey: "yugoslav_dissolution",
      hasOpened: true,
      status: "active",
      tracks: { displacement },
    });
    if (lawIndex !== undefined)
      await db.collection("enactedLaws").insertOne({
        legislationTypeId: "de_asylum_policy",
        scope: "national",
        countryId: host,
        policyOptionIndex: lawIndex,
        enactedAt: new Date(0),
        budgetCost: 0,
      });
    const authored = YUGOSLAVIA_DEF.phases[0].events[0].response!;
    const node = structuredClone(authored.decisionTrees.neighbor!);
    const crisis: Crisis = {
      _id: crisisId,
      name: "Synthetic Yugoslav reception",
      description: "Controlled fixture",
      scope: "global",
      countryIds: ["YU", host],
      regionIds: [],
      durationTurns: 24,
      effects: [],
      status: "active",
      createdBy: new ObjectId(),
      createdAt: new Date(0),
      resolvedAt: null,
      startTurn: 7,
      endTurn: null,
      wireMessageOnStart: "",
      wireMessageOnEnd: "",
      interactionDefinition: { decisionTree: [node], autoResolveOnExpiry: true },
      globalResponse: {
        conflictKey: "yugoslav_dissolution",
        eventKey: "fixture",
        roleByCountry: { [host]: "neighbor" },
        defaultOptionIdByRole: authored.defaultOptionIdByRole,
        outcomes: authored.outcomes,
        defaultOutcomeId: authored.defaultOutcomeId,
      },
    };
    const interaction: CrisisInteraction = {
      _id: interactionId,
      crisisId,
      decisionTree: [node],
      currentNodeId: node.nodeId,
      collectiveTarget: null,
      collectiveCurrent: 0,
      contributors: [],
      decisionDeadline: null,
      autoResolveOnExpiry: true,
      resolvedAt: null,
      resolutionPath: [],
      resolutionOutcome: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    await db.collection<Crisis>("crises").insertOne(crisis);
    await db.collection<CrisisInteraction>("crisisInteractions").insertOne(interaction);
    return { db, host, interactionId };
  }
  async function snapshot(db: Db) {
    const rows = await db.collection("regionDemographics").find({}).sort({ _id: 1 }).toArray();
    const states = await db.collection("states").find({}).sort({ _id: 1 }).toArray();
    const metrics = await db.collection("macroMetrics").find({}).sort({ _id: 1 }).toArray();
    return {
      vectors: rows.map((row) => ({ id: row._id, ages: row.ages })),
      population: rows.reduce((sum, row) => sum + totalPopulation(row.ages), 0),
      states: states.map((row) => ({
        id: row._id,
        population: row.population,
        voting: row.votingEligiblePopulation,
        working: row.workingAgePopulation,
      })),
      metrics: metrics.map((row) => ({ id: row._id, population: row.population })),
    };
  }
  function interrupted(db: Db, boundary: Boundary): Db {
    let failed = false;
    return new Proxy(db, {
      get(target, property) {
        if (property !== "collection") return Reflect.get(target, property);
        return (name: string) => {
          const collection = db.collection(name);
          return new Proxy(collection, {
            get(original, method) {
              if (method === "bulkWrite")
                return async (
                  operations: Parameters<typeof collection.bulkWrite>[0],
                  options?: BulkWriteOptions
                ) => {
                  const stop =
                    !failed &&
                    ((boundary === "vector" && name === "regionDemographics") ||
                      (boundary === "history" && name === "refugeeReceptionHistory") ||
                      (boundary === "response-completion" && name === "crisisInteractions"));
                  if (stop) {
                    failed = true;
                    await original.bulkWrite(operations.slice(0, 1), options);
                    throw new Error(`Injected ${boundary}`);
                  }
                  return original.bulkWrite(operations, options);
                };
              if (method === "updateOne" && name === "demographicFlowReceipts")
                return async (...args: Parameters<typeof collection.updateOne>) => {
                  if (
                    !failed &&
                    boundary === "header-completion" &&
                    "$set" in args[1] &&
                    args[1].$set?.status === "complete"
                  ) {
                    failed = true;
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
    }) as Db;
  }
  try {
    await client.connect();
    const baseline = await seed();
    await runDemographicFlows(baseline.db, 8, "fixture-world");
    const baselineSnapshot = await snapshot(baseline.db);
    const cases = [];
    let uninterrupted: Awaited<ReturnType<typeof snapshot>> | undefined;
    for (const boundary of [
      "none",
      "vector",
      "history",
      "response-completion",
      "header-completion",
    ] as const) {
      const fixture = await seed();
      await submitCrisisDecision(
        fixture.db,
        fixture.interactionId,
        "receive_refugees",
        new ObjectId(),
        fixture.host,
        ["headOfState"]
      );
      const claim = await fixture.db
        .collection<CrisisInteraction>("crisisInteractions")
        .findOne({ _id: fixture.interactionId });
      if (!claim?.leaderResponses?.[0].refugeeReceptionOrder || !claim.populationOrdersPending)
        throw new Error("Response omitted durable authorization");
      const before = counter();
      if (boundary === "none") await runDemographicFlows(fixture.db, 8, "fixture-world");
      else {
        let injected = false;
        try {
          await runDemographicFlows(interrupted(fixture.db, boundary), 8, "fixture-world");
        } catch (error) {
          if (!(error instanceof Error) || !error.message.startsWith("Injected")) throw error;
          injected = true;
        }
        if (!injected) throw new Error(`Missed failure boundary ${boundary}`);
        const world = await fixture.db
          .collection<GameState>("gameState")
          .findOne({ _id: "current" });
        await recoverDemographicFlowsBeforeContext(
          fixture.db,
          world!,
          new Set(["demographicFlows"])
        );
      }
      const phaseCost = cost(before);
      const after = await snapshot(fixture.db);
      if (Math.abs(after.population - baselineSnapshot.population) > 1e-6)
        throw new Error("Reception created or destroyed residents");
      if (boundary === "none") uninterrupted = after;
      else if (JSON.stringify(after) !== JSON.stringify(uninterrupted))
        throw new Error("Population recovery differs from uninterrupted reception");
      await runDemographicFlows(fixture.db, 8, "fixture-world");
      const history = await fixture.db.collection("refugeeReceptionHistory").find({}).toArray();
      if (history.length !== 1 || !(history[0].movedPeople > 0))
        throw new Error("Reception history missing or duplicated");
      const settled = await fixture.db
        .collection<CrisisInteraction>("crisisInteractions")
        .findOne({ _id: fixture.interactionId });
      if (
        settled?.populationOrdersPending ||
        settled?.leaderResponses?.[0].refugeeReceptionOrder?.status !== "complete"
      )
        throw new Error("Reception response remained pending");
      if (
        JSON.stringify(settled.leaderResponses[0].refugeeReceptionResult?.routes) !==
        JSON.stringify(history[0].routes)
      )
        throw new Error("Player response and diagnostic history disagree");
      let cashPaid = 0;
      if (boundary === "none") {
        process.env.NODE_ENV = "test";
        process.env.MONGODB_URI = owned.uri;
        process.env.MONGODB_DB = fixture.db.databaseName;
        const country = fixture.host as FederalBudget["countryId"];
        for (let turn = 8; turn <= 32; turn++) {
          await fixture.db
            .collection<GameState>("gameState")
            .updateOne(
              { _id: "current" },
              { $set: { currentTurn: turn - 1, isProcessing: true, processingTargetTurn: turn } }
            );
          const budget = await fixture.db
            .collection<FederalBudget>("federalBudget")
            .findOne({ countryId: country });
          const spending = await calculateFederalSpending(
            fixture.db,
            budget!,
            0,
            undefined,
            await loadRefugeeServiceCosts(fixture.db)
          );
          await fixture.db
            .collection<FederalBudget>("federalBudget")
            .updateOne({ countryId: country }, { $set: { spending } });
          await processTreasuryTurn(turn);
          const paid = await fixture.db
            .collection<FederalBudget>("federalBudget")
            .findOne({ countryId: country });
          await processTreasuryTurn(turn);
          const replayed = await fixture.db
            .collection<FederalBudget>("federalBudget")
            .findOne({ countryId: country });
          if (paid?.treasuryBalance !== replayed?.treasuryBalance)
            throw new Error("Treasury replay charged services twice");
          if (turn === 32 && spending.byCategory.refugeeReceptionServices)
            throw new Error("Expired support remained payable");
          cashPaid = 1_000_000 - (paid?.treasuryBalance ?? 0);
        }
        if (!(cashPaid > 0) || Math.abs(cashPaid - history[0].annualServiceCost / 2) > 24)
          throw new Error(
            "Actual treasury cash differs from the 24-turn service obligation beyond rounding"
          );
      }
      cases.push({
        boundary,
        populationMatchesControl: true,
        replayMatchesUninterrupted: true,
        historyEntries: history.length,
        movedPeople: history[0].movedPeople,
        annualServiceCost: history[0].annualServiceCost,
        routes: history[0].routes,
        responseCompleted: true,
        phaseCost,
        ...(boundary === "none"
          ? { cashPaidOver24Turns: cashPaid, treasuryReplayChargedTwice: false }
          : {}),
      });
    }
    const controls = [];
    for (const [label, host, choice, displacement, lawIndex] of [
      ["sealed frontier", "AT", "seal_border", 12, undefined],
      ["no displaced residents", "AT", "receive_refugees", 0, undefined],
      ["expired corridor", "AT", "receive_refugees", 12, undefined],
      ["closed enacted asylum", "DE", "receive_refugees", 12, 6],
      ["open enacted asylum", "DE", "receive_refugees", 12, 0],
    ] as const) {
      const fixture = await seed(host, displacement, lawIndex);
      await submitCrisisDecision(fixture.db, fixture.interactionId, choice, new ObjectId(), host, [
        "headOfState",
      ]);
      await runDemographicFlows(fixture.db, label === "expired corridor" ? 32 : 8, "fixture-world");
      const history = await fixture.db.collection("refugeeReceptionHistory").find({}).toArray();
      const moved = history.reduce((sum, result) => sum + result.movedPeople, 0);
      if (label === "open enacted asylum" ? !(moved > 0) : moved !== 0)
        throw new Error(`Bad conditional flow: ${label}`);
      controls.push({
        label,
        movedPeople: moved,
        serviceAnnualCost: history.reduce((sum, result) => sum + result.annualServiceCost, 0),
      });
    }
    process.stdout.write(
      JSON.stringify(
        {
          baseCommit: "b2fba55e8e7b1aa196a015a9433dadeb055b36f0",
          sourceHashes: Object.fromEntries(
            sourceFiles.map((path) => [
              path,
              createHash("sha256").update(readFileSync(path)).digest("hex"),
            ])
          ),
          scope:
            "Synthetic two-region actual response and phase fixtures, including synthetic DE neighbor authorization; not a world simulation",
          cases,
          controls,
          limitations: [
            "Admission share, law multipliers, initial service rate and support duration are authored assumptions pending world qualification.",
            "No typed casualties, capacity damage, repair or refugee return is qualified here.",
            "Service caseload is an initial-support obligation, not a trace of subsequent individual death or internal movement.",
            "Concurrent world reset and turn writers remain unsupported.",
          ],
        },
        null,
        2
      ) + "\n"
    );
  } finally {
    const cleanup = await Promise.allSettled(databases.map((db) => db.dropDatabase()));
    await client.close();
    if (global._mongoClientPromise) await (await getMongoClient()).close();
    await stopIsolatedMongod(owned);
    if (cleanup.some((result) => result.status === "rejected"))
      throw new Error("Owned fixture database cleanup failed");
  }
}
main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exitCode = 1;
});
