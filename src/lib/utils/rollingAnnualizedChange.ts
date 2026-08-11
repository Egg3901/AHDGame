import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

const MIN_ANNUALIZE_TURN_SPAN = TURNS_PER_YEAR / 2;

interface RollingAnnualizedChangeInput {
  currentValue: number;
  referenceValue: number | null | undefined;
  turnSpan: number;
}

/**
 * Compute percent change from a historical reference point.
 * If enough history is available, scale the change to a 1-year / 48-turn rate.
 */
export function computeRollingAnnualizedPercentChange({
  currentValue,
  referenceValue,
  turnSpan,
}: RollingAnnualizedChangeInput): number {
  if (referenceValue == null || referenceValue <= 0 || turnSpan <= 0) return 0;

  const rawChange = (currentValue - referenceValue) / referenceValue;
  const scaledChange =
    turnSpan >= MIN_ANNUALIZE_TURN_SPAN ? rawChange * (TURNS_PER_YEAR / turnSpan) : rawChange;

  return Math.round(scaledChange * 10000) / 100;
}
