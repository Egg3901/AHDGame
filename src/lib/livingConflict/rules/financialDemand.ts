import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

export const FINANCIAL_DEMAND_WINDOW = TURNS_PER_YEAR / 4;

/**
 * Household demand responds to funded transfers and a lost flow of bank credit.
 * Amounts and GDP share one country currency. A quarter spreads the one-off
 * transfer over consumption; credit stabilization naturally removes the impulse.
 * This changes order demand, never GDP, output, employment or cash directly.
 */
export function financialHouseholdDemandMultiplier(input: {
  gdp: number;
  settledStimulus: number;
  currentCredit: number;
  referenceCredit: number;
}): number {
  if (!(input.gdp > 0) || !Number.isFinite(input.gdp)) return 1;
  const transfer = Math.max(0, input.settledStimulus);
  const lostCredit = Math.min(
    0,
    Math.max(0, input.currentCredit) - Math.max(0, input.referenceCredit)
  );
  const impulse = ((transfer + lostCredit) * TURNS_PER_YEAR) / FINANCIAL_DEMAND_WINDOW / input.gdp;
  return Math.max(0.8, Math.min(1.2, 1 + impulse));
}
