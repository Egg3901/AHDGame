import { TURNS_PER_DAY, TURNS_PER_YEAR } from "@/lib/constants/turnTime";

export type ForexChartTimeframe = "24h" | "48h" | "5y" | "all";

export const FOREX_CHART_TIMEFRAME_ORDER: Record<ForexChartTimeframe, number> = {
  "24h": 0,
  "48h": 1,
  "5y": 2,
  all: 3,
};

/** Last N hourly turns shown (aligned with stock market overview). */
export const FOREX_CHART_TIMEFRAME_TURNS: Record<ForexChartTimeframe, number> = {
  "24h": TURNS_PER_DAY,
  "48h": TURNS_PER_YEAR,
  "5y": TURNS_PER_YEAR * 5,
  all: Infinity,
};

export const FOREX_CHART_TIMEFRAME_LABELS: Record<ForexChartTimeframe, string> = {
  "24h": "24h · 6m",
  "48h": "48h · 1y",
  "5y": "5y",
  all: "All",
};

/** Keep points whose turn falls in the last `limit` turns ending at the series max turn. */
export function slicePointsByTurnWindow<T extends { turn: number }>(
  points: T[],
  timeframe: ForexChartTimeframe
): T[] {
  const limit = FOREX_CHART_TIMEFRAME_TURNS[timeframe];
  if (points.length <= 1 || limit === Infinity) return points;
  const sorted = [...points].sort((a, b) => a.turn - b.turn);
  const maxTurn = sorted[sorted.length - 1]!.turn;
  const minTurn = maxTurn - limit + 1;
  return sorted.filter((p) => p.turn >= minTurn);
}
