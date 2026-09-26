/**
 * Pure candle construction for the market overview chart. Kept free of IO so
 * the bucketing and OHLC edge cases carry unit tests; the route supplies
 * history points, intraday extremes, and per-turn volume.
 */

export interface CandleInput {
  turn: number;
  /** Unix seconds for the chart time scale. */
  time: number;
  /** Raw anchor market cap (close for the turn). */
  cap: number;
  /** Aggregate turnover in anchor units (0 when unknown). */
  volume: number;
}

export interface IntradayExtreme {
  high: number;
  low: number;
  prints: number;
}

export interface CandlePoint {
  turn: number;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** True when high/low include observed intraday prints (not just closes). */
  intraday: boolean;
}

/** One turn = one candle. Open is the previous turn's close. */
export function buildCandles(
  points: CandleInput[],
  intraday: Map<number, IntradayExtreme>
): CandlePoint[] {
  return points.map((p, i) => {
    const open = i === 0 ? p.cap : points[i - 1].cap;
    const close = p.cap;
    const level = intraday.get(p.turn);
    const observed = level != null && level.prints > 0;
    return {
      turn: p.turn,
      time: p.time,
      open,
      high: observed ? Math.max(open, close, level.high) : Math.max(open, close),
      low: observed ? Math.min(open, close, level.low) : Math.min(open, close),
      close,
      volume: p.volume,
      intraday: observed,
    };
  });
}

/** Weekly (168-turn) buckets for 1Y/ALL ranges so series stay small. */
export const WEEK_TURNS = 168;

export function bucketWeekly(candles: CandlePoint[]): CandlePoint[] {
  if (candles.length === 0) return [];
  const firstTurn = candles[0].turn;
  const buckets = new Map<number, CandlePoint[]>();
  for (const c of candles) {
    const key = Math.floor((c.turn - firstTurn) / WEEK_TURNS);
    const arr = buckets.get(key) ?? [];
    arr.push(c);
    buckets.set(key, arr);
  }
  return [...buckets.values()].map((week) => {
    const first = week[0];
    const last = week[week.length - 1];
    return {
      turn: first.turn,
      time: first.time,
      open: first.open,
      high: Math.max(...week.map((w) => w.high)),
      low: Math.min(...week.map((w) => w.low)),
      close: last.close,
      volume: week.reduce((s, w) => s + w.volume, 0),
      intraday: week.some((w) => w.intraday),
    };
  });
}

/** Simple moving average over closes, aligned to the last point of each window. */
export function movingAverage(values: number[], window: number): (number | null)[] {
  return values.map((_, i) => {
    if (i + 1 < window) return null;
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) sum += values[j];
    return sum / window;
  });
}
