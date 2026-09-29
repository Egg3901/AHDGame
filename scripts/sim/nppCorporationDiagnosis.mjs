/**
 * Read-only NPP corporation diagnosis from retained sandbox observations.
 * Reports decision-time gates separately from corporation-history cash samples.
 * Run with tsx, SIM_MONGODB_URI, --db=ahd_sim_*, and --run-id=<uuid>.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { MongoClient } from "mongodb";
import { computeNppCorporationHealth } from "../../src/lib/economy/nppCorporationHealth.ts";

const flag = (key) =>
  process.argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const dbName = flag("db");
const runId = flag("run-id");
const uri = process.env.SIM_MONGODB_URI;
assert(
  uri && dbName && /^ahd_sim_[a-zA-Z0-9_-]+$/.test(dbName) && runId,
  "Explicit sandbox and run ID required"
);
const endpoint = new URL(uri);
assert(
  endpoint.protocol === "mongodb:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) &&
    endpoint.port === "27018" &&
    endpoint.pathname === "/",
  "Only dedicated loopback sandbox Mongo is allowed"
);
const client = await new MongoClient(uri).connect();
try {
  const db = client.db(dbName);
  const run = await db
    .collection("simRuns")
    .findOne({ _id: runId }, { projection: { currentTurn: 1, source: 1, preset: 1, status: 1 } });
  assert(
    run?.source?.executedCommit && run.currentTurn > 1,
    "Completed source-attributed turns required"
  );
  const [diagnostics, corps, npps] = await Promise.all([
    db
      .collection("nppOperatorDiagnostics")
      .find({ schemaVersion: 2, turn: { $lte: run.currentTurn } })
      .sort({ turn: 1 })
      .toArray(),
    db
      .collection("corporations")
      .find(
        {},
        { projection: { _id: 1, type: 1, ceoId: 1, ceoType: 1, countryOwnerId: 1, bankCharter: 1 } }
      )
      .toArray(),
    db
      .collection("npps")
      .find({}, { projection: { _id: 1 } })
      .toArray(),
  ]);
  assert(diagnostics.length > 1, "Retained schema-v2 sector observations required");
  const firstTurn = diagnostics[0].turn;
  const lastTurn = diagnostics.at(-1).turn;
  assert.equal(diagnostics.length, lastTurn - firstTurn + 1, "Missing diagnostic turns");
  const nppIds = new Set(npps.map((row) => row._id.toString()));
  const cohort = corps.filter(
    (corp) => corp.ceoType === "npp" || nppIds.has(corp.ceoId?.toString())
  );
  const metadata = new Map(cohort.map((corp) => [corp._id.toString(), corp]));
  assert(cohort.length > 0, "NPP cohort is empty");
  const histories = await db
    .collection("corporationHistory")
    .find(
      {
        corporationId: { $in: cohort.map((corp) => corp._id) },
        turn: { $gte: firstTurn, $lte: lastTurn },
      },
      { projection: { corporationId: 1, turn: 1, liquidCapital: 1, fxRateAtWrite: 1 } }
    )
    .toArray();
  const byTurn = new Map();
  for (const row of histories) {
    if (!byTurn.has(row.turn)) byTurn.set(row.turn, []);
    byTurn.get(row.turn).push(row);
  }
  const sectorTotals = {};
  const series = diagnostics.map((diagnostic) => {
    const rows = byTurn.get(diagnostic.turn) ?? [];
    assert(rows.length > 0, `Missing cash-history turn ${diagnostic.turn}`);
    assert.equal(
      new Set(rows.map((row) => row.corporationId.toString())).size,
      rows.length,
      "Duplicate corporation history"
    );
    const valid = rows.filter(
      (row) =>
        Number.isFinite(row.liquidCapital) &&
        Number.isFinite(row.fxRateAtWrite) &&
        row.fxRateAtWrite > 0
    );
    const health = computeNppCorporationHealth({
      corporations: valid.map((row) => {
        const corp = metadata.get(row.corporationId.toString());
        return {
          type: corp.type,
          ceoType: "npp",
          ceoId: "cohort",
          liquidCapital: row.liquidCapital / row.fxRateAtWrite,
          countryOwnerId: corp.countryOwnerId,
          bankCharter: corp.bankCharter,
        };
      }),
      operatorDiagnostics: diagnostic,
    });
    for (const [sector, data] of Object.entries(diagnostic.sectorDiagnostics ?? {})) {
      const total = (sectorTotals[sector] ??= {
        observations: 0,
        decisionCashNegative: 0,
        bindingGateCounts: {},
        constraintCounts: {},
      });
      total.observations += data.observations;
      total.decisionCashNegative += data.cashNegative;
      for (const field of ["bindingGateCounts", "constraintCounts"])
        for (const [key, count] of Object.entries(data[field]))
          total[field][key] = (total[field][key] ?? 0) + count;
    }
    return {
      turn: diagnostic.turn,
      historyRows: rows.length,
      invalidCashRows: rows.length - valid.length,
      cash: health.sectors,
      decisions: health.sectorDiagnostics,
    };
  });
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        runId,
        preset: run.preset,
        sourceCommit: run.source.executedCommit,
        collectorCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        collectorDirty:
          execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0,
        collectorScriptSha256: createHash("sha256")
          .update(readFileSync(new URL(import.meta.url)))
          .digest("hex"),
        runStatusAtRead: run.status,
        firstTurn,
        lastTurn,
        turns: series.length,
        cohortCount: cohort.length,
        cohortBasis:
          "NPP leadership and primary sector at extraction; history cash is at the corporation history write, not a reconstructed end-of-world balance",
        missingCashPolicy:
          "Absent/nonfinite history is missing, never zero; per-turn denominators are explicit",
        operatorSchema: 2,
        sectorTotals,
        series,
      },
      null,
      2
    )
  );
} finally {
  await client.close();
}
