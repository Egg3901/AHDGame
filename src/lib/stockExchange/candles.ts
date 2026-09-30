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
  open: number;
  last: number;
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
  /** Counts remain per turn after aggregation, including partial coverage. */
  intradayTurns?: number;
  totalTurns?: number;
}

/** Each candle uses one valuation source for its entire OHLC. */
export function buildCandles(
  points: CandleInput[],
  intraday: Map<number, IntradayExtreme>,
  previous?: CandleInput
): CandlePoint[] {
  const observedLevel = (turn: number) => {
    const level = intraday.get(turn);
    return level &&
      level.prints > 0 &&
      [level.open, level.last, level.high, level.low].every((n) => Number.isFinite(n) && n >= 0)
      ? level
      : undefined;
  };
  return points.map((p, i) => {
    const prior = i === 0 ? previous : points[i - 1];
    const level = observedLevel(p.turn);
    const priorLevel = prior && observedLevel(prior.turn);
    // At the coverage boundary use the first observed print. Historical turn
    // outputs must never become the body of a candle with live-listing wicks.
    const open = level ? (priorLevel?.last ?? level.open) : (prior?.cap ?? p.cap);
    const close = level ? level.last : p.cap;
    return {
      turn: p.turn,
      time: p.time,
      open,
      high: Math.max(open, close, level?.high ?? close),
      low: Math.min(open, close, level?.low ?? close),
      close,
      volume: p.volume,
      intraday: level != null,
      intradayTurns: level ? 1 : 0,
      totalTurns: 1,
    };
  });
}

/** Daily detail for a month or short full history; weekly for multi-year history. */
export function chartBucketTurns(turns: number, count: number): number {
  if (turns === 24 || turns === 168) return 1;
  return count <= 24 * 168 ? 24 : WEEK_TURNS;
}

/** Weekly (168-turn) buckets for 1Y/ALL ranges so series stay small. */
export const WEEK_TURNS = 168;

export function bucketWeekly(candles: CandlePoint[]): CandlePoint[] {
  return bucketCandles(candles, WEEK_TURNS);
}

export function bucketCandles(candles: CandlePoint[], bucketTurns: number): CandlePoint[] {
  if (bucketTurns === 1) return candles;
  if (candles.length === 0) return [];
  const firstTurn = candles[0].turn;
  const buckets = new Map<number, CandlePoint[]>();
  for (const c of candles) {
    const key = Math.floor((c.turn - firstTurn) / bucketTurns);
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
      intradayTurns: week.reduce((s, w) => s + (w.intradayTurns ?? Number(w.intraday)), 0),
      totalTurns: week.reduce((s, w) => s + (w.totalTurns ?? 1), 0),
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
