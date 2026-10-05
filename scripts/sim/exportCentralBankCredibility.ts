/** Export a bounded, source-pinned sandbox trajectory for #2319. */
import { MongoClient } from "mongodb";
import {
  assertCredibilityReportInterval,
  buildCentralBankCredibilityReport,
  type CredibilityRunManifest,
} from "./centralBankCredibilityReport";
import type { CentralBankCredibilityPoint } from "./centralBankCredibilitySnapshot";

function arg(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main() {
  const uri = process.env.SIM_MONGODB_URI;
  const dbName = arg("db");
  const runId = arg("run-id");
  const sourceCommit = arg("source-commit");
  const interval = { firstTurn: Number(arg("first-turn")), lastTurn: Number(arg("last-turn")) };
  assertCredibilityReportInterval(interval);
  if (!uri || !dbName || !runId || !/^[0-9a-f]{40}$/.test(sourceCommit ?? "")) {
    throw new Error(
      "Specify SIM_MONGODB_URI, --db, --run-id, --source-commit and the turn interval"
    );
  }
  const endpoint = new URL(uri);
  if (
    endpoint.protocol !== "mongodb:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) ||
    !/^ahd_sim_[a-zA-Z0-9_-]+$/.test(dbName)
  ) {
    throw new Error("Credibility export requires a local sandbox database");
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db(dbName);
    const manifest = await db
      .collection<CredibilityRunManifest & { _id: string }>("simRuns")
      .findOne(
        { _id: runId },
        {
          projection: {
            runId: 1,
            seed: 1,
            status: 1,
            source: 1,
            centralBankCredibilityTelemetry: 1,
          },
        }
      );
    if (!manifest || manifest.source?.executedCommit !== sourceCommit) {
      throw new Error("Credibility export run is missing or differs from the requested source");
    }
    const keys =
      "_id schemaVersion runId seed codeVersion sourceClass observation observedAt turn year bankId countryId monetaryAuthorityId endPrimeRatePct scrutiny resolveStreak countryInflationPct nationalGdpGrowthPct";
    const points = await db
      .collection<CentralBankCredibilityPoint>("simCentralBankCredibility")
      .find(
        { runId, turn: { $gte: interval.firstTurn, $lte: interval.lastTurn } },
        { projection: Object.fromEntries(keys.split(" ").map((key) => [key, 1])) }
      )
      .sort({ bankId: 1, turn: 1 })
      .limit(10_001)
      .toArray();
    if (points.length > 10_000) throw new Error("Credibility export exceeds its row limit");
    const report = buildCentralBankCredibilityReport(manifest, points, interval);
    console.log(JSON.stringify(report, null, 2));
    if (report.captureQualification !== "complete") process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch(() => {
  console.error("Credibility export failed; verify the sandbox, source pin and capture interval");
  process.exitCode = 1;
});
