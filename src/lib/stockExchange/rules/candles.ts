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
  /** Recorded executable turnover in anchor units; incomplete data is flagged separately. */
  volume: number;
  invalidVolumeTrades?: number;
  notes?: string[];
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
  endTurn?: number;
  invalidVolumeTrades?: number;
  notes?: string[];
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
    const open = level
      ? (priorLevel?.last ?? level.open)
      : prior?.turn === p.turn - 1
        ? prior.cap
        : p.cap;
    const close = level ? level.last : p.cap;
    return {
      turn: p.turn,
      endTurn: p.turn,
      invalidVolumeTrades: p.invalidVolumeTrades ?? 0,
      notes: [
        ...(p.notes ?? []),
        ...(level && prior && !priorLevel
          ? ["Live-print coverage begins; earlier levels use recorded turn closes"]
          : []),
        ...(!level && priorLevel
          ? ["Live-print coverage interrupted; recorded turn close used"]
          : []),
      ],
      time: p.time,
      open,
      high: Math.max(open, close, level?.high ?? close),
      low: Math.min(open, close, level?.low ?? close),
      close,
      volume: Number.isFinite(p.volume) && p.volume >= 0 ? p.volume : 0,
      intraday: level != null,
      intradayTurns: level ? 1 : 0,
      totalTurns: 1,
    };
  });
}

/** Retain detail using game-calendar buckets, targeting at most 250 candles. */
export function chartBucketTurns(_turns: number, count: number): number {
  return (
    [1, 4, 12, 48, 240, 480].find((size) => count / size <= 250) ?? Math.ceil(count / 250 / 48) * 48
  );
}

/** Legacy real-week helper retained for callers outside the game-calendar chart. */
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
      endTurn: last.endTurn ?? last.turn,
      invalidVolumeTrades: week.reduce((sum, w) => sum + (w.invalidVolumeTrades ?? 0), 0),
      notes: [...new Set(week.flatMap((w) => w.notes ?? []))],
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
