/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MarketOverview } from "./MarketOverview";

const { createChart, setCandleData } = vi.hoisted(() => ({
  createChart: vi.fn(),
  setCandleData: vi.fn(),
}));

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount: (value: number) => `${value}` }),
}));

vi.mock("lightweight-charts", () => ({
  CandlestickSeries: "candles",
  HistogramSeries: "volume",
  LineSeries: "line",
  CrosshairMode: { Normal: 0 },
  createChart,
}));

const candle = {
  turn: 10,
  time: 1000,
  open: 100,
  high: 110,
  low: 95,
  close: 105,
  volume: 20,
  intraday: true,
};

describe("MarketOverview loading", () => {
  beforeEach(() => {
    createChart.mockReset();
    setCandleData.mockReset();
    createChart.mockImplementation(() => ({
      addSeries: (kind: string) => ({
        setData: kind === "candles" ? setCandleData : vi.fn(),
      }),
      priceScale: () => ({ applyOptions: vi.fn() }),
      timeScale: () => ({ fitContent: vi.fn() }),
      subscribeCrosshairMove: vi.fn(),
      applyOptions: vi.fn(),
      remove: vi.fn(),
    }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
  });

  it("mounts the chart while data loads and applies candles when the request resolves", async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          })
      )
    );
    const { container } = render(<MarketOverview exchangeFilter="global" />);
    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    expect(container.querySelector(".h-full.w-full")).not.toBeNull();
    resolveFetch({ ok: true, json: async () => ({ points: [candle], intradayTurns: 1 }) });
    await waitFor(() =>
      expect(setCandleData).toHaveBeenCalledWith([
        { time: 1000, open: 100, high: 110, low: 95, close: 105 },
      ])
    );
    expect(createChart.mock.calls[0][1].timeScale.tickMarkFormatter(1000)).toBe("T10");
    expect(createChart.mock.calls[0][1].localization.timeFormatter(1000)).toBe("T10");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
