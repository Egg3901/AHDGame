/**
 * Legislation Simulation Script
 *
 * Simulates the effects of legislation types on state metrics over time.
 * Run with: npm run simulate
 *
 * Usage:
 *   npm run simulate                    # Run full simulation
 *   npm run simulate -- --metric=recidivismRate  # Focus on specific metric
 *   npm run simulate -- --turns=20      # Simulate 20 turns
 */

import { legislationTypes } from "./seeds/legislationTypes";
import { metricCategories } from "./seeds/metricDefinitions";
import {
  POLICY_TAU,
  MAX_EFFECT_PER_LAW,
  FEDERAL_MULTIPLIER,
  getPolicyDecayFactor,
} from "../shared/constants/formulas";

interface SimulatedPolicy {
  legislationTypeId: string;
  effectDirection: number; // -1, 0, or 1
  scope: "state" | "federal";
}

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg?.split("=")[1];
};

const focusMetric = getArg("metric");
const numTurns = parseInt(getArg("turns") || "12", 10);

console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║           LEGISLATION EFFECTS SIMULATION                     ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

// Find all legislation types that affect a given metric
function findLegislationForMetric(categoryId: string, metricId: string) {
  return legislationTypes.filter((lt) => {
    // Check weighted targets
    if (lt.effectTargetsWeighted?.length) {
      return lt.effectTargetsWeighted.some(
        (t) => t.metricCategoryId === categoryId && t.metricId === metricId
      );
    }
    // Check legacy single target
    if (lt.effectTarget) {
      return (
        lt.effectTarget.metricCategoryId === categoryId && lt.effectTarget.metricId === metricId
      );
    }
    return false;
  });
}

// Get the weight for a metric in a legislation type
function getMetricWeight(
  lt: (typeof legislationTypes)[0],
  categoryId: string,
  metricId: string
): number {
  if (lt.effectTargetsWeighted?.length) {
    const target = lt.effectTargetsWeighted.find(
      (t) => t.metricCategoryId === categoryId && t.metricId === metricId
    );
    return target?.weight ?? 0;
  }
  if (lt.effectTarget?.metricCategoryId === categoryId && lt.effectTarget?.metricId === metricId) {
    return 1.0;
  }
  return 0;
}

// Calculate policy contribution to target
function calculatePolicyContribution(
  policyStrength: number, // -3 to +3
  weight: number, // 0.0 to 1.0
  scopeMultiplier: number, // 1.0 for state, FEDERAL_MULTIPLIER for federal
  isHigherBetter: boolean
): number {
  const normalizedStrength = policyStrength / 3; // -1 to +1
  const effectSign = isHigherBetter ? 1 : -1;
  return normalizedStrength * weight * MAX_EFFECT_PER_LAW * scopeMultiplier * effectSign;
}

// Apply exponential decay
function applyDecay(current: number, target: number): number {
  const decayFactor = getPolicyDecayFactor(POLICY_TAU);
  return current + (target - current) * decayFactor;
}

// Calculate target for a set of policies
function calculateTarget(
  categoryId: string,
  metricId: string,
  baseline: number,
  isHigherBetter: boolean,
  policies: SimulatedPolicy[]
): number {
  let totalContribution = 0;
  for (const policy of policies) {
    const lt = legislationTypes.find((l) => l._id === policy.legislationTypeId);
    if (!lt) continue;

    const weight = getMetricWeight(lt, categoryId, metricId);

    if (weight > 0) {
      const scopeMult = policy.scope === "federal" ? FEDERAL_MULTIPLIER : 1.0;
      const contribution = calculatePolicyContribution(
        policy.effectDirection * 3, // Scale to -3 to +3
        weight,
        scopeMult,
        isHigherBetter
      );
      totalContribution += contribution;
    }
  }

  return Math.max(0, Math.min(100, baseline + totalContribution));
}

// Simulate metric changes over time
function simulateMetricOverTime(
  categoryId: string,
  metricId: string,
  baseline: number,
  isHigherBetter: boolean,
  policies: SimulatedPolicy[],
  turns: number
): void {
  let current = baseline;
  const target = calculateTarget(categoryId, metricId, baseline, isHigherBetter, policies);

  console.log(
    `\n  Baseline: ${baseline.toFixed(1)} → Target: ${target.toFixed(1)} (${isHigherBetter ? "↑ better" : "↓ better"})`
  );
  console.log(`  Turn-by-turn progression:`);

  for (let turn = 1; turn <= turns; turn++) {
    const prev = current;
    current = applyDecay(current, target);
    const change = current - prev;
    const changeStr = change >= 0 ? `+${change.toFixed(2)}` : change.toFixed(2);
    const progress = ((current - baseline) / (target - baseline)) * 100 || 0;

    console.log(
      `    Turn ${turn.toString().padStart(2)}: ${current.toFixed(2)} (${changeStr}) [${progress.toFixed(0)}% to target]`
    );
  }
}

// Simulate policy reversal (left → center midway)
function simulatePolicyReversal(
  categoryId: string,
  metricId: string,
  baseline: number,
  isHigherBetter: boolean,
  policies: SimulatedPolicy[],
  turns: number
): void {
  let current = baseline;
  const halfwayTurn = Math.floor(turns / 2);

  // Phase 1: Left-leaning policies
  const leftTarget = calculateTarget(categoryId, metricId, baseline, isHigherBetter, policies);
  // Phase 2: Center policies (effectDirection = 0, so target = baseline)
  const centerTarget = baseline;

  console.log(
    `\n  Phase 1 (turns 1-${halfwayTurn}): Left policies → Target: ${leftTarget.toFixed(1)}`
  );
  console.log(
    `  Phase 2 (turns ${halfwayTurn + 1}-${turns}): Center policies → Target: ${centerTarget.toFixed(1)} (baseline)`
  );
  console.log(`  Turn-by-turn progression:`);

  for (let turn = 1; turn <= turns; turn++) {
    const prev = current;
    const target = turn <= halfwayTurn ? leftTarget : centerTarget;
    current = applyDecay(current, target);
    const change = current - prev;
    const changeStr = change >= 0 ? `+${change.toFixed(2)}` : change.toFixed(2);

    const phase = turn <= halfwayTurn ? "→ left target" : "→ baseline";
    console.log(
      `    Turn ${turn.toString().padStart(3)}: ${current.toFixed(2)} (${changeStr}) ${phase}`
    );
  }

  console.log(
    `\n  Summary: Started at ${baseline.toFixed(1)}, peaked around turn ${halfwayTurn}, ended at ${current.toFixed(2)}`
  );
}

// Main simulation
console.log("Configuration:");
console.log(`  POLICY_TAU (decay constant): ${POLICY_TAU} turns`);
console.log(`  MAX_EFFECT_PER_LAW: ${MAX_EFFECT_PER_LAW} points`);
console.log(`  FEDERAL_MULTIPLIER: ${(FEDERAL_MULTIPLIER * 100).toFixed(1)}%`);
console.log(`  Simulation turns: ${numTurns}`);
console.log("");

// If focusing on a specific metric, analyze it
if (focusMetric) {
  console.log(`\n═══ ANALYZING METRIC: ${focusMetric} ═══\n`);

  // Find the metric definition
  let metricDef: { id: string; name: string; isHigherBetter: boolean } | undefined;
  let categoryId: string | undefined;

  for (const cat of metricCategories) {
    const m = cat.metrics.find((m) => m.id === focusMetric);
    if (m) {
      metricDef = m;
      categoryId = cat.id;
      break;
    }
  }

  if (!metricDef || !categoryId) {
    console.error(`Metric "${focusMetric}" not found!`);
    process.exit(1);
  }

  console.log(`Metric: ${metricDef.name}`);
  console.log(`Category: ${categoryId}`);
  console.log(`Higher is better: ${metricDef.isHigherBetter}`);

  // Find legislation that affects this metric
  const affecting = findLegislationForMetric(categoryId, focusMetric);

  console.log(`\nLegislation types that affect ${focusMetric}:`);
  if (affecting.length === 0) {
    console.log("  (none found - consider adding legislation for this metric)");
  } else {
    for (const lt of affecting) {
      const weight = getMetricWeight(lt, categoryId, focusMetric);
      const scope = lt.nationalOnly ? "national" : lt.allowedScope || "both";
      console.log(`  • ${lt.name} (${lt._id})`);
      console.log(`    Weight: ${weight}, Scope: ${scope}`);

      if (lt.policyOptions?.length) {
        const leftOpt = lt.policyOptions.find(
          (o) => o.stance === "left" && o.effectDirection !== 0
        );
        const rightOpt = lt.policyOptions.find(
          (o) => o.stance === "right" && o.effectDirection !== 0
        );
        if (leftOpt)
          console.log(`    Left option: "${leftOpt.name}" (effect: ${leftOpt.effectDirection})`);
        if (rightOpt)
          console.log(`    Right option: "${rightOpt.name}" (effect: ${rightOpt.effectDirection})`);
      }
    }
  }

  // Simulate with different policy combinations
  console.log(`\n═══ SIMULATION SCENARIOS ═══`);

  const baseline = 42; // Average tier 3 value for recidivism

  if (affecting.length > 0) {
    // Scenario 1: Single left-leaning state policy
    console.log(`\n[Scenario 1] Single left-leaning state ${affecting[0].name}:`);
    simulateMetricOverTime(
      categoryId,
      focusMetric,
      baseline,
      metricDef.isHigherBetter,
      [{ legislationTypeId: affecting[0]._id, effectDirection: 1, scope: "state" }],
      numTurns
    );

    // Scenario 2: Single right-leaning state policy
    console.log(`\n[Scenario 2] Single right-leaning state ${affecting[0].name}:`);
    simulateMetricOverTime(
      categoryId,
      focusMetric,
      baseline,
      metricDef.isHigherBetter,
      [{ legislationTypeId: affecting[0]._id, effectDirection: -1, scope: "state" }],
      numTurns
    );

    // Scenario 3: Federal policy
    if (!affecting[0].allowedScope || affecting[0].allowedScope !== "state") {
      console.log(`\n[Scenario 3] Federal ${affecting[0].name} (left-leaning):`);
      simulateMetricOverTime(
        categoryId,
        focusMetric,
        baseline,
        metricDef.isHigherBetter,
        [{ legislationTypeId: affecting[0]._id, effectDirection: 1, scope: "federal" }],
        numTurns
      );
    }

    // Scenario 4: Multiple complementary policies
    if (affecting.length > 1) {
      console.log(`\n[Scenario 4] Multiple policies (all left-leaning):`);
      simulateMetricOverTime(
        categoryId,
        focusMetric,
        baseline,
        metricDef.isHigherBetter,
        affecting.slice(0, 3).map((lt) => ({
          legislationTypeId: lt._id,
          effectDirection: 1,
          scope: lt.nationalOnly ? ("federal" as const) : ("state" as const),
        })),
        numTurns
      );

      // Scenario 5: Policy reversal (left → center halfway through)
      console.log(`\n[Scenario 5] POLICY REVERSAL - Left policies for half, then center:`);
      simulatePolicyReversal(
        categoryId,
        focusMetric,
        baseline,
        metricDef.isHigherBetter,
        affecting.slice(0, 3).map((lt) => ({
          legislationTypeId: lt._id,
          effectDirection: 1,
          scope: lt.nationalOnly ? ("federal" as const) : ("state" as const),
        })),
        numTurns
      );
    }
  }
} else {
  // Default: Show overview of all metrics and their legislation coverage
  console.log("═══ LEGISLATION COVERAGE BY METRIC ═══\n");

  for (const category of metricCategories) {
    console.log(`\n${category.name.toUpperCase()} (${category.id}):`);
    console.log("─".repeat(50));

    for (const metric of category.metrics) {
      const affecting = findLegislationForMetric(category.id, metric.id);
      const coverage = affecting.length;
      const coverageIcon = coverage === 0 ? "⚠️ " : coverage < 2 ? "⚡" : "✓ ";

      console.log(`  ${coverageIcon} ${metric.name} (${metric.id})`);
      console.log(`     ${coverage} legislation type(s) affect this metric`);

      if (coverage > 0) {
        for (const lt of affecting.slice(0, 2)) {
          const weight = getMetricWeight(lt, category.id, metric.id);
          console.log(`       - ${lt.name} (weight: ${weight})`);
        }
        if (coverage > 2) {
          console.log(`       ... and ${coverage - 2} more`);
        }
      }
    }
  }

  // Summary
  console.log("\n═══ COVERAGE SUMMARY ═══");
  let uncovered = 0;
  let lowCoverage = 0;
  let goodCoverage = 0;

  for (const category of metricCategories) {
    for (const metric of category.metrics) {
      const count = findLegislationForMetric(category.id, metric.id).length;
      if (count === 0) uncovered++;
      else if (count < 2) lowCoverage++;
      else goodCoverage++;
    }
  }

  console.log(`  ✓  Good coverage (2+ laws): ${goodCoverage} metrics`);
  console.log(`  ⚡ Low coverage (1 law): ${lowCoverage} metrics`);
  console.log(`  ⚠️  No coverage (0 laws): ${uncovered} metrics`);

  console.log("\nRun with --metric=<metricId> to simulate a specific metric.");
  console.log("Example: npm run simulate -- --metric=recidivismRate");
}

console.log("\n═══ SIMULATION COMPLETE ═══\n");
