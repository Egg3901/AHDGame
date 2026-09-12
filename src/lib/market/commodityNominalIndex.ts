import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

export const GLOBAL_INFLATION_FLOOR_PCT = -2;
export const GLOBAL_INFLATION_CEILING_PCT = 25;

export function medianGlobalInflation(rates: readonly number[]): number {
  const valid = rates.filter(Number.isFinite).sort((a, b) => a - b);
  if (valid.length === 0) return 0;
  const middle = Math.floor(valid.length / 2);
  const median =
    valid.length % 2 === 0 ? (valid[middle - 1]! + valid[middle]!) / 2 : valid[middle]!;
  return Math.max(GLOBAL_INFLATION_FLOOR_PCT, Math.min(GLOBAL_INFLATION_CEILING_PCT, median));
}

/** Advance the shared nominal commodity price level through elapsed game turns. */
export function advanceCommodityNominalIndex(args: {
  index: number | null | undefined;
  lastTurn: number | null | undefined;
  currentTurn: number;
  annualInflationPct: number;
}): number {
  const index = Number.isFinite(args.index) && (args.index as number) > 0 ? args.index! : 1;
  const currentTurn = Number.isFinite(args.currentTurn) ? Math.max(0, args.currentTurn) : 0;
  const lastTurn = Number.isFinite(args.lastTurn)
    ? Math.min(currentTurn, Math.max(0, args.lastTurn as number))
    : Math.max(0, currentTurn - 1);
  const elapsed = currentTurn - lastTurn;
  if (elapsed === 0) return index;
  const inflation = Math.max(
    GLOBAL_INFLATION_FLOOR_PCT,
    Math.min(GLOBAL_INFLATION_CEILING_PCT, args.annualInflationPct)
  );
  return index * Math.pow(1 + inflation / 100, elapsed / TURNS_PER_YEAR);
}

/** Compound one median annual rate per recorded turn, used by the catch-up migration. */
export function compoundGlobalInflationHistory(
  ratesByTurn: ReadonlyMap<number, readonly number[]>
): number {
  let index = 1;
  for (const rates of [...ratesByTurn.entries()].sort(([a], [b]) => a - b).map(([, v]) => v)) {
    index = advanceCommodityNominalIndex({
      index,
      lastTurn: 0,
      currentTurn: 1,
      annualInflationPct: medianGlobalInflation(rates),
    });
  }
  return index;
}
