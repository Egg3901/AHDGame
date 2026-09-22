/**
 * Cabinet residual soft saturation: balance report for issue #703.
 *
 * The hard per-source clamp (`CABINET_RESIDUAL_CAP_PER_SOURCE = 8`,
 * `CABINET_RESIDUAL_DECAY = 0.9`) gave a steady state of `10 x contribution`
 * pinned at 8, so any channel at or above 0.8/turn saturated: further
 * investment bought exactly zero and pinned regions rendered identical values.
 * The fold now accumulates in an unbounded latent and maps through a smooth
 * saturating curve with the same value as its asymptote.
 *
 * Deterministic: pure rules functions only, no database, no randomness, no
 * wall clock, no worldsim. Run from the repository with:
 *
 *   npx tsx scripts/sim/cabinetResidualSaturation2026-09-17.ts
 */
import {
  CABINET_RESIDUAL_CAP_PER_SOURCE,
  CABINET_RESIDUAL_DECAY,
  foldCabinetResiduals,
  foldCabinetResidualsBySource,
  seedBySourceFromLegacy,
  sumCabinetResiduals,
} from "../../src/lib/politicalMetrics/cabinetResidual";

const CAP = CABINET_RESIDUAL_CAP_PER_SOURCE;
const TURNS = 3000;
const METRIC = "order.safety";

const foldToSteady = (contribution: number, turns = TURNS): number => {
  let r: Record<string, number> = {};
  for (let i = 0; i < turns; i++) r = foldCabinetResiduals(r, { [METRIC]: contribution });
  return r[METRIC] ?? 0;
};

/** Old behaviour, for the comparison column: 10x contribution, hard-pinned. */
const oldClampSteady = (contribution: number): number =>
  Math.min(Math.abs(contribution) / (1 - CABINET_RESIDUAL_DECAY), CAP);

const fail = (message: string): never => {
  throw new Error(`cabinet-residual-saturation: ${message}`);
};

// A. Representative contribution rates: old clamp vs new steady state.
const RATES = [0.2, 0.4, 0.8, 0.9, 1.8, 3.6, 8];
const steadyRows = RATES.map((c) => ({
  contribution: c,
  old: oldClampSteady(c),
  soft: foldToSteady(c),
}));
for (const row of steadyRows) {
  if (!(row.soft > 0 && row.soft < CAP))
    fail(`steady state out of bounds at ${row.contribution}/turn`);
}
for (let i = 1; i < steadyRows.length; i++) {
  if (!(steadyRows[i].soft > steadyRows[i - 1].soft)) fail("steady state not strictly increasing");
}

// B. Marginal effect: strictly positive everywhere, diminishing with level.
const marginalGain = (level: number, push: number): number => {
  const pushed = foldCabinetResiduals({ [METRIC]: level }, { [METRIC]: push })[METRIC] ?? 0;
  const decayed = foldCabinetResiduals({ [METRIC]: level }, {})[METRIC] ?? 0;
  return pushed - decayed;
};
const PUSH = 0.5;
const LEVELS = [0, 1, 3, 5, 7];
const marginalRows = LEVELS.map((level) => ({ level, gain: marginalGain(level, PUSH) }));
for (const row of marginalRows) {
  if (!(row.gain > 0)) fail(`non-positive marginal gain at level ${row.level}`);
}
for (let i = 1; i < marginalRows.length; i++) {
  if (!(marginalRows[i].gain < marginalRows[i - 1].gain)) fail("marginal gain not diminishing");
}

// C. Regional distribution: eight regions holding a Tier-2 field office at
// enhanced funding (0.9/turn at condition 90), spread over conditions 80-95.
// Under the old clamp every one of these pinned at exactly 8.0.
const CONDITIONS = [80, 82, 85, 87, 90, 92, 94, 95];
const regionRows = CONDITIONS.map((condition) => {
  const contribution = (0.9 * condition) / 90;
  return {
    condition,
    contribution,
    old: oldClampSteady(contribution),
    soft: foldToSteady(contribution),
  };
});
for (const row of regionRows) {
  if (!(row.soft < CAP)) fail("region reached the asymptote");
}
const softValues = regionRows.map((r) => r.soft);
for (let i = 1; i < softValues.length; i++) {
  if (!(softValues[i] - softValues[i - 1] > 0.01)) fail("two regions collapsed onto one value");
}
const regionSpread = Math.max(...softValues) - Math.min(...softValues);

// D. Multi-source stacking: a saturated orders channel plus a fresh estate.
let saturated: Record<string, Record<string, number>> = {};
for (let i = 0; i < 2000; i++) {
  saturated = foldCabinetResidualsBySource(saturated, { orders: { [METRIC]: 5 } });
}
const ordersAlone = sumCabinetResiduals(saturated)[METRIC] ?? 0;
const stacked = foldCabinetResidualsBySource(saturated, {
  orders: { [METRIC]: 5 },
  estates: { [METRIC]: 1.5 },
});
const stackedTotal = sumCabinetResiduals(stacked)[METRIC] ?? 0;
const estateChannel = stacked.estates[METRIC] ?? 0;
if (!(stackedTotal > ordersAlone)) fail("estate added nothing on top of a saturated channel");
if (!(estateChannel > 1.4 && estateChannel < 1.5))
  fail(`fresh estate landed at ${estateChannel}, expected just under 1.5`);

// E. Decay stability: a legacy hard pin drains monotonically, small residuals
// fade on the old ~20-turn schedule.
let pinned: Record<string, number> = { [METRIC]: 8 };
let prevPinned = 8;
for (let i = 0; i < 100; i++) {
  pinned = foldCabinetResiduals(pinned, {});
  const v = pinned[METRIC] ?? 0;
  // Stored values quantize to 4dp and drop below 0.01, so strict decrease
  // holds while above the storage floor; below it the key is simply gone.
  if (v >= 0.01 && !(v < prevPinned)) fail("pinned residual did not drain monotonically");
  if (!(v <= prevPinned)) fail("pinned residual increased while draining");
  prevPinned = v;
}
if (!((pinned[METRIC] ?? 0) < 0.1)) fail("pinned residual did not wash out");
let small: Record<string, number> = { [METRIC]: 1 };
let prevSmall = 1;
for (let i = 0; i < 40; i++) {
  small = foldCabinetResiduals(small, {});
  const v = small[METRIC] ?? 0;
  if (v >= 0.01 && !(v < prevSmall)) fail("small residual did not decay monotonically");
  if (!(v <= prevSmall)) fail("small residual increased while decaying");
  prevSmall = v;
}
if (!((small[METRIC] ?? 0) < 0.1)) fail("small residual did not fade on schedule");

// F. Migration: a doc hard-pinned at 8 with a standing 0.9/turn contribution
// eases onto the curve instead of lurching, then converges to the soft steady.
const seeded = seedBySourceFromLegacy({ [METRIC]: 8 }, { estates: { [METRIC]: 0.9 } });
let migrated = foldCabinetResidualsBySource(seeded, { estates: { [METRIC]: 0.9 } });
const firstTurn = sumCabinetResiduals(migrated)[METRIC] ?? 0;
if (!(firstTurn <= 8 && firstTurn > 7.9)) fail(`first-turn migration value ${firstTurn}`);
for (let i = 0; i < 500; i++) {
  migrated = foldCabinetResidualsBySource(migrated, { estates: { [METRIC]: 0.9 } });
}
const converged = sumCabinetResiduals(migrated)[METRIC] ?? 0;
const expected = foldToSteady(0.9);
if (!(Math.abs(converged - expected) < 0.05))
  fail(`migration converged at ${converged}, expected ${expected}`);

console.log("# Cabinet residual soft saturation (issue #703)\n");
console.log("## A. Steady state by contribution rate");
console.log("| contribution/turn | old hard clamp | soft saturation |");
console.log("|-------------------|----------------|-------------------|");
for (const row of steadyRows) {
  console.log(`| ${row.contribution} | ${row.old.toFixed(1)} | ${row.soft.toFixed(4)} |`);
}
console.log("\n## B. One-step marginal gain of a +0.5 push, by starting level");
console.log("| level | marginal gain |");
console.log("|-------|---------------|");
for (const row of marginalRows) {
  console.log(`| ${row.level} | ${row.gain.toFixed(4)} |`);
}
console.log("\n## C. Eight Tier-2 field-office regions (condition spread)");
console.log("| condition | contribution/turn | old | soft |");
console.log("|-----------|-------------------|-----|------|");
for (const row of regionRows) {
  console.log(
    `| ${row.condition} | ${row.contribution.toFixed(4)} | ${row.old.toFixed(1)} | ${row.soft.toFixed(4)} |`
  );
}
console.log(
  "\n" +
    JSON.stringify(
      {
        asymptote: CAP,
        decay: CABINET_RESIDUAL_DECAY,
        regionSpread: +regionSpread.toFixed(4),
        ordersSaturatedAlone: +ordersAlone.toFixed(4),
        ordersPlusEstate: +stackedTotal.toFixed(4),
        migrationFirstTurn: +firstTurn.toFixed(4),
        migrationConverged: +converged.toFixed(4),
        softSteady09: +expected.toFixed(4),
      },
      null,
      2
    )
);
