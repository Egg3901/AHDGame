import { describe, expect, it } from "vitest";
import {
  buildCandles,
  bucketWeekly,
  movingAverage,
  type CandleInput,
  type CandlePoint,
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
    const out = buildCandles(pts([100, 110]), new Map([[101, { high: 120, low: 90, prints: 4 }]]));
    expect(out[1]).toMatchObject({ open: 100, high: 120, low: 90, close: 110, intraday: true });
    expect(out[0].intraday).toBe(false);
  });

  it("ignores intraday rows with no prints", () => {
    const out = buildCandles(pts([100]), new Map([[100, { high: 999, low: 1, prints: 0 }]]));
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
