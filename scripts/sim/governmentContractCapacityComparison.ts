/**
 * Offline design comparison, not production rules or a balance qualification.
 * Run: npx tsx scripts/sim/governmentContractCapacityComparison.ts
 */
const capacity = 100000;
const share = 0.1;
const scenarios = [0, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 1.5].map((utilization) => {
  const recentDailyOutput = capacity * utilization;
  const capacityAllocation = capacity * share;
  const recentOutputAllocation = Math.min(capacity, recentDailyOutput) * share;
  return {
    capacityDailyUnits: capacity,
    share,
    utilization,
    recentDailyOutput,
    capacityAllocation,
    recentOutputAllocation,
    capacityAllocationFractionOfOutput:
      recentDailyOutput > 0 ? capacityAllocation / recentDailyOutput : null,
    recentOutputAllocationFractionOfOutput:
      recentDailyOutput > 0 ? recentOutputAllocation / recentDailyOutput : null,
    unchangedRoyaltyCostPerAllocatedUnitMultiplier:
      recentOutputAllocation > 0 ? capacityAllocation / recentOutputAllocation : null,
  };
});
const shocks = [0, 0.25, 1, 2].map((afterPublicationOutputMultiplier) => ({
  afterPublicationOutputMultiplier,
  publishedRecentOutputDailyUnits: 10000,
  fixedBaselineAllocationDailyUnits: 1000,
  liveOutputAllocationDailyUnits:
    Math.min(capacity, 10000 * afterPublicationOutputMultiplier) * share,
}));
process.stdout.write(
  JSON.stringify(
    {
      kind: "synthetic-design-comparison",
      productionRulesChanged: false,
      calibratedAgainstWorld: false,
      scenarios,
      shocks,
      findings: [
        "At 10% utilization, a 10% share of capacity equals 100% of recent state output; an output baseline grants 10% of that output.",
        "An output baseline allocates zero rights in an idle state unless an explicit startup fallback is designed.",
        "A fixed publication baseline avoids changing a signed allowance during later output shocks.",
        "Keeping the current capacity-based royalty while shrinking the allocation raises royalty cost per allocated unit.",
        "Changing both allocation and royalty bases changes government revenue and needs economic qualification.",
        "A recent-output baseline needs an averaging window, startup behavior, manipulation resistance, reset coverage and a policy for existing contracts.",
        "These synthetic examples identify tradeoffs; they do not establish that present game capacity is excessive.",
      ],
    },
    null,
    2
  ) + "\n"
);
