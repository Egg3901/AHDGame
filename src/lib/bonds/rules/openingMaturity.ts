import type { BondMaturityTurns } from "@/lib/db/types/bond";

/** Sovereign auctions and fiscal settlement operate on a quarterly cadence. */
export const OPENING_SOVEREIGN_COHORT_INTERVAL_TURNS = 12;

export interface OpeningSovereignMaturityCohort {
  /** Original contractual tenor, used to price the coupon. */
  maturityTurns: BondMaturityTurns;
  /** Historical issue turn relative to the reset turn. */
  issuedAtOffset: number;
  /** Remaining turns from the reset to redemption. */
  maturityOffset: number;
  /** Face amount represented by this cohort. */
  amount: number;
}

function allocateUnitsByWeight(
  units: number,
  weighted: readonly { key: number; weight: number }[]
): Map<number, number> {
  if (!Number.isSafeInteger(units) || units < 0) throw new Error("Invalid opening bond units");
  const eligible = weighted.filter(
    (row) => Number.isFinite(row.weight) && row.weight > 0 && Number.isSafeInteger(row.key)
  );
  const totalWeight = eligible.reduce((sum, row) => sum + row.weight, 0);
  if (!(totalWeight > 0)) return new Map();

  const allocations = eligible.map((row, index) => {
    const exact = (units * row.weight) / totalWeight;
    const floor = Math.floor(exact);
    return { ...row, index, units: floor, remainder: exact - floor };
  });
  let remaining = units - allocations.reduce((sum, row) => sum + row.units, 0);
  allocations
    .slice()
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .forEach((row) => {
      if (remaining <= 0) return;
      allocations[row.index]!.units += 1;
      remaining -= 1;
    });
  return new Map(allocations.map((row) => [row.key, row.units]));
}

/**
 * Convert an opening scalar debt stock into historical quarterly cohorts.
 *
 * A reset begins in the middle of an established debt market. Treating every
 * opening instrument as newly issued on reset day created three artificial
 * maturity cliffs at years one, two, and five. This planner preserves the
 * approved tenor mix while spreading each tenor over the quarterly cohorts
 * that would still be outstanding in an established market.
 *
 * Plain data in, plain data out so the reset seeder and headless simulations
 * use exactly the same allocation and rounding rules.
 */
export function planOpeningSovereignMaturityCohorts(input: {
  totalFace: number;
  faceValue: number;
  distribution: Partial<Record<BondMaturityTurns, number>>;
  intervalTurns?: number;
}): OpeningSovereignMaturityCohort[] {
  const { totalFace, faceValue, distribution } = input;
  const interval = input.intervalTurns ?? OPENING_SOVEREIGN_COHORT_INTERVAL_TURNS;
  if (!Number.isSafeInteger(faceValue) || faceValue <= 0)
    throw new Error("Invalid bond face value");
  if (!Number.isSafeInteger(totalFace) || totalFace < 0)
    throw new Error("Invalid opening debt face");
  if (!Number.isSafeInteger(interval) || interval <= 0)
    throw new Error("Invalid opening cohort interval");

  const totalUnits = Math.floor(totalFace / faceValue);
  if (totalUnits <= 0) return [];
  const termWeights = Object.entries(distribution).map(([term, weight]) => ({
    key: Number(term),
    weight: Number(weight),
  }));
  const unitsByTerm = allocateUnitsByWeight(totalUnits, termWeights);
  const cohorts: OpeningSovereignMaturityCohort[] = [];

  for (const [rawTerm, termUnits] of [...unitsByTerm].sort((a, b) => a[0] - b[0])) {
    const maturityTurns = rawTerm as BondMaturityTurns;
    if (termUnits <= 0) continue;
    if (
      !Number.isSafeInteger(maturityTurns) ||
      maturityTurns <= 0 ||
      maturityTurns % interval !== 0
    )
      throw new Error("Opening maturity must divide into whole cohorts");

    const cohortCount = maturityTurns / interval;
    const unitsByOffset = allocateUnitsByWeight(
      termUnits,
      Array.from({ length: cohortCount }, (_, index) => ({
        key: (index + 1) * interval,
        weight: 1,
      }))
    );
    for (const [maturityOffset, cohortUnits] of unitsByOffset) {
      if (cohortUnits <= 0) continue;
      cohorts.push({
        maturityTurns,
        issuedAtOffset: maturityOffset - maturityTurns,
        maturityOffset,
        amount: cohortUnits * faceValue,
      });
    }
  }

  return cohorts.sort(
    (a, b) => a.maturityOffset - b.maturityOffset || a.maturityTurns - b.maturityTurns
  );
}
