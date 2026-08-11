/**
 * Election & Demographics Balance Audit — Runner
 *
 * Run:    npx tsx scripts/audit/index.ts
 * Output: scripts/audit/report-YYYY-MM-DD.md
 *
 * Suite layout:
 *   State elections  (PI = politicalInfluence, capped at 100)
 *     1–5  : position alignment, PI dominance, approval
 *     6–10 : approval under attack, party org, factor decomp, vote splitting, field size
 *     11–15: new player viability, turnout bias, state lean accuracy, PI crossover
 *     16–19: primary consistency, formula balance, field, pipeline
 *
 *   Presidential elections (NPI = nationalInfluence, uncapped)
 *     20–24: NPI dominance, position crossover, party org curve, independent handicap, celebrity primary
 *
 *   Demographics
 *     25: Full state demographic census — all states, all groups, lean vs 2020
 */

import { writeFileSync } from "fs";
import { join } from "path";
import { globalFlags } from "./helpers";

import {
  suite1_piDominance,
  suite2_positionVsPI,
  suite3_positionCurve,
  suite4_axisSym,
  suite5_approvalScalar,
} from "./suites/s01-s05-position-approval";
import {
  suite6_approvalAttack,
  suite7_partyOrg,
  suite8_factorDecomposition,
  suite9_voteSplitting,
  suite10_fieldSize,
} from "./suites/s06-s10-org-factors";
import {
  suite11_newPlayerViability,
  suite12_turnoutBias,
  suite13_turnoutSensitivity,
  suite14_stateLeanAccuracy,
  suite15_piCrossoverMap,
} from "./suites/s11-s15-viability-lean";
import {
  suite16_primaryVsGeneral,
  suite17_primary6040,
  suite18_primaryField,
  suite19_primaryToGeneral,
} from "./suites/s16-s19-primaries";
import {
  suite20_presNPIDominance,
  suite21_presPositionVsNPI,
  suite22_presPartyOrg,
  suite23_independentHandicap,
  suite24_presidentPrimaryField,
} from "./suites/s20-s24-presidential";
import { suite25_allStateDemographicCensus } from "./suites/s25-state-demographic-census";

const suites: Array<() => string> = [
  // ── State elections ───────────────────────────────────────────────────────
  suite1_piDominance,
  suite2_positionVsPI,
  suite3_positionCurve,
  suite4_axisSym,
  suite5_approvalScalar,
  suite6_approvalAttack,
  suite7_partyOrg,
  suite8_factorDecomposition,
  suite9_voteSplitting,
  suite10_fieldSize,
  suite11_newPlayerViability,
  suite12_turnoutBias,
  suite13_turnoutSensitivity,
  suite14_stateLeanAccuracy,
  suite15_piCrossoverMap,
  suite16_primaryVsGeneral,
  suite17_primary6040,
  suite18_primaryField,
  suite19_primaryToGeneral,
  // ── Presidential elections ────────────────────────────────────────────────
  suite20_presNPIDominance,
  suite21_presPositionVsNPI,
  suite22_presPartyOrg,
  suite23_independentHandicap,
  suite24_presidentPrimaryField,
  // ── Demographics ─────────────────────────────────────────────────────────
  suite25_allStateDemographicCensus,
];

function main() {
  const date = new Date().toISOString().split("T")[0];
  const sections: string[] = [];

  for (const suite of suites) {
    try {
      sections.push(suite());
    } catch (e) {
      sections.push(`**SUITE ERROR:** ${e}`);
    }
  }

  const summaryLines = [
    `# Election & Demographics Balance Audit\n\n**Generated:** ${date}  \n**Suites run:** ${suites.length}  \n**Flags raised:** ${globalFlags.length}`,
    `\n## ⚠️ Summary of Flags\n`,
  ];
  if (globalFlags.length === 0) {
    summaryLines.push("_No flags raised — all suites passed thresholds._");
  } else {
    for (const f of globalFlags) summaryLines.push(`- ${f}`);
  }

  const report = [summaryLines.join("\n"), "---", ...sections].join("\n\n---\n\n");
  const outPath = join(__dirname, `report-${date}.md`);
  writeFileSync(outPath, report, "utf-8");
  console.log(`✓ Report written to ${outPath}`);
  console.log(`  ${globalFlags.length} flags raised`);
}

main();
