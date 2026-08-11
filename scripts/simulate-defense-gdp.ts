/**
 * Defense Spending GDP Recovery Simulation
 *
 * Demonstrates the time-based decay of GDP effects when defense spending is cut.
 * The economy adapts over time, reducing the negative GDP impact.
 *
 * Shows both the moving TARGET and the ACTUAL GDP value as it decays toward target.
 */

import {
  applyHalfLifeDecay,
  MAX_EFFECT_PER_LAW,
  FEDERAL_MULTIPLIER,
  getPolicyDecayFactor,
  POLICY_TAU,
} from "../shared/constants/formulas";
import { legislationTypes } from "./seeds/legislationTypes";

// Find defense spending legislation
const defenseSpending = legislationTypes.find((lt) => lt._id === "defense_spending");
if (!defenseSpending) {
  console.log("Defense spending not found");
  process.exit(1);
}

console.log("╔══════════════════════════════════════════════════════════════════════╗");
console.log("║     DEFENSE SPENDING GDP RECOVERY SIMULATION (960 turns)            ║");
console.log("╚══════════════════════════════════════════════════════════════════════╝\n");

console.log("Policy: Major cuts; shift to domestic priorities (effectDirection: -1)");
console.log("");

// Get the GDP effect target
const gdpTarget = defenseSpending.effectTargetsWeighted?.find((t) => t.metricId === "gdpGrowth");
const budgetTarget = defenseSpending.effectTargetsWeighted?.find(
  (t) => t.metricId === "budgetBalance"
);

console.log("Effect Targets:");
console.log(`  Budget Balance: weight=${budgetTarget?.weight} (negative = inverse relationship)`);
console.log(
  `  GDP Growth: weight=${gdpTarget?.weight}, adjustmentHalfLife=${gdpTarget?.adjustmentHalfLife} turns`
);
console.log("");

// Simulation parameters
// GDP Growth metric: 0-100 scale
// This state has a natural GDP growth baseline of 53 (representing 3% growth)
// The policy temporarily disrupts this, but economy adapts back
const baseline = 53; // State's baseline GDP growth metric (natural 3% growth)
const startingGDP = 53; // Starting at baseline
const effectDirection = -1; // Major cuts
const halfLife = gdpTarget?.adjustmentHalfLife || 960;

// Calculate base contribution (without decay)
const normalizedStrength = (effectDirection * 3) / 3; // -1
const scopeMultiplier = FEDERAL_MULTIPLIER;
const weight = Math.abs(gdpTarget?.weight || 0.4);
const isHigherBetter = true; // For GDP, higher is better

// Base contribution = normalizedStrength * weight * MAX_EFFECT * scopeMultiplier * effectSign
const baseContribution =
  normalizedStrength * weight * MAX_EFFECT_PER_LAW * scopeMultiplier * (isHigherBetter ? 1 : -1);

console.log("Calculation:");
console.log(`  State baseline GDP metric: ${baseline}`);
console.log(`  Starting GDP (before policy): ${startingGDP} (representing ~3% growth)`);
console.log(`  Base GDP contribution from policy: ${baseContribution.toFixed(2)} points`);
console.log(
  `  Half-life for economic adaptation: ${halfLife} turns (~${(halfLife / 48).toFixed(0)} game years)`
);
console.log(`  Policy decay tau: ${POLICY_TAU} turns (how fast actual value approaches target)`);
console.log("");

// Simulate actual GDP changes over time
console.log("═══ ACTUAL GDP VALUE SIMULATION ═══");
console.log("Starting GDP: " + startingGDP + " (3% growth)");
console.log("─".repeat(85));
console.log("  Turn  │  Years │  Target │  Actual GDP │  Change  │ vs Start │ Effect Decay");
console.log("─".repeat(85));

const decayFactor = getPolicyDecayFactor(POLICY_TAU);
let actualGDP = startingGDP;

// Simulate turn by turn for key checkpoints
const checkpoints = [
  0, 1, 2, 4, 8, 12, 24, 48, 96, 192, 384, 480, 768, 960, 1200, 1440, 1920, 2400, 2880,
];

for (const turn of checkpoints) {
  // Calculate decayed contribution at this turn (effect weakens as economy adapts)
  const adaptationMultiplier = applyHalfLifeDecay(1, turn, halfLife);
  const currentContribution = baseContribution * adaptationMultiplier;

  // The target at this turn (baseline + decayed contribution)
  const target = baseline + currentContribution;

  // For turn 0, set initial; otherwise simulate decay toward target
  if (turn === 0) {
    // At turn 0, the policy just passed - GDP hasn't moved yet
    actualGDP = startingGDP;
  } else {
    // Simulate all turns up to this checkpoint
    const prevCheckpoint = checkpoints[checkpoints.indexOf(turn) - 1] || 0;
    for (let t = prevCheckpoint + 1; t <= turn; t++) {
      const tAdaptation = applyHalfLifeDecay(1, t, halfLife);
      const tContribution = baseContribution * tAdaptation;
      const tTarget = baseline + tContribution;
      // Apply exponential decay toward target each turn
      actualGDP = actualGDP + (tTarget - actualGDP) * decayFactor;
    }
  }

  const years = (turn / 48).toFixed(1);
  const change = actualGDP - startingGDP;
  const changeStr = change >= 0 ? `+${change.toFixed(2)}` : change.toFixed(2);
  const pctDecay = ((1 - adaptationMultiplier) * 100).toFixed(0);

  console.log(
    `  ${turn.toString().padStart(4)}  │ ${years.padStart(6)} │ ${target.toFixed(2).padStart(7)} │ ${actualGDP.toFixed(2).padStart(11)} │ ${changeStr.padStart(8)} │ ${changeStr.padStart(8)} │ ${pctDecay.padStart(5)}% adapted`
  );
}

console.log("─".repeat(85));

// Calculate key milestones
const initialDrop = baseContribution;
const _finalTarget = baseline + baseContribution * applyHalfLifeDecay(1, 1920, halfLife);

console.log("");
console.log("═══ SUMMARY ═══");
console.log("");
console.log(`Starting GDP: ${startingGDP.toFixed(2)} (3% growth above baseline)`);
console.log(`Lowest target: ${(baseline + baseContribution).toFixed(2)} (immediate policy impact)`);
console.log(`Final actual GDP at turn 1920: ${actualGDP.toFixed(2)}`);
console.log("");
console.log("Key observations:");
console.log(`  • Immediate target drop: ${initialDrop.toFixed(2)} points (defense cuts hurt GDP)`);
console.log(`  • Actual GDP takes time to fall (exponential decay toward target)`);
console.log(`  • Lowest point around year 4-5 as economy begins adapting`);
console.log(`  • As economy adapts, target rises back toward baseline`);
console.log(`  • After 240 turns (~5 years): Half-life reached, 50% adapted`);
console.log(`  • After 1920 turns (~40 years): ~100% adapted, GDP returns to baseline`);
console.log("");

const budgetContribution = Math.abs(
  normalizedStrength * Math.abs(budgetTarget?.weight || 1.0) * MAX_EFFECT_PER_LAW * scopeMultiplier
);
console.log("Budget Balance (no decay - permanent effect):");
console.log(
  `  Permanent benefit: +${budgetContribution.toFixed(2)} points (less spending = better balance)`
);
console.log("");

// Simulate policy reversal scenario
console.log("═══ POLICY REVERSAL SCENARIO ═══");
console.log("What happens if defense spending is INCREASED after 10 years of cuts?");
console.log("");

const reversalTurn = 480; // After 10 years
let reversalGDP = actualGDP; // GDP at the time of reversal (need to recalculate)

// Recalculate GDP at reversal point
let simGDP = startingGDP;
for (let t = 1; t <= reversalTurn; t++) {
  const tAdaptation = applyHalfLifeDecay(1, t, halfLife);
  const tContribution = baseContribution * tAdaptation;
  const tTarget = baseline + tContribution;
  simGDP = simGDP + (tTarget - simGDP) * decayFactor;
}
reversalGDP = simGDP;

console.log(`At turn ${reversalTurn} (~10 years), GDP is at ${reversalGDP.toFixed(2)}`);
console.log("New policy: Major buildup (effectDirection: +1)");
console.log("");

// Now simulate with INCREASED defense spending (effectDirection: +1)
// The old policy is replaced, enactedTurn resets to current turn
const newEffectDirection = 1; // Increase spending
const newBaseContribution =
  ((newEffectDirection * 3) / 3) *
  weight *
  MAX_EFFECT_PER_LAW *
  scopeMultiplier *
  (isHigherBetter ? 1 : -1);

console.log("New effect calculation:");
console.log(
  `  Budget Balance: Now DECREASES by ${budgetContribution.toFixed(2)} points (more spending = worse balance)`
);
console.log(
  `  GDP Growth: Now INCREASES, base contribution: +${newBaseContribution.toFixed(2)} points`
);
console.log("");

console.log("GDP trajectory after reversal:");
console.log("─".repeat(70));

const reversalCheckpoints = [0, 48, 96, 192, 384, 480, 768, 960];
let postReversalGDP = reversalGDP;

for (const turnsAfterReversal of reversalCheckpoints) {
  const totalTurn = reversalTurn + turnsAfterReversal;

  // New policy effect decays from the reversal point
  const newAdaptation = applyHalfLifeDecay(1, turnsAfterReversal, halfLife);
  const newContribution = newBaseContribution * newAdaptation;
  const newTarget = baseline + newContribution;

  if (turnsAfterReversal === 0) {
    postReversalGDP = reversalGDP;
  } else {
    // Simulate turns after reversal
    const prevCP = reversalCheckpoints[reversalCheckpoints.indexOf(turnsAfterReversal) - 1] || 0;
    for (let t = prevCP + 1; t <= turnsAfterReversal; t++) {
      const tAdapt = applyHalfLifeDecay(1, t, halfLife);
      const tContrib = newBaseContribution * tAdapt;
      const tTgt = baseline + tContrib;
      postReversalGDP = postReversalGDP + (tTgt - postReversalGDP) * decayFactor;
    }
  }

  const _yearsAfter = (turnsAfterReversal / 48).toFixed(1);
  const totalYears = (totalTurn / 48).toFixed(1);
  const vsStart = postReversalGDP - startingGDP;
  const vsStartStr = vsStart >= 0 ? `+${vsStart.toFixed(2)}` : vsStart.toFixed(2);

  console.log(
    `  +${turnsAfterReversal.toString().padStart(3)} turns (yr ${totalYears.padStart(5)}): ` +
      `Target ${newTarget.toFixed(2).padStart(6)} → Actual ${postReversalGDP.toFixed(2).padStart(6)} (${vsStartStr} vs original)`
  );
}

console.log("");
console.log("Key takeaway:");
console.log("  • Reversing the policy (increasing spending) pushes GDP target UP");
console.log("  • GDP begins recovering toward the new higher target");
console.log("  • Budget balance LOSES its bonus when spending increases");
console.log("");
console.log("═══ SIMULATION COMPLETE ═══");
