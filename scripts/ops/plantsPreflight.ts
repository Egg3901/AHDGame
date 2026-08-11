/**
 * PLANTS TRANSITION PREFLIGHT — is this world safe to flip to the plants tier?
 *
 * DRY RUN ONLY. This script opens no write, holds no lock, and takes no
 * action. Run it as many times as you like, on prod, mid-turn, from anywhere.
 *
 * ── What it is for ──────────────────────────────────────────────────────────
 *
 * Flipping `marketSystemMode` to "plants" is a one-way economic change made
 * one sector at a time, LAZILY, on each sector's first plants turn. By the
 * time you can see the result the whole world has already migrated. This
 * report predicts that migration before it happens, using the engine's own
 * primitives (`impliedOutputUnits`, `CAPITAL_SEED_HEADROOM`,
 * `capacityPricePerUnit`) rather than a second copy of the maths.
 *
 * It answers five questions:
 *
 *  1. **How many sectors will migrate**, and how many already did.
 *  2. **How far the world's supply steps on the flip turn.** The seed arm sets
 *     a migrating sector's capacity to `impliedUnits × 1.1` and then restates
 *     its nameplate as `capacity × mixPrice`. That restatement is NOT governed
 *     by the λ ramp, so it lands in full, immediately, and moves every
 *     commodity price. A world coming from `capital` (which already has real
 *     `capitalStock`) barely moves; a world coming from `clearing` or below
 *     takes the entire 10% at once.
 *  3. **What the in-flight growth ramps convert into.** Sectors mid-ramp are
 *     credited free build orders for capacity they already paid for. That is a
 *     SECOND supply wave, landing ~24 turns later, and it is invisible on the
 *     flip turn itself.
 *  4. **Whether the groundwork is done** — unowned sectors need `headroomUnits`
 *     (the plants leading field) or the unowned pool silently reads as empty.
 *  5. **Whether any sector's data would break the flip identity** — a nameplate
 *     that is negative or non-finite, an output mix that prices to nothing, a
 *     sector already migrated but with no capacity left.
 *
 * ── Reading the verdict ─────────────────────────────────────────────────────
 *
 * GO means nothing in the world blocks the flip. It does NOT mean the flip is
 * a good idea today — read the cautions, and read the supply step even when it
 * is under the line.
 *
 * NO-GO lists its reasons. Every one is fixable. The supply-step reason is the
 * only one an operator can legitimately overrule, with --accept-supply-step.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *   MONGODB_URI='mongodb://...&directConnection=true' \
 *     npx tsx scripts/ops/plantsPreflight.ts
 *
 *   --json[=<path>]            machine-readable blob (stdout when no path)
 *   --accept-supply-step=0.08  accept a predicted world-supply step this large
 *   --limit=<n>               cap the per-sector detail lists (default 20)
 *
 * Exit code is 0 on GO and 1 on NO-GO, so it can gate a scripted flip.
 *
 * Follow-on: `scripts/ops/plantsWatch.ts` (soak), and
 * `scripts/migrations/restoreCapitalModeFromShadow.ts --verify` (rollback drill).
 */
import { writeFileSync } from "fs";
import { connectDb, closeDb } from "../utils/db";
import {
  assessPlantsFlipForSector,
  buildPlantsPreflightReport,
  type PlantsPreflightReport,
  type PlantsPreflightSectorAssessment,
} from "../../src/lib/market/plantsTransition";
import { getMarketSystemModeForDb } from "../../src/lib/market/featureFlag";
import { loadWorldEraUnitScale } from "../../src/lib/currency/gdpAnchorRate";
import {
  MARKET_REALIZATION_DEVIATION_CAP,
  MARKET_REALIZATION_RAMP_TURNS,
} from "../../src/lib/market/capital";
import type { GameConfig } from "../../src/lib/db/types";
import {
  argFlag,
  argNumber,
  argValue,
  countCrisisEffectPhysicality,
  migrationHasRun,
  readCommodityPrices,
  readCurrentTurn,
  readCurrentYear,
  readUnownedHeadroomStatus,
  streamAnchoredSectors,
} from "./plantsDbReaders";

const HEADROOM_BACKFILL_MARKER = "2026-08-01-backfill-unowned-headroom-units";

function money(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(2);
}

function pct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

/** The human-readable report. Kept separate from the JSON so neither shapes the other. */
export function formatPreflightReport(report: PlantsPreflightReport, limit: number): string {
  const L: string[] = [];
  const rule = "─".repeat(78);

  L.push(rule);
  L.push(
    `PLANTS TRANSITION PREFLIGHT — turn ${report.turn}${report.year ? ` (${report.year})` : ""}`
  );
  L.push(rule);
  L.push(`VERDICT: ${report.verdict}`);
  if (report.reasons.length > 0) {
    L.push("");
    L.push("NO-GO reasons:");
    for (const r of report.reasons) L.push(`  ✗ ${r}`);
  }
  if (report.cautions.length > 0) {
    L.push("");
    L.push("Cautions (not blocking):");
    for (const c of report.cautions) L.push(`  ! ${c}`);
  }

  L.push("");
  L.push(`Current mode      : ${report.mode.current}`);
  L.push(
    `Governor          : cap ${report.governor.cap}, ramp ${report.governor.rampTurns} turns ` +
      `(a flip today finishes ramping at turn ${report.turn + report.governor.rampTurns})`
  );

  L.push("");
  L.push("SECTORS");
  L.push(`  total                    ${report.sectors.total}`);
  L.push(`  will migrate on flip     ${report.sectors.willMigrate}`);
  L.push(`  already migrated         ${report.sectors.alreadyMigrated}`);
  L.push(`  no capitalStock (lazy)   ${report.sectors.missingCapitalStock}`);
  L.push(`  step on the 1.1x rule    ${report.sectors.steppingOnHeadroom}`);
  L.push(`  mothballed               ${report.sectors.mothballed}`);
  L.push(`  with blockers            ${report.sectors.withBlockers}`);
  L.push(`  with warnings            ${report.sectors.withWarnings}`);
  if (Object.keys(report.sectors.blockerCounts).length > 0) {
    L.push("  blockers:");
    for (const [k, n] of Object.entries(report.sectors.blockerCounts)) L.push(`    ${k}: ${n}`);
  }
  if (Object.keys(report.sectors.warningCounts).length > 0) {
    L.push("  warnings:");
    for (const [k, n] of Object.entries(report.sectors.warningCounts)) L.push(`    ${k}: ${n}`);
  }

  L.push("");
  L.push("WORLD SUPPLY STEP (lands in full on the flip turn — the governor does not soften it)");
  L.push(`  nameplate before   ₳${money(report.supply.preFlipRevenueAnchor)}`);
  L.push(`  nameplate after    ₳${money(report.supply.postFlipRevenueAnchor)}`);
  L.push(
    `  delta              ₳${money(report.supply.deltaAnchor)}  (${pct(report.supply.deltaPct)})`
  );
  if (report.supply.byCommodity.length > 0) {
    L.push("  largest per-commodity unit deltas:");
    for (const c of report.supply.byCommodity.slice(0, limit)) {
      L.push(`    ${c.commodity.padEnd(16)} ${c.deltaUnits >= 0 ? "+" : ""}${money(c.deltaUnits)}`);
    }
  }

  L.push("");
  L.push("SECOND WAVE — in-flight growth ramps converted to free build credit");
  L.push(`  sectors credited   ${report.buildCredit.sectors}`);
  L.push(`  capacity units     ${money(report.buildCredit.units)}`);
  L.push(`  honouring spend    ₳${money(report.buildCredit.basisAnchor)}`);
  L.push(
    `  lands turns        ${
      report.buildCredit.landsBetweenTurns
        ? `${report.buildCredit.landsBetweenTurns[0]} → ${report.buildCredit.landsBetweenTurns[1]}`
        : "n/a"
    }`
  );

  L.push("");
  L.push("OUTSTANDING CIP");
  L.push(`  sectors with orders ${report.cip.sectorsWithOutstanding}`);
  L.push(`  orders              ${report.cip.outstandingOrders}`);
  L.push(`  capital committed   ₳${money(report.cip.totalAnchor)}`);

  L.push("");
  L.push("UNOWNED POOL");
  L.push(`  docs                ${report.unowned.total}`);
  L.push(`  missing headroomUnits ${report.unowned.missingHeadroomUnits}`);
  L.push(`  backfill marker     ${report.unowned.backfillMigrationRan ? "present" : "ABSENT"}`);

  L.push("");
  L.push("ACTIVE CRISIS EFFECTS");
  L.push(`  financial (explicit) ${report.crises.financialOnly}`);
  L.push(`  legacy (unflagged → treated as financial) ${report.crises.legacyUnflagged}`);

  if (report.worstBlockers.length > 0) {
    L.push("");
    L.push("SECTORS THAT WOULD BREAK THE FLIP IDENTITY");
    for (const s of report.worstBlockers.slice(0, limit)) {
      L.push(
        `  ${s.id}  corp=${s.corporationId ?? "-"}  ${s.sectorType}  ` +
          `rev=₳${money(s.currentRevenueAnchor)}  cap=${money(s.storedCapacity)}  ` +
          `[${s.blockers.join(", ")}]`
      );
    }
  }

  if (report.biggestSteps.length > 0) {
    L.push("");
    L.push("BIGGEST NAMEPLATE STEPS");
    for (const s of report.biggestSteps.slice(0, limit)) {
      L.push(
        `  ${s.id}  ${s.sectorType.padEnd(14)} ₳${money(s.currentRevenueAnchor)} → ` +
          `₳${money(s.predictedRevenueAnchor)}  (+₳${money(s.revenueDeltaAnchor)})`
      );
    }
  }

  L.push(rule);
  return L.join("\n");
}

export async function runPlantsPreflight(
  db: import("mongodb").Db,
  opts: { acceptSupplyStepPct?: number } = {}
): Promise<PlantsPreflightReport> {
  const currentMode = await getMarketSystemModeForDb(db);
  const currentTurn = await readCurrentTurn(db);
  const currentYear = await readCurrentYear(db);
  const eraUnitScale = await loadWorldEraUnitScale(db);

  const cfg = await db
    .collection<GameConfig>("gameConfig")
    .findOne(
      { _id: "default" },
      { projection: { marketGovernorCap: 1, marketGovernorRampTurns: 1 } }
    );
  const cap =
    typeof cfg?.marketGovernorCap === "number" && cfg.marketGovernorCap >= 0
      ? cfg.marketGovernorCap
      : MARKET_REALIZATION_DEVIATION_CAP;
  const rampTurns =
    typeof cfg?.marketGovernorRampTurns === "number" && cfg.marketGovernorRampTurns >= 1
      ? cfg.marketGovernorRampTurns
      : MARKET_REALIZATION_RAMP_TURNS;

  // Assessments are kept, sector documents are not: the assessment is a fixed
  // small object, the document is not.
  const assessments: PlantsPreflightSectorAssessment[] = [];
  await streamAnchoredSectors(db, (row) => {
    assessments.push(
      assessPlantsFlipForSector(
        {
          id: row.id,
          corporationId: row.corporationId,
          sectorType: row.sectorType,
          stateId: row.stateId,
          countryId: row.countryId,
          revenueAnchor: row.revenueAnchor,
          currentGrowthCostAnchor: row.currentGrowthCostAnchor,
          capitalStock: row.capitalStock,
          strategyId: row.strategyId,
          transitionFromStrategyId: row.transitionFromStrategyId,
          transitionStartTurn: row.transitionStartTurn,
          plantsStartTurn: row.plantsStartTurn,
          buildQueue: row.buildQueue,
          constructionInProgressAnchor: row.constructionInProgressAnchor,
          mothballed: row.mothballed,
        },
        { currentTurn, currentYear, eraUnitScale }
      )
    );
  });

  const unowned = await readUnownedHeadroomStatus(db);
  const backfillMigrationRan = await migrationHasRun(db, HEADROOM_BACKFILL_MARKER);
  const crises = await countCrisisEffectPhysicality(db);

  return buildPlantsPreflightReport({
    currentMode,
    currentTurn,
    currentYear,
    assessments,
    unowned: { ...unowned, backfillMigrationRan },
    crises: { financialOnly: crises.financialOnly, legacyUnflagged: crises.legacyUnflagged },
    governor: { cap, rampTurns },
    acceptSupplyStepPct: opts.acceptSupplyStepPct,
  });
}

async function main() {
  const limit = argNumber("limit") ?? 20;
  const acceptSupplyStepPct = argNumber("accept-supply-step");
  const wantJson = argFlag("json") || argValue("json") != null;
  const jsonPath = argValue("json");

  const db = await connectDb();
  try {
    const report = await runPlantsPreflight(db, { acceptSupplyStepPct });

    // Prices are informational context for the human report only; they are not
    // an input to the verdict, so a failure to read them must not fail the run.
    let prices: Record<string, number> = {};
    try {
      prices = await readCommodityPrices(db);
    } catch {
      prices = {};
    }

    console.log(formatPreflightReport(report, limit));

    if (wantJson) {
      const blob = JSON.stringify({ ...report, commodityPrices: prices }, null, 2);
      if (jsonPath) {
        writeFileSync(jsonPath, blob);
        console.log(`\nJSON written to ${jsonPath}`);
      } else {
        console.log(`\n${blob}`);
      }
    }

    process.exitCode = report.verdict === "GO" ? 0 : 1;
  } finally {
    await closeDb();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
