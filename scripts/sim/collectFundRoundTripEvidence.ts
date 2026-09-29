/**
 * Read-only #2120 qualification from one completed, source-pinned sandbox run.
 *
 * SIM_MONGODB_URI must be the dedicated loopback sandbox mongod on :27018.
 * OPS_MONGODB_URI is read only for simJobs provenance. No live game connection
 * is used. Output goes to stdout, and no database writes are performed.
 */
import { MongoClient } from "mongodb";
import { execFileSync } from "child_process";
import { resolveCollectorCommit } from "./collectorSource";
import { evaluateFundRoundTrip, type EvidenceInput } from "./fundRoundTripEvidence";
import {
  assertEvidenceExtractorSource,
  assertFreshPinnedFundRun,
  type FundRunJob,
  type FundSimRun,
} from "./fundRoundTripProvenance";
import { sumFundBondHoldingsByFundId } from "@/lib/bonds/fundBondHoldings";
import type {
  IndexFund,
  IndexFundPosition,
  IndexFundTransaction,
  IndexFundRedemptionQueueEntry,
  ShareOrder,
  ExchangeRate,
} from "@/lib/db/types";

function flag(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

/** Reject production endpoints before opening a socket. */
export function assertSandboxTarget(
  uri: string | undefined,
  dbName: string | undefined
): asserts dbName is string {
  if (!uri || !dbName || !/^ahd_sim_[a-zA-Z0-9_-]{1,64}$/.test(dbName)) {
    throw new Error("Explicit SIM_MONGODB_URI and ahd_sim_* --db are required");
  }
  const parsed = new URL(uri);
  if (
    parsed.protocol !== "mongodb:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.port !== "27018" ||
    parsed.pathname !== "/"
  ) {
    throw new Error(
      "Sandbox URI must target dedicated loopback MongoDB on port 27018 with no path"
    );
  }
}

async function main() {
  const runId = flag("run-id");
  const dbName = flag("db");
  const requestedCommit = flag("source-commit");
  const requestedExtractorCommit = flag("extractor-commit");
  const sandboxUri = process.env.SIM_MONGODB_URI;
  const opsUri = process.env.OPS_MONGODB_URI;
  assertSandboxTarget(sandboxUri, dbName);
  if (
    !runId ||
    !/^[0-9a-f-]{36}$/.test(runId) ||
    !requestedCommit ||
    !/^[0-9a-f]{40}$/.test(requestedCommit) ||
    !opsUri ||
    opsUri === sandboxUri
  ) {
    throw new Error(
      "Run UUID, full simulation and extractor SHAs, and separate OPS_MONGODB_URI are required"
    );
  }
  const extractorCommit = resolveCollectorCommit(process.cwd());
  const dirtyStatus = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assertEvidenceExtractorSource(requestedExtractorCommit, extractorCommit, dirtyStatus);
  const sandboxClient = new MongoClient(sandboxUri!);
  const opsClient = new MongoClient(opsUri);
  try {
    await Promise.all([sandboxClient.connect(), opsClient.connect()]);
    const db = sandboxClient.db(dbName);
    const job = await opsClient
      .db(process.env.OPS_DB_NAME || "a-house-divided")
      .collection<FundRunJob>("simJobs")
      .findOne({ _id: runId as never });
    const run = await db.collection<FundSimRun>("simRuns").findOne({ _id: runId as never });
    const runCount = await db.collection("simRuns").countDocuments({});
    assertFreshPinnedFundRun(job, run, runCount, dbName, requestedCommit);
    if (!job || !run) throw new Error("Missing pinned simulation records");
    const [
      config,
      funds,
      transactions,
      queue,
      positions,
      orders,
      facility,
      rates,
      corporations,
      npps,
    ] = await Promise.all([
      db.collection("gameConfig").findOne({ _id: "default" as never }),
      db.collection<IndexFund>("indexFunds").find({}).toArray(),
      db.collection<IndexFundTransaction>("indexFundTransactions").find({}).toArray(),
      db.collection<IndexFundRedemptionQueueEntry>("indexFundRedemptionQueue").find({}).toArray(),
      db.collection<IndexFundPosition>("indexFundPositions").find({}).toArray(),
      db
        .collection<ShareOrder>("shareOrders")
        .find({ placerFundId: { $exists: true } })
        .toArray(),
      db.collection("equityLiquidityFacilitySnapshots").find({}).toArray(),
      db.collection<ExchangeRate>("exchangeRates").find({}).toArray(),
      db
        .collection("corporations")
        .find({}, { projection: { _id: 1 } })
        .toArray(),
      db
        .collection("npps")
        .find({}, { projection: { _id: 1 } })
        .toArray(),
    ]);
    const fx = Object.fromEntries(rates.map((row) => [row.currencyCode, row.rate]));
    const bondValues = await sumFundBondHoldingsByFundId(db, funds, fx);
    const input: EvidenceInput = {
      requestedCommit,
      executedCommit: run.source?.executedCommit ?? null,
      collectorCommit: job.metricsSource?.collectorCommit ?? null,
      evidenceCollectorCommit: extractorCommit,
      requestedRedemptionFlag:
        typeof job.nppFundRedemptionEnabled === "boolean" ? job.nppFundRedemptionEnabled : null,
      initialRedemptionFlag:
        typeof run.effectiveConfigInitial?.gameConfig?.nppFundRedemptionEnabled === "boolean"
          ? run.effectiveConfigInitial.gameConfig.nppFundRedemptionEnabled
          : null,
      finalRedemptionFlag:
        typeof config?.nppFundRedemptionEnabled === "boolean"
          ? config.nppFundRedemptionEnabled
          : null,
      indexFundsMode: config?.indexFundsMode ?? null,
      equityLiquidityFacilityEnabled: config?.equityLiquidityFacilityEnabled ?? null,
      indexFundBondLiquidityEnabled: config?.indexFundBondLiquidityEnabled ?? null,
      funds,
      transactions,
      queue,
      positions,
      orders,
      facility: facility as unknown as EvidenceInput["facility"],
      corporationIds: corporations.map((row) => String(row._id)),
      nppIds: npps.map((row) => String(row._id)),
      bondValueByFund: Object.fromEntries(bondValues),
    };
    const report = evaluateFundRoundTrip(input);
    console.log(
      JSON.stringify(
        {
          runId,
          dbName,
          sourceCommit: requestedCommit,
          metricsCollectorCommit: job.metricsSource?.collectorCommit,
          evidenceCollectorCommit: extractorCommit,
          ...report,
        },
        null,
        2
      )
    );
    if (!report.passed) process.exitCode = 1;
  } finally {
    await Promise.all([sandboxClient.close(), opsClient.close()]);
  }
}

if (process.argv[1]?.endsWith("collectFundRoundTripEvidence.ts")) {
  main().catch((error) => {
    console.error(
      `Fund round-trip evidence failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  });
}
