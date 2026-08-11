/**
 * CLI wrapper for the seed self-diagnostic.
 *
 *   npx tsx scripts/seed-diagnostic.ts --mode=drift
 *   npx tsx scripts/seed-diagnostic.ts --mode=conformance
 *
 * Honors MONGODB_URI / SIM_MONGODB_URI (SIM takes precedence when set).
 */

import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import { runSeedDiagnostic, formatDiagnosticSummary } from "@/lib/admin/seedDiagnostic";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

function getMode(): "conformance" | "drift" {
  const arg = process.argv.find((v) => v.startsWith("--mode="));
  const mode = arg?.split("=")[1];
  if (mode === "drift" || mode === "conformance") return mode;
  return "conformance";
}

async function main() {
  const uri = process.env.SIM_MONGODB_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("Set MONGODB_URI or SIM_MONGODB_URI in .env.local");
    process.exit(1);
  }

  const mode = getMode();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  try {
    console.log(`Running seed diagnostic (mode=${mode})…`);
    const report = await runSeedDiagnostic(db, { mode, trigger: "manual" });
    console.log(formatDiagnosticSummary(report));
    if (report.note) console.log(`note: ${report.note}`);
    console.log(`preset=${report.preset} turn=${report.turn} calendarTurn=${report.calendarTurn}`);

    const criticals = report.checks.filter((c) => c.severity === "critical");
    const warns = report.checks.filter((c) => c.severity === "warn");
    if (criticals.length > 0) {
      console.log("\nCritical checks:");
      for (const c of criticals) {
        console.log(
          `  [${c.id}] expected=${c.expected} actual=${c.actual}` +
            (c.driftPct != null ? ` drift=${(c.driftPct * 100).toFixed(1)}%` : "") +
            (c.note ? ` (${c.note})` : "")
        );
      }
    }
    if (warns.length > 0 && warns.length <= 30) {
      console.log("\nWarn checks:");
      for (const c of warns) {
        console.log(
          `  [${c.id}] expected=${c.expected} actual=${c.actual}` + (c.note ? ` (${c.note})` : "")
        );
      }
    } else if (warns.length > 30) {
      console.log(`\nWarn checks: ${warns.length} (omitting detail)`);
    }

    process.exit(criticals.length > 0 ? 2 : 0);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("Seed diagnostic failed:", err);
  process.exit(1);
});
