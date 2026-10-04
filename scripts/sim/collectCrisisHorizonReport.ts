/** Read-only sandbox report for the seven-family 1991 to 2027 horizon (#2158). */
import { writeFile } from "node:fs/promises";
import { MongoClient } from "mongodb";
import type { CrisisHorizonPoint } from "./crisisHorizonTelemetry";
import {
  buildCrisisHorizonReport,
  renderCrisisHorizonMarkdown,
  type CrisisHorizonManifest,
} from "./crisisHorizonReport";

function arg(name: string): string | undefined {
  return process.argv.find((part) => part.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main(): Promise<void> {
  const uri = process.env.SIM_MONGODB_URI;
  const dbName = arg("db");
  const runId = arg("run-id");
  const out = arg("out");
  if (!uri || !dbName?.startsWith("ahd_sim_") || !runId || !out) {
    throw new Error(
      "Usage: SIM_MONGODB_URI=<sandbox> tsx collectCrisisHorizonReport.ts --db=ahd_sim_<id> --run-id=<id> --out=<report.json>"
    );
  }
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const manifest = await db
      .collection<CrisisHorizonManifest & { _id: string }>("simRuns")
      .findOne({ _id: runId });
    if (!manifest) throw new Error(`No simRuns manifest for ${runId}`);
    const points = await db
      .collection<CrisisHorizonPoint>("simCrisisHorizon")
      .find({ runId })
      .sort({ turn: 1, defKey: 1 })
      .toArray();
    const report = buildCrisisHorizonReport(manifest, points);
    await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(`${out}.md`, renderCrisisHorizonMarkdown(report), "utf8");
    if (report.qualification !== "complete") {
      throw new Error(`Incomplete horizon report: ${report.reasons.slice(0, 10).join("; ")}`);
    }
    console.log(
      `Wrote ${out}: ${report.coverage.recordedPoints} points, ${report.coverage.firstYear} to ${report.coverage.lastYear}`
    );
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
