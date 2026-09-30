/** Bounded Mongo replay of the durable founding marker; never writes its retained source. */
import { MongoClient, type Document } from "mongodb";
import {
  appendApprovalTelemetry,
  appendMacroTelemetry,
  resolveLongHorizonContext,
} from "@/lib/telemetry/longHorizon/telemetry";
import { seedTelemetryIndexes } from "@/lib/admin/seed/indexes/telemetry";
import type { GameState } from "@/lib/db/types/gameState";
import type { State } from "@/lib/db/types/state";
import type { GovernmentApproval } from "@/lib/db/types/governmentApproval";

const uri = process.env.SIM_MONGODB_URI ?? "mongodb://127.0.0.1:27018";
const sourceName = "ahd_sim_campaign1-baseline-1953-20260918";
const targetName = "ahd_sim_2099_2100_founding_replay_20260930";
const client = new MongoClient(uri);

async function main() {
  if (!/^mongodb:\/\/127\.0\.0\.1:27018(?:\/|$)/.test(uri)) {
    throw new Error("Founding telemetry replay requires the local sandbox Mongo on port 27018");
  }
  await client.connect();
  const source = client.db(sourceName);
  const target = client.db(targetName);
  const game = await source.collection<GameState>("gameState").findOne({ _id: "current" });
  const state = await source.collection<State>("states").findOne({ countryId: "US" });
  const approval = await source
    .collection<GovernmentApproval>("governmentApprovals")
    .findOne({ _id: "US" });
  if (!game || !state || !approval || game.preIterationTurns !== 48) {
    throw new Error("Retained 1953 founding fixture unavailable or changed");
  }
  const sample = approval.history?.at(-1);
  if (!sample || !Number.isFinite(sample.approval) || !Number.isFinite(sample.net)) {
    throw new Error("Retained approval sample unavailable");
  }
  await target
    .collection<GameState>("gameState")
    .replaceOne(
      { _id: "current" },
      { ...game, currentTurn: 49, preIteration: { ...game.preIteration, active: false } },
      { upsert: true }
    );
  await target.collection<State>("states").replaceOne({ _id: state._id }, state, { upsert: true });
  await target.collection<Document & { _id: string }>("simRuns").replaceOne(
    { _id: "founding-replay-1953" },
    {
      _id: "founding-replay-1953",
      runId: "founding-replay-1953",
      dbName: targetName,
      status: "running",
      source: { executedCommit: process.env.SOURCE_COMMIT ?? "unspecified" },
      seed: "retained-1953-campaign1",
      effectiveConfigInitial: {
        capturedAtTurn: 48,
        gameState: { longHorizonTelemetryEnabled: true },
        gameConfig: {},
      },
    },
    { upsert: true }
  );
  await seedTelemetryIndexes(target, () => {});
  const points = [];
  for (const turn of [48, 49]) {
    const context = await resolveLongHorizonContext(target, turn);
    if (!context) throw new Error("Telemetry context unavailable");
    await appendApprovalTelemetry(target, context, "US", turn, {
      approval: sample.approval,
      net: sample.net,
      states: [{ stateId: String(state._id), approval: sample.approval, net: sample.net }],
    });
    await appendMacroTelemetry(target, context, turn);
    const [approvalRows, macroRows] = await Promise.all([
      target.collection("approvalTelemetry").find({ turn }).toArray(),
      target.collection("macroTelemetry").find({ turn }).toArray(),
    ]);
    if (approvalRows.length !== 2 || macroRows.length !== 4) {
      throw new Error(`Incomplete persisted telemetry at turn ${turn}`);
    }
    for (const row of [...approvalRows, ...macroRows]) {
      if (
        row.foundingTurn !== (turn === 48) ||
        row.year !== 1953 ||
        row.runId !== "founding-replay-1953" ||
        row.sourceClass !== "sandbox" ||
        row.retentionPolicy !== "world-raw-full"
      ) {
        throw new Error(`Unexpected persisted founding/provenance at turn ${turn}`);
      }
    }
    points.push({
      turn,
      foundingTurn: context.foundingTurn,
      year: context.year,
      approvalRows: approvalRows.length,
      macroRows: macroRows.length,
    });
  }
  console.log(
    JSON.stringify(
      {
        sourceName,
        targetName,
        sourceTurn: game.currentTurn,
        preIterationTurns: game.preIterationTurns,
        replaySourceCommit: process.env.SOURCE_COMMIT,
        sampleTurn: sample.turn,
        points,
      },
      null,
      2
    )
  );
}

main().finally(() => client.close());
