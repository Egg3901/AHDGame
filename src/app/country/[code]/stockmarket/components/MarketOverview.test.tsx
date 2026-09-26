/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MarketOverview } from "./MarketOverview";

const { createChart, setCandleData, setCompareData } = vi.hoisted(() => ({
  createChart: vi.fn(),
  setCandleData: vi.fn(),
  setCompareData: vi.fn(),
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
    setCompareData.mockReset();
    createChart.mockImplementation(() => ({
      addSeries: (kind: string) => ({
        setData: kind === "candles" ? setCandleData : kind === "line" ? setCompareData : vi.fn(),
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

  it("offers only accessible national exchanges and plots a sector comparison", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url.includes("market-cap-history")
              ? {
                  points: [
                    {
                      turn: 10,
                      createdAt: new Date(1000 * 1000).toISOString(),
                      bySector: { financial: 100 },
                    },
                    {
                      turn: 11,
                      createdAt: new Date(2000 * 1000).toISOString(),
                      bySector: { financial: 110 },
                    },
                  ],
                }
              : {
                  points: url.includes("exchange=nyse")
                    ? [
                        { ...candle, close: 100 },
                        { ...candle, turn: 11, time: 2000, close: 120 },
                      ]
                    : [candle, { ...candle, turn: 11, time: 2000 }],
                  bucketed: false,
                },
        })
      )
    );
    render(
      <MarketOverview
        exchangeFilter="global"
        exchangeMeta={{
          global: { title: "Global", subtitle: "", exchangeApi: "global" },
          US: { title: "NYSE", subtitle: "", exchangeApi: "nyse" },
        }}
      />
    );
    const select = screen.getByRole("combobox", { name: "Compare with another index" });
    expect(select.querySelector('option[value="venue:nyse"]')).not.toBeNull();
    expect(select.querySelector('option[value="venue:nikkei"]')).toBeNull();
    await waitFor(() => expect(setCandleData).toHaveBeenCalled());
    fireEvent.change(select, { target: { value: "sector:financial" } });
    await waitFor(() =>
      expect(setCompareData).toHaveBeenCalledWith([
        { time: 1000, value: 0 },
        { time: 2000, value: 10 },
      ])
    );
    fireEvent.change(select, { target: { value: "venue:nyse" } });
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/stock-exchange/candles?exchange=nyse&turns=168", {
        cache: "no-store",
      })
    );
    await waitFor(() =>
      expect(setCompareData).toHaveBeenCalledWith([
        { time: 1000, value: 0 },
        { time: 2000, value: 20 },
      ])
    );
  });
});
