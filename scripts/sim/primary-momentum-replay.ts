/**
 * Primary momentum replay — a read-only harness that models the stretched
 * six-wave calendar and shows how expectation-beating momentum accumulates,
 * decays, and moves delegates across candidate momentum caps {0, 2, 4, 6}.
 *
 * This is NOT a unit test and touches no DB. It reproduces the momentum math
 * in `primaryStaggerPhase.ts` (momentumMultiplier + decay/accumulate) over a
 * synthetic field so we can eyeball the lever before it is calibrated at t384.
 *
 * At cap 0 the multiplier is exactly 1 and every accumulated value is 0 — the
 * ship identity. Higher caps let a candidate who over-performs early carry a
 * vote bump into later waves; the report shows whether that snowballs or stays
 * proportionate.
 *
 * Run: npx tsx scripts/sim/primary-momentum-replay.ts
 */

import { PRIMARY_WAVES_STRETCHED, STRETCHED_SCHEDULE } from "@/lib/constants/primaryCalendar";
import { momentumMultiplier } from "@/lib/turn/primaryStaggerPhase";
import { presidentialRulesetFor } from "@/lib/elections/presidentialRuleset";

const DECAY = presidentialRulesetFor({ rulesetVersion: 3 }).primaryMomentumDecay; // 0.5

function clampTo(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

interface SimCandidate {
  id: string;
  /**
   * Baseline projected national share (points, sums to 100 across the field).
   * The "expected" the momentum system measures against each wave.
   */
  projectedShare: number;
  /**
   * Intrinsic per-wave over/under-performance (points) BEFORE any momentum
   * carry — the candidate's real strength vs the projection this wave. Positive
   * means they naturally beat expectations.
   */
  waveEdge: number[];
}

// Three-way field: a front-runner, a momentum surger who over-performs in the
// early small-state waves, and a fader who under-performs.
const FIELD: SimCandidate[] = [
  { id: "Front", projectedShare: 45, waveEdge: [-1, -1, -2, -1, 0, 0] },
  { id: "Surge", projectedShare: 30, waveEdge: [+8, +7, +6, +2, +1, 0] },
  { id: "Fade", projectedShare: 25, waveEdge: [-7, -6, -4, -1, -1, 0] },
];

// Rough per-wave delegate pools (sums across the six stretched waves). Early
// waves are small (IA/NH), the Super-Tuesday-equivalent wave is large.
const WAVE_DELEGATES = [41, 24, 90, 1500, 900, 1424];

interface WaveOutcome {
  waveIndex: number;
  turnsRemaining: number;
  multiplier: Record<string, number>;
  actualShare: Record<string, number>;
  momentumBefore: Record<string, number>;
  momentumAfter: Record<string, number>;
  delegates: Record<string, number>;
}

function runReplay(cap: number): {
  outcomes: WaveOutcome[];
  totalDelegates: Record<string, number>;
} {
  const momentum: Record<string, number> = Object.fromEntries(FIELD.map((c) => [c.id, 0]));
  const totalDelegates: Record<string, number> = Object.fromEntries(FIELD.map((c) => [c.id, 0]));
  const outcomes: WaveOutcome[] = [];

  for (let w = 0; w < PRIMARY_WAVES_STRETCHED.length; w++) {
    const wave = PRIMARY_WAVES_STRETCHED[w];
    const momentumBefore = { ...momentum };

    // Expected votes this wave: the flat projected share (proxy for aggregating
    // the projection across the wave's states).
    const expected: Record<string, number> = {};
    for (const c of FIELD) expected[c.id] = c.projectedShare;

    // Actual votes this wave: projected share + intrinsic edge, then multiplied
    // by the momentum carried IN from prior waves (momentumMultiplier).
    const multiplier: Record<string, number> = {};
    const actualRaw: Record<string, number> = {};
    for (const c of FIELD) {
      const mult = momentumMultiplier(momentumBefore[c.id], cap);
      multiplier[c.id] = mult;
      actualRaw[c.id] = Math.max(0, (c.projectedShare + c.waveEdge[w]) * mult);
    }

    const expTotal = Object.values(expected).reduce((s, v) => s + v, 0);
    const actTotal = Object.values(actualRaw).reduce((s, v) => s + v, 0);

    const actualShare: Record<string, number> = {};
    const delegates: Record<string, number> = {};
    for (const c of FIELD) {
      const expShare = expTotal > 0 ? (expected[c.id] / expTotal) * 100 : 0;
      const actShare = actTotal > 0 ? (actualRaw[c.id] / actTotal) * 100 : 0;
      actualShare[c.id] = actShare;

      // Momentum update: clamp the beat/miss to +-cap, decay-and-add.
      const momentumC = clampTo(actShare - expShare, -cap, cap);
      momentum[c.id] = clampTo(momentumBefore[c.id] * DECAY + momentumC, -cap, cap);

      // Proportional delegate allocation for the report.
      const del = Math.round((actShare / 100) * WAVE_DELEGATES[w]);
      delegates[c.id] = del;
      totalDelegates[c.id] += del;
    }

    outcomes.push({
      waveIndex: w,
      turnsRemaining: wave.turnsRemaining,
      multiplier,
      actualShare,
      momentumBefore,
      momentumAfter: { ...momentum },
      delegates,
    });
  }

  return { outcomes, totalDelegates };
}

function fmtRow(label: string, values: Record<string, number>, digits = 1): string {
  const cells = FIELD.map((c) => `${c.id}=${values[c.id].toFixed(digits)}`).join("  ");
  return `    ${label.padEnd(16)} ${cells}`;
}

function main(): void {
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log("  Primary momentum replay — stretched calendar");
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log(
    `  Waves: ${PRIMARY_WAVES_STRETCHED.length}  spacing (turnsRemaining): ${PRIMARY_WAVES_STRETCHED.map((w) => w.turnsRemaining).join(", ")}`
  );
  console.log(`  Stagger window: ${STRETCHED_SCHEDULE.windowTurns} turns`);
  console.log(`  Momentum decay: ${DECAY}`);
  console.log(`  Field: ${FIELD.map((c) => `${c.id}(proj ${c.projectedShare}%)`).join(", ")}`);

  const baselineTotals: Record<string, Record<string, number>> = {};

  for (const cap of [0, 2, 4, 6]) {
    console.log("\n──────────────────────────────────────────────────────────────────────");
    console.log(
      `  primaryMomentumCapPoints = ${cap}${cap === 0 ? "  (SHIP IDENTITY — multiplier is exactly 1)" : ""}`
    );
    console.log("──────────────────────────────────────────────────────────────────────");

    const { outcomes, totalDelegates } = runReplay(cap);
    baselineTotals[cap] = totalDelegates;

    for (const o of outcomes) {
      console.log(`\n  Wave ${o.waveIndex + 1} (T-${o.turnsRemaining})`);
      console.log(fmtRow("multiplier x", o.multiplier, 3));
      console.log(fmtRow("actual share %", o.actualShare));
      console.log(fmtRow("momentum ->", o.momentumAfter, 2));
      console.log(fmtRow("delegates", o.delegates, 0));
    }

    console.log("");
    console.log(fmtRow("TOTAL delegates", totalDelegates, 0));

    if (cap !== 0) {
      const deltas: Record<string, number> = {};
      for (const c of FIELD) {
        deltas[c.id] = totalDelegates[c.id] - baselineTotals[0][c.id];
      }
      console.log(fmtRow("delta vs cap0", deltas, 0));
    }
  }

  console.log("\n══════════════════════════════════════════════════════════════════════");
  console.log("  Read: at cap 0 every multiplier is 1.000 and momentum stays 0.00 — the");
  console.log("  delegate totals ARE the no-momentum baseline. Higher caps reward the");
  console.log("  early over-performer (Surge) with carried vote bumps; the delta rows");
  console.log("  show how many delegates momentum moves before it is calibrated.");
  console.log("══════════════════════════════════════════════════════════════════════");
}

main();
