/**
 * Controlled evaluation report for #1001: sovereign issuance consolidation
 * vs safe cross-border fund eligibility vs domestic fund coverage.
 *
 * Reads per-scenario evidence JSON bundles (see SovereignDemandEvidence in
 * src/lib/bonds/sovereignDemandEvaluation.ts) and emits a deterministic
 * pass/fail report with first-failure evidence. Missing evidence is reported
 * as missing, never fabricated, never a pass. Enables no mechanic: the only
 * flags this harness names are the existing dark gates, and the domestic
 * coverage scenario is defined with no gate at all.
 *
 * Evidence bundles are exported from each scenario's sandbox world from the
 * same collections scripts/sim/economicExperimentReport.ts already reads:
 * trailing-12 economicVitalSigns (securities.sovereignNoHolderBondShare,
 * securities.twoSidedListingShare, securities.depthToMarketCap), active
 * indexFunds (backing ratio, cashAnchor, total backing), per-country
 * commodityFlows fill medians, and the terminal ledgerReconciliations row.
 *
 * Usage:
 *   npx tsx scripts/sim/sovereignDemandEvaluation2026-09-17.ts \
 *     --evidence=baseline-1001=./evidence/baseline-1001.json \
 *     --evidence=issuance-consolidation-1001=./evidence/consolidation.json
 *   npx tsx scripts/sim/sovereignDemandEvaluation2026-09-17.ts --print-queue
 *
 * Exit code is 1 when any evaluated scenario fails, 0 otherwise (missing
 * evidence alone does not fail: it names what worldsim still owes).
 */

// Forces module scope like the other sim collectors.
export {};

import { existsSync, readFileSync } from "node:fs";
import {
  evaluateSovereignDemandMatrix,
  SOVEREIGN_DEMAND_SCENARIOS,
  type SovereignDemandEvidence,
  type SovereignDemandScenarioId,
} from "../../src/lib/bonds/sovereignDemandEvaluation";

function arg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function argAll(flag: string): string[] {
  const prefix = `--${flag}=`;
  return process.argv
    .filter((value) => value.startsWith(prefix))
    .map((value) => value.slice(prefix.length));
}

const SCENARIO_IDS = new Set(SOVEREIGN_DEMAND_SCENARIOS.map((scenario) => scenario.id));

function loadEvidence(spec: string): SovereignDemandEvidence {
  const separator = spec.indexOf("=");
  if (separator < 0) throw new Error(`--evidence must be <scenarioId>=<path> (got "${spec}")`);
  const scenarioId = spec.slice(0, separator);
  const path = spec.slice(separator + 1);
  if (!SCENARIO_IDS.has(scenarioId as SovereignDemandScenarioId)) {
    throw new Error(
      `Unknown scenario "${scenarioId}": expected one of ${[...SCENARIO_IDS].join(", ")}`
    );
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as SovereignDemandEvidence;
  if (parsed.scenarioId !== scenarioId) {
    throw new Error(
      `Evidence file ${path} claims scenario "${parsed.scenarioId}" but was passed as "${scenarioId}"`
    );
  }
  return parsed;
}

function printQueue(): void {
  const lines = [
    "# #1001 worldsim queue: one controlled run per queueable scenario.",
    "# Same seed/preset/turns across all four so the comparison is controlled.",
    "# All four scenarios are queueable; each pins all three gates explicitly.",
  ];
  for (const scenario of SOVEREIGN_DEMAND_SCENARIOS) {
    if (scenario.queueable && scenario.runWorldArgs) {
      lines.push(
        `SIM_MONGODB_URI=<sandbox> npx tsx scripts/sim/runWorld.ts --seed=<seed> --preset=<preset> --turns=<turns> ${scenario.runWorldArgs.join(" ")} # ${scenario.id}`
      );
    } else {
      lines.push(`# BLOCKED ${scenario.id}: ${scenario.blockedReason ?? "no gate"}`);
    }
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

function main(): void {
  if (process.argv.includes("--print-queue")) {
    printQueue();
    return;
  }
  const evidenceDir = arg("evidence-dir");
  const specs = argAll("evidence");
  if (evidenceDir) {
    for (const scenario of SOVEREIGN_DEMAND_SCENARIOS) {
      // Absent files stay absent: missing evidence is a verdict, not an error.
      const path = `${evidenceDir.replace(/\/$/, "")}/${scenario.id}.json`;
      if (existsSync(path)) specs.push(`${scenario.id}=${path}`);
    }
  }
  if (specs.length === 0) {
    throw new Error(
      "Pass --evidence=<scenarioId>=<path> (repeatable), --evidence-dir=<dir>, or --print-queue"
    );
  }
  const byScenario = new Map<string, SovereignDemandEvidence>();
  for (const spec of specs) {
    const evidence = loadEvidence(spec);
    byScenario.set(evidence.scenarioId, evidence);
  }
  const baseline = byScenario.get("baseline-1001") ?? null;
  const report = evaluateSovereignDemandMatrix(baseline, {
    "issuance-consolidation-1001": byScenario.get("issuance-consolidation-1001") ?? null,
    "cross-border-eligibility-1001": byScenario.get("cross-border-eligibility-1001") ?? null,
    "domestic-fund-coverage-1001": byScenario.get("domestic-fund-coverage-1001") ?? null,
  });

  for (const row of report.scenarios) {
    const marker = row.status === "pass" ? "PASS" : row.status === "fail" ? "FAIL" : "MISSING";
    process.stdout.write(`[${marker}] ${row.scenarioId}: ${row.label}\n`);
    for (const check of row.checks) {
      process.stdout.write(
        `  ${check.status.toUpperCase().padEnd(7)} ${check.check}: ${check.detail}\n`
      );
    }
  }
  if (report.missingEvidence.length > 0) {
    process.stdout.write(`\nEvidence still missing: ${report.missingEvidence.join(", ")}\n`);
    process.stdout.write(
      "Queue the missing scenarios with --print-queue (worldsim simJobs, 03:00-08:00 America/New_York claim window).\n"
    );
  }
  process.stdout.write(`\n${JSON.stringify(report, null, 2)}\n`);
  if (report.scenarios.some((row) => row.status === "fail")) process.exitCode = 1;
}

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
