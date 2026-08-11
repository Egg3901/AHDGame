/**
 * PLANTS SOAK WATCH — the vital signs an operator stares at after the flip.
 *
 * READ ONLY. No writes to the game database. The only file this script touches
 * is its own snapshot state file (see BUILD FLOW below), and only when you
 * point it at one.
 *
 * ── What to look at, in order ───────────────────────────────────────────────
 *
 * 1. **DRIFT** — derived revenue against `legacyRevenueShadow`, the
 *    counterfactual of what capital mode would have produced from the same
 *    starting point. This is THE soak metric. Drift is expected and grows on
 *    its own: plants stops the nameplate compounding while the shadow keeps
 *    compounding, so the gap widens every turn by construction. What is NOT
 *    expected is a JUMP. A drift that moves several points between consecutive
 *    turns is a bug, not divergence.
 *
 * 2. **FILL RATE** (`sold / produced`) — how much of what the world made
 *    actually cleared. Under plants a sector pays upkeep on capacity whether or
 *    not it sells, so a low fill rate drains corp cash while looking fine on
 *    the production line. Sustained below ~50% is a real problem.
 *
 * 3. **ZERO-PRODUCTION SECTORS** — a sector producing nothing has either been
 *    mothballed (deliberate) or lost its capacity/inputs (not). The count
 *    climbing without the mothball count climbing with it is the bad shape.
 *
 * 4. **CORP CASH DISTRIBUTION** — the median, not the total. Plants moves cost
 *    onto capacity; the failure mode is a long tail of corps going negative
 *    while aggregate cash still looks healthy.
 *
 * 5. **GOVERNOR RAMP** — how many sectors are still being blended toward the
 *    legacy baseline. Until this reaches zero you have NOT seen the plants
 *    economy; you have seen a mixture. Do not declare the soak successful
 *    while sectors are still governed.
 *
 * 6. **COMMODITY PRICE DRIFT** against the base table, and BUILD FLOW.
 *
 * ── Build flow needs two snapshots ──────────────────────────────────────────
 *
 * There is no build-order event log. The turn `$pull`s landed orders straight
 * out of `buildQueue`, so once an order lands it leaves no trace. Orders
 * placed / landed / cancelled can therefore only be counted by DIFFING
 * consecutive observations, which is what `--state` is for: pass the same path
 * each run and the script reports the flow since the previous run.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *   MONGODB_URI='mongodb://...&directConnection=true' \
 *     npx tsx scripts/ops/plantsWatch.ts
 *
 *   --since-turn=<n>   only summarize sectors that flipped at or after turn n
 *                      (use the flip turn from gameConfig.marketSystemModeUpdatedTurn
 *                      to exclude a pre-existing plants cohort)
 *   --json[=<path>]    machine-readable blob (stdout when no path)
 *   --state=<path>     snapshot file enabling the build-order flow diff
 *   --limit=<n>        cap the per-commodity price list (default 15)
 *
 * A soak is a LOOP: run this every few turns, keep the JSON, and watch the
 * series. A single snapshot cannot tell you whether drift is growing or
 * jumping, and growing-vs-jumping is the whole question.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import type { Db } from "mongodb";
import { connectDb, closeDb } from "../utils/db";
import {
  diffBuildQueues,
  mergeBuildFlows,
  summarizePlantsWatch,
  type PlantsBuildFlow,
  type PlantsBuildOrderInput,
  type PlantsWatchSectorInput,
  type PlantsWatchSnapshot,
} from "../../src/lib/market/plantsTransition";
import { getMarketSystemModeForDb } from "../../src/lib/market/featureFlag";
import { MARKET_REALIZATION_RAMP_TURNS } from "../../src/lib/market/capital";
import type { GameConfig } from "../../src/lib/db/types";
import {
  argNumber,
  argValue,
  argFlag,
  loadCorpCashAnchors,
  readCommodityPrices,
  readCurrentTurn,
  streamAnchoredSectors,
} from "./plantsDbReaders";

/** The prior observation, as persisted between runs. */
interface WatchState {
  turn: number;
  /** sectorId → its build queue at that turn. */
  queues: Record<string, PlantsBuildOrderInput[]>;
}

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

export function formatWatchSnapshot(
  snapshot: PlantsWatchSnapshot,
  extras: {
    mode: string;
    flipTurn: number | null;
    sinceTurn: number | null;
    sectorsScanned: number;
    sectorsIncluded: number;
    buildFlow: PlantsBuildFlow | null;
    buildFlowSinceTurn: number | null;
    limit: number;
  }
): string {
  const L: string[] = [];
  const rule = "─".repeat(78);

  L.push(rule);
  L.push(`PLANTS SOAK WATCH — turn ${snapshot.turn}  (mode: ${extras.mode})`);
  if (extras.flipTurn != null) {
    L.push(`Flip turn ${extras.flipTurn} — ${snapshot.turn - extras.flipTurn} turns of soak.`);
  }
  if (extras.sinceTurn != null) {
    L.push(
      `Filtered to sectors flipped at or after turn ${extras.sinceTurn}: ` +
        `${extras.sectorsIncluded} of ${extras.sectorsScanned}.`
    );
  }
  L.push(rule);

  if (snapshot.alerts.length > 0) {
    L.push("ALERTS");
    for (const a of snapshot.alerts) L.push(`  ! ${a}`);
    L.push("");
  }

  L.push(`DRIFT vs the capital-mode counterfactual   [${snapshot.drift.severity.toUpperCase()}]`);
  L.push(`  derived revenue   ₳${money(snapshot.drift.derivedRevenueAnchor)}`);
  L.push(`  shadow revenue    ₳${money(snapshot.drift.shadowRevenueAnchor)}`);
  L.push(
    `  delta             ₳${money(snapshot.drift.deltaAnchor)}  (${pct(snapshot.drift.deltaPct)})`
  );
  L.push(
    `  sectors with/without a shadow  ${snapshot.drift.sectorsWithShadow} / ${snapshot.drift.sectorsWithoutShadow}`
  );

  L.push("");
  L.push("PRODUCTION");
  L.push(
    `  capacity (units)  ${money(snapshot.capacity.total)}  (mean ${money(snapshot.capacity.mean)})`
  );
  L.push(`  produced          ${money(snapshot.production.producedUnits)}`);
  L.push(`  sold              ${money(snapshot.production.soldUnits)}`);
  L.push(`  fill rate         ${pct(snapshot.production.fillRate)}`);
  L.push(`  utilization       ${pct(snapshot.production.utilization)}`);
  L.push(
    `  zero production   ${snapshot.production.zeroProductionSectors} (${pct(snapshot.production.zeroProductionPct)})`
  );
  L.push(`  mothballed        ${snapshot.production.mothballedSectors}`);

  L.push("");
  L.push("GOVERNOR RAMP");
  L.push(`  ramp turns        ${snapshot.governor.rampTurns}`);
  L.push(`  still governed    ${snapshot.governor.stillGoverned}`);
  L.push(`  ungoverned        ${snapshot.governor.ungoverned}`);
  L.push(`  not yet migrated  ${snapshot.governor.unmigrated}`);
  L.push(`  mean lambda       ${snapshot.governor.meanLambda.toFixed(3)}`);
  L.push(
    `  completes by turn ${snapshot.governor.rampCompletesByTurn ?? "n/a (nothing still governed)"}`
  );

  L.push("");
  L.push("CORP CASH (₳)");
  L.push(`  corps             ${snapshot.corpCash.count}`);
  L.push(`  total             ₳${money(snapshot.corpCash.total)}`);
  L.push(
    `  p10 / median / p90  ₳${money(snapshot.corpCash.p10)} / ₳${money(snapshot.corpCash.median)} / ₳${money(snapshot.corpCash.p90)}`
  );
  L.push(`  negative balances ${snapshot.corpCash.negative}`);

  L.push("");
  L.push("BUILD");
  L.push(`  sectors with queue ${snapshot.build.sectorsWithQueue}`);
  L.push(`  outstanding orders ${snapshot.build.outstandingOrders}`);
  L.push(`  outstanding units  ${money(snapshot.build.outstandingUnits)}`);
  L.push(`  CIP                ₳${money(snapshot.build.cipAnchor)}`);
  if (extras.buildFlow) {
    L.push(`  flow since turn ${extras.buildFlowSinceTurn ?? "?"}:`);
    L.push(
      `    placed    ${extras.buildFlow.placedOrders} orders / ${money(extras.buildFlow.placedUnits)} units`
    );
    L.push(
      `    landed    ${extras.buildFlow.landedOrders} orders / ${money(extras.buildFlow.landedUnits)} units`
    );
    L.push(
      `    cancelled ${extras.buildFlow.cancelledOrders} orders / ${money(extras.buildFlow.cancelledUnits)} units`
    );
  } else {
    L.push(
      "  flow: no prior snapshot — pass --state=<path> and run again to get placed/landed/cancelled."
    );
  }

  if (snapshot.prices.length > 0) {
    L.push("");
    L.push("COMMODITY PRICE DRIFT vs base");
    for (const p of snapshot.prices.slice(0, extras.limit)) {
      L.push(
        `  ${p.commodity.padEnd(16)} ${p.price.toFixed(2).padStart(10)} ` +
          `(base ${p.basePrice.toFixed(2)})  ${p.driftPct >= 0 ? "+" : ""}${pct(p.driftPct)}`
      );
    }
  }

  L.push(rule);
  return L.join("\n");
}

export async function runPlantsWatch(
  db: Db,
  opts: { sinceTurn?: number; statePath?: string } = {}
) {
  const mode = await getMarketSystemModeForDb(db);
  const currentTurn = await readCurrentTurn(db);

  const cfg = await db
    .collection<GameConfig>("gameConfig")
    .findOne(
      { _id: "default" },
      { projection: { marketGovernorRampTurns: 1, marketSystemModeUpdatedTurn: 1 } }
    );
  const rampTurns =
    typeof cfg?.marketGovernorRampTurns === "number" && cfg.marketGovernorRampTurns >= 1
      ? cfg.marketGovernorRampTurns
      : MARKET_REALIZATION_RAMP_TURNS;
  const flipTurn =
    typeof cfg?.marketSystemModeUpdatedTurn === "number" ? cfg.marketSystemModeUpdatedTurn : null;

  const sectors: PlantsWatchSectorInput[] = [];
  const queues: Record<string, PlantsBuildOrderInput[]> = {};
  let scanned = 0;

  await streamAnchoredSectors(db, (row) => {
    scanned++;
    // The queue snapshot is taken for EVERY sector, filter or not: the build
    // flow diff has to see the same population next run or orders will look
    // placed and cancelled purely because the filter moved.
    queues[row.id] = (row.buildQueue ?? []) as PlantsBuildOrderInput[];
    if (
      opts.sinceTurn != null &&
      (row.plantsStartTurn == null || row.plantsStartTurn < opts.sinceTurn)
    ) {
      return;
    }
    sectors.push({
      id: row.id,
      corporationId: row.corporationId,
      sectorType: row.sectorType,
      capitalStock: row.capitalStock,
      producedUnits: row.producedUnits,
      soldUnits: row.soldUnits,
      revenueAnchor: row.revenueAnchor,
      legacyRevenueShadowAnchor: row.legacyRevenueShadowAnchor,
      plantsStartTurn: row.plantsStartTurn,
      mothballed: row.mothballed,
      buildQueue: row.buildQueue as PlantsBuildOrderInput[],
      constructionInProgressAnchor: row.constructionInProgressAnchor,
    });
  });

  const corpCashAnchors = await loadCorpCashAnchors(db);
  const commodityPrices = await readCommodityPrices(db);

  const snapshot = summarizePlantsWatch({
    currentTurn,
    governorRampTurns: rampTurns,
    sectors,
    corpCashAnchors,
    commodityPrices,
  });

  // Build flow: diff against the previous snapshot, then persist this one.
  let buildFlow: PlantsBuildFlow | null = null;
  let buildFlowSinceTurn: number | null = null;
  if (opts.statePath) {
    if (existsSync(opts.statePath)) {
      try {
        const prev = JSON.parse(readFileSync(opts.statePath, "utf8")) as WatchState;
        buildFlowSinceTurn = prev.turn;
        const ids = new Set([...Object.keys(prev.queues), ...Object.keys(queues)]);
        buildFlow = mergeBuildFlows(
          [...ids].map((id) =>
            diffBuildQueues(prev.queues[id] ?? [], queues[id] ?? [], currentTurn)
          )
        );
      } catch {
        // A corrupt state file must not abort a soak observation — the whole
        // point of the run is the numbers above.
        buildFlow = null;
      }
    }
    const next: WatchState = { turn: currentTurn, queues };
    writeFileSync(opts.statePath, JSON.stringify(next));
  }

  return {
    snapshot,
    mode,
    flipTurn,
    sectorsScanned: scanned,
    sectorsIncluded: sectors.length,
    buildFlow,
    buildFlowSinceTurn,
  };
}

async function main() {
  const sinceTurn = argNumber("since-turn");
  const statePath = argValue("state");
  const limit = argNumber("limit") ?? 15;
  const wantJson = argFlag("json") || argValue("json") != null;
  const jsonPath = argValue("json");

  const db = await connectDb();
  try {
    const result = await runPlantsWatch(db, { sinceTurn, statePath });

    console.log(
      formatWatchSnapshot(result.snapshot, {
        mode: result.mode,
        flipTurn: result.flipTurn,
        sinceTurn: sinceTurn ?? null,
        sectorsScanned: result.sectorsScanned,
        sectorsIncluded: result.sectorsIncluded,
        buildFlow: result.buildFlow,
        buildFlowSinceTurn: result.buildFlowSinceTurn,
        limit,
      })
    );

    if (wantJson) {
      const blob = JSON.stringify(
        {
          ...result.snapshot,
          mode: result.mode,
          flipTurn: result.flipTurn,
          sectorsScanned: result.sectorsScanned,
          sectorsIncluded: result.sectorsIncluded,
          buildFlow: result.buildFlow,
          buildFlowSinceTurn: result.buildFlowSinceTurn,
        },
        null,
        2
      );
      if (jsonPath) {
        writeFileSync(jsonPath, blob);
        console.log(`\nJSON written to ${jsonPath}`);
      } else {
        console.log(`\n${blob}`);
      }
    }
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
