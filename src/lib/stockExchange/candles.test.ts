import { describe, expect, it } from "vitest";
import {
  buildCandles,
  bucketWeekly,
  movingAverage,
  type CandleInput,
  type CandlePoint,
  bucketCandles,
  chartBucketTurns,
  mergeQuarterCandles,
  type QuarterTick,
} from "./candles";

const pts = (caps: number[]): CandleInput[] =>
  caps.map((cap, i) => ({ turn: 100 + i, time: 1_700_000_000 + i * 3600, cap, volume: 10 }));

describe("buildCandles", () => {
  it("opens each candle at the previous close without intraday data", () => {
    const out = buildCandles(pts([100, 110, 105]), new Map());
    expect(out.map((c) => [c.open, c.high, c.low, c.close])).toEqual([
      [100, 100, 100, 100],
      [100, 110, 100, 110],
      [110, 110, 105, 105],
    ]);
    expect(out.every((c) => !c.intraday)).toBe(true);
  });

  it("widens high/low to observed intraday extremes", () => {
    const out = buildCandles(
      pts([100, 110]),
      new Map([[101, { open: 100, high: 120, low: 90, last: 110, prints: 4 }]])
    );
    expect(out[1]).toMatchObject({ open: 100, high: 120, low: 90, close: 110, intraday: true });
    expect(out[0].intraday).toBe(false);
  });

  it("uses the live print basis for the whole candle instead of making offset wicks", () => {
    const out = buildCandles(
      pts([35, 35.3]),
      new Map([
        [100, { open: 40, high: 42, low: 39, last: 41, prints: 4 }],
        [101, { open: 41, high: 41, low: 39, last: 39.3, prints: 4 }],
      ])
    );
    expect(out.map((c) => [c.open, c.high, c.low, c.close])).toEqual([
      [40, 42, 39, 41],
      [41, 41, 39, 39.3],
    ]);
  });

  it("ignores intraday rows with no prints", () => {
    const out = buildCandles(
      pts([100]),
      new Map([[100, { open: 999, high: 999, low: 1, last: 999, prints: 0 }]])
    );
    expect(out[0]).toMatchObject({ high: 100, low: 100, intraday: false });
  });
});

describe("bucketWeekly", () => {
  const many = (n: number): CandlePoint[] =>
    Array.from({ length: n }, (_, i) => ({
      turn: 1 + i,
      time: i,
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100 + i,
      volume: 1,
      intraday: i % 2 === 0,
    }));

  it("buckets 168-turn weeks with first-open last-close semantics", () => {
    const out = bucketWeekly(many(336));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      turn: 1,
      open: 100,
      high: 101 + 167,
      low: 99,
      close: 100 + 167,
      volume: 168,
      intraday: true,
    });
    expect(out[1].turn).toBe(169);
  });

  it("passes short series through as one bucket", () => {
    expect(bucketWeekly(many(10))).toHaveLength(1);
  });
});

describe("movingAverage", () => {
  it("aligns averages to the window end with null padding", () => {
    expect(movingAverage([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
    expect(movingAverage([1, 2], 5)).toEqual([null, null]);
  });
});

describe("range bucketing", () => {
  it("keeps 1252 turns readable and buckets price and turnover together", () => {
    const points = buildCandles(pts(Array(1252).fill(35)), new Map());
    expect(chartBucketTurns(0, points.length)).toBe(12);
    const buckets = bucketCandles(points, 12);
    expect(buckets).toHaveLength(105);
    expect(buckets.reduce((sum, c) => sum + c.volume, 0)).toBe(12520);
    expect(chartBucketTurns(720, 720)).toBe(4);
    expect(chartBucketTurns(168, 168)).toBe(1);
    expect(chartBucketTurns(0, 8760)).toBe(48);
  });
});

describe("mergeQuarterCandles", () => {
  const hourly = buildCandles(pts([100, 110, 120]), new Map());
  const tick = (turn: number, q: number, last: number, extra: Partial<QuarterTick> = {}) => ({
    turn,
    time: 1_700_000_000 + (turn - 100) * 3600 + q * 900,
    open: last,
    high: last,
    low: last,
    last,
    prints: 1,
    ...extra,
  });

  it("splits ticked turns into quarter candles and keeps unticked turns hourly", () => {
    const merged = mergeQuarterCandles(
      hourly,
      [tick(101, 0, 104), tick(101, 1, 106, { high: 109 }), tick(101, 2, 103), tick(101, 3, 111)],
      new Map([[1_700_000_000 + 3600 + 900, 7]])
    );
    expect(merged.map((c) => [c.turn, c.open, c.close])).toEqual([
      [100, 100, 100],
      [101, 100, 104],
      [101, 104, 106],
      [101, 106, 103],
      [101, 103, 111],
      [102, 111, 120],
    ]);
    expect(merged[2].high).toBe(109);
    expect(merged[2].volume).toBe(7);
    expect(merged[1].volume).toBe(0);
    // Strictly increasing times for the chart library.
    expect(merged.every((c, i) => i === 0 || c.time > merged[i - 1].time)).toBe(true);
  });

  it("ignores empty or invalid ticks", () => {
    const merged = mergeQuarterCandles(
      hourly,
      [tick(101, 0, Number.NaN), tick(101, 1, 105, { prints: 0 })],
      new Map()
    );
    expect(merged).toEqual(hourly);
  });

  it("carries the turn candle's notes on its first quarter only", () => {
    const noted: CandlePoint[] = hourly.map((c) =>
      c.turn === 101 ? { ...c, notes: ["split"], invalidVolumeTrades: 2 } : c
    );
    const merged = mergeQuarterCandles(noted, [tick(101, 0, 104), tick(101, 1, 105)], new Map());
    expect(merged[1].notes).toEqual(["split"]);
    expect(merged[1].invalidVolumeTrades).toBe(2);
    expect(merged[2].notes).toEqual([]);
    expect(merged[2].invalidVolumeTrades).toBe(0);
  });
});
