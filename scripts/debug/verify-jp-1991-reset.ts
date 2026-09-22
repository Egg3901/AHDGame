/**
 * Verify Japan's seeded state after a 1991-default reset.
 *
 * Reads MONGODB_URI (the Atlas testing DB). Makes NO writes.
 *
 *   npx tsx scripts/debug/verify-jp-1991-reset.ts
 *
 * Runs the same report the admin readiness panel does, then adds the checks
 * that are specific to the 1991 era override: the Diet is 512/252 in 1991, not
 * the modern 465/248, and the party roster is the pre-1994 one.
 */
import * as dotenv from "dotenv";
import * as path from "path";

// tsx does not load .env.local the way `next dev` does, and `getDb` validates
// the env before it connects. Load it first or the script dies on MONGODB_URI.
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { getDb } from "@/lib/mongodb";
import { getCountryConfig } from "@/lib/constants/countries";
import { buildCountryReadinessReport } from "@/lib/admin/countryReadinessReport";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";

function line(label: string, value: unknown, verdict?: boolean) {
  const mark = verdict === undefined ? " " : verdict ? "PASS" : "FAIL";
  console.log(`  ${mark.padEnd(4)} ${label.padEnd(44)} ${String(value)}`);
}

async function main() {
  const db = await getDb();
  const preset = await getGameStatePresetOrDefault(db);

  console.log("\n=== WORLD ===");
  line("gameState preset", preset, preset === "1991-default");
  if (preset !== "1991-default") {
    console.log("\n  The world is not on 1991-default; the checks below assume it is.\n");
  }

  const cfg = getCountryConfig("JP", preset);
  const lower = cfg.legislature.lowerChamber;
  const upper = cfg.legislature.upperChamber;

  console.log("\n=== ERA CONFIG (the 1991 override) ===");
  line("legislature name", cfg.legislature.name, cfg.legislature.name === "Kokkai");
  line(`${lower.name} seats`, lower.seats, lower.seats === 512);
  line(`${upper?.name} seats`, upper?.seats, upper?.seats === 252);

  console.log("\n=== SEATED OFFICIALS ===");
  const officials = db.collection("electedOfficials");
  const byChamber = await officials
    .aggregate([
      { $match: { countryId: "JP" } },
      { $group: { _id: "$officeType", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ])
    .toArray();
  for (const row of byChamber) line(`officeType ${String(row._id)}`, row.n);
  const total = byChamber.reduce((n, r) => n + (r.n as number), 0);
  line("total JP elected officials", total);

  console.log("\n=== PARTIES (1991 roster, not the modern one) ===");
  const parties = await db
    .collection<{ name: string; abbreviation?: string }>("politicalParties")
    .find({ countryId: "JP" })
    .project<{ name: string; abbreviation?: string }>({ name: 1, abbreviation: 1 })
    .toArray();
  line("party count", parties.length, parties.length > 0);
  for (const p of parties) console.log(`       - ${p.abbreviation ?? "?"}  ${p.name}`);
  const abbrs = new Set(parties.map((p) => p.abbreviation));
  // JSP is era-gated to the Cold-War presets; CDP was founded in 2017.
  line("JSP present (1991-era party)", abbrs.has("JSP"), abbrs.has("JSP"));
  line("CDP absent (founded 2017)", !abbrs.has("CDP"), !abbrs.has("CDP"));

  console.log("\n=== REGIONS / DATA ===");
  const counts: Array<[string, number]> = [
    ["states (regions)", await db.collection("states").countDocuments({ countryId: "JP" })],
    [
      "stateDemographics",
      await db.collection("stateDemographics").countDocuments({ countryId: "JP" }),
    ],
    ["statePartyOrg", await db.collection("statePartyOrg").countDocuments({ countryId: "JP" })],
    ["npps", await db.collection("npps").countDocuments({ countryId: "JP" })],
    [
      "governmentFormations",
      await db.collection("governmentFormations").countDocuments({ _id: "JP" as never }),
    ],
  ];
  for (const [label, n] of counts) line(label, n, n > 0);

  console.log("\n=== READINESS REPORT (same as the admin panel) ===");
  const report = await buildCountryReadinessReport(db, "JP");
  if (!report) {
    line("report", "NONE — no expectations registered for JP", false);
  } else {
    for (const check of report.checks ?? []) {
      const ok = check.status === "ok";
      line(
        `${check.name}${check.count !== undefined ? ` (${check.count})` : ""}`,
        `${check.status}${check.detail ? ` — ${check.detail}` : ""}`,
        ok
      );
    }
  }

  console.log("");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
