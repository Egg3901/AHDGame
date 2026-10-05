/**
 * Isolated real-Mongo replay checks for the demographic flow phase and its receipts.
 * Synthetic regions exercise interrupted publication, target writes and completion.
 */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { BSON, MongoClient, type Db, type BulkWriteOptions } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { runDemographicFlows } from "@/lib/demographics/phase";
import { recoverDemographicFlowsBeforeContext } from "@/lib/demographics/recoverFlows";

const url = process.argv[process.argv.indexOf("--mongo-url") + 1];
if (!process.argv.includes("--mongo-url") || !url)
  throw new Error("Supply --mongo-url for a disposable local Mongo instance");
const parsed = new URL(url);
if (
  parsed.protocol !== "mongodb:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
  parsed.username ||
  parsed.password
) {
  throw new Error("The replay fixture requires an unauthenticated loopback Mongo instance");
}
const client = new MongoClient(url, { monitorCommands: true });
let targetWriteCommands = 0;
let commandCount = 0;
let replyBytes = 0;
let returnedDocuments = 0;
let readCommands = 0;
client.on("commandStarted", (event) => {
  commandCount++;
  const target = event.command.update;
  if (["regionDemographics", "states", "macroMetrics"].includes(target)) targetWriteCommands++;
});
client.on("commandSucceeded", (event) => {
  if (typeof event.reply !== "object" || event.reply === null) return;
  const reply = event.reply as Record<string, unknown>;
  replyBytes += BSON.calculateObjectSize(reply);
  const cursor = reply.cursor as { firstBatch?: unknown[]; nextBatch?: unknown[] } | undefined;
  returnedDocuments += cursor?.firstBatch?.length ?? cursor?.nextBatch?.length ?? 0;
  if (["find", "aggregate", "getMore", "count", "distinct"].includes(event.commandName))
    readCommands++;
});

function counters() {
  return { commandCount, replyBytes, returnedDocuments, readCommands };
}
function profile(before: ReturnType<typeof counters>, start: number) {
  return {
    milliseconds: performance.now() - start,
    commands: commandCount - before.commandCount,
    readCommands: readCommands - before.readCommands,
    replyBsonBytes: replyBytes - before.replyBytes,
    returnedDocuments: returnedDocuments - before.returnedDocuments,
  };
}
const databases: Db[] = [];

async function seedFixture(): Promise<Db> {
  const db = client.db(`demographic_replay_${randomUUID().replaceAll("-", "")}`);
  databases.push(db);
  await db.collection("gameState").insertOne({
    _id: "current",
    worldEpochId: "fixture-world",
    currentTurn: 7,
    startingYear: 1991,
    currentYear: 1991,
  } as never);
  await db
    .collection("gameConfig")
    .insertOne({ _id: "default", labourSystemMode: "legacy" } as never);
  for (const regionId of ["CA", "TX"]) {
    const male = Array<number>(101).fill(0);
    const female = Array<number>(101).fill(0);
    for (let age = 20; age < 60; age++) male[age] = female[age] = 1250;
    await db
      .collection("regionDemographics")
      .insertOne({ _id: regionId, countryId: "US", ages: { male, female } } as never);
    await db
      .collection("states")
      .insertOne({ _id: regionId, countryId: "US", population: 100_000 } as never);
    await db.collection("macroMetrics").insertOne({
      _id: regionId,
      population: { birthRate: { value: 50 }, migrationRate: { value: 0 } },
    } as never);
  }
  return db;
}

async function snapshot(db: Db) {
  const ages = await db
    .collection("regionDemographics")
    .find({})
    .project({ _id: 1, ages: 1 })
    .sort({ _id: 1 })
    .toArray();
  const totals = await db
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
  return { ages, totals, metrics };
}

function interrupt(db: Db, collectionName: string, method: string): Db {
  let fired = false;
  return new Proxy(db, {
    get(target, key) {
      if (key !== "collection") {
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (name: string) => {
        const collection = target.collection(name);
        return new Proxy(collection, {
          get(receiver, property) {
            const value = Reflect.get(receiver, property);
            if (name === collectionName && property === method) {
              return async (...args: unknown[]) => {
                if (!fired) {
                  fired = true;
                  if (method === "insertMany")
                    await receiver.insertMany([args[0] instanceof Array ? args[0][0] : {}]);
                  if (method === "bulkWrite" && args[0] instanceof Array)
                    await receiver.bulkWrite([args[0][0]], args[1] as BulkWriteOptions | undefined);
                  throw new Error("controlled interruption");
                }
                return value.apply(receiver, args);
              };
            }
            return typeof value === "function" ? value.bind(receiver) : value;
          },
        });
      };
    },
  });
}

async function main() {
  try {
    await client.connect();
    const control = await seedFixture();
    const started = performance.now();
    const beforeCommands = counters();
    await runDemographicFlows(control, 8, "fixture-world");
    const firstPass = profile(beforeCommands, started);
    const expected = JSON.stringify(await snapshot(control));
    const baselinePath = process.argv.includes("--baseline-phase")
      ? process.argv[process.argv.indexOf("--baseline-phase") + 1]
      : undefined;
    let baselineFirstPass: ReturnType<typeof profile> | null = null;
    if (baselinePath) {
      const baselineModule = await import(pathToFileURL(baselinePath).href);
      const db = await seedFixture();
      const before = counters();
      const start = performance.now();
      await baselineModule.runDemographicFlows(db, 8);
      baselineFirstPass = profile(before, start);
      if (JSON.stringify(await snapshot(db)) !== expected)
        throw new Error("Uninterrupted candidate differs from baseline population math");
    }
    const cases = [];
    for (const [collection, method] of [
      ["demographicFlowProjections", "insertMany"],
      ["regionDemographics", "bulkWrite"],
      ["states", "bulkWrite"],
      ["macroMetrics", "bulkWrite"],
      ["demographicFlowReceipts", "updateOne"],
    ]) {
      const db = await seedFixture();
      try {
        await runDemographicFlows(interrupt(db, collection, method), 8, "fixture-world");
        throw new Error("Interruption did not fire");
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "controlled interruption") throw error;
      }
      const state = await db.collection<GameState>("gameState").findOne({ _id: "current" });
      if (!state) throw new Error("Fixture game state disappeared");
      const applied = new Set(["demographicFlows", "metricEngine"]);
      await recoverDemographicFlowsBeforeContext(db, state, applied);
      const reranUnpublished = !applied.has("demographicFlows");
      if (reranUnpublished) await runDemographicFlows(db, 8, "fixture-world");
      if (JSON.stringify(await snapshot(db)) !== expected)
        throw new Error(`Recovery diverged after ${collection}/${method}`);
      const beforeReplayWrites = targetWriteCommands;
      await runDemographicFlows(db, 8, "fixture-world");
      if (JSON.stringify(await snapshot(db)) !== expected)
        throw new Error("Completed replay changed population");
      const completedReplayTargetWrites = targetWriteCommands - beforeReplayWrites;
      if (completedReplayTargetWrites !== 0)
        throw new Error("Completed replay wrote a population target");
      cases.push({
        interruptedCollection: collection,
        interruptedMethod: method,
        reranUnpublished,
        equalToUninterrupted: true,
        completedReplayTargetWrites,
        pendingReceipts: await db
          .collection("demographicFlowReceipts")
          .countDocuments({ status: "ready" }),
        retainedProjectionChunks: await db
          .collection("demographicFlowProjections")
          .countDocuments({}),
      });
    }
    console.log(
      JSON.stringify(
        {
          baseline: "d7da4e6a89b118359544761b116c7ff314db72cb",
          model: "Two synthetic regions in isolated temporary Mongo databases, no world simulation",
          cases,
          firstPass,
          baselineFirstPass,
          unchangedPopulationMath: baselineFirstPass ? true : null,
          limitations: [
            "No refugee, casualty, service budget or physical-damage mechanic is qualified by this fixture.",
            "Concurrent reset and turn writers remain unsupported; reset must stop turn processing.",
            "First-pass timing includes setup effects and is diagnostic, not a full-world performance result.",
          ],
        },
        null,
        2
      )
    );
  } finally {
    const cleanup = await Promise.allSettled(databases.map((db) => db.dropDatabase()));
    await client.close();
    const failure = cleanup.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Population replay fixture failed");
  process.exitCode = 1;
});
