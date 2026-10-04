/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MarketOverview } from "./MarketOverview";

const { createChart, setCandleData, setCompareData, setVolumeData, applyPriceOptions } = vi.hoisted(
  () => ({
    createChart: vi.fn(),
    setCandleData: vi.fn(),
    setCompareData: vi.fn(),
    setVolumeData: vi.fn(),
    applyPriceOptions: vi.fn(),
  })
);

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount: (value: number) => `${value}` }),
}));

vi.mock("lightweight-charts", () => ({
  CandlestickSeries: "candles",
  HistogramSeries: "volume",
  LineSeries: "line",
  CrosshairMode: { Normal: 0 },
  PriceScaleMode: { Normal: 0, Logarithmic: 1 },
  createChart,
  createSeriesMarkers: vi.fn(() => ({ detach: vi.fn(), setMarkers: vi.fn() })),
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
    vi.restoreAllMocks();
    createChart.mockReset();
    setCandleData.mockReset();
    setCompareData.mockReset();
    setVolumeData.mockReset();
    applyPriceOptions.mockReset();
    createChart.mockImplementation(() => ({
      addSeries: (kind: string) => ({
        setData:
          kind === "candles" ? setCandleData : kind === "line" ? setCompareData : setVolumeData,
        priceScale: () => ({ applyOptions: applyPriceOptions }),
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

  it("resolves color-mix theme tokens to colors accepted by the canvas chart", async () => {
    const realGetComputedStyle = window.getComputedStyle.bind(window);
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const element = realCreateElement(tagName);
      if (tagName === "span") {
        Object.defineProperty(element, "style", { value: { color: "" }, configurable: true });
      }
      return element;
    });
    vi.spyOn(window, "getComputedStyle").mockImplementation((element: Element) => {
      const style = realGetComputedStyle(element);
      return new Proxy(style, {
        get(target, key) {
          if (element === document.documentElement && key === "getPropertyValue") {
            return (name: string) =>
              name === "--muted" ? "color-mix(in srgb, #e8e8ee 78%, #14141c)" : "#000000";
          }
          if (element !== document.documentElement && key === "color")
            return "color(srgb 0.745 0.745 0.769)";
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {}))
    );

    render(<MarketOverview exchangeFilter="global" />);

    await waitFor(() => expect(createChart).toHaveBeenCalledTimes(1));
    expect(createChart.mock.calls[0][1].layout.textColor).toBe("rgba(190, 190, 196, 1)");
  });

  it("fits a newly selected range only after its own data arrives", async () => {
    const fit = vi.fn();
    createChart.mockImplementation(() => ({
      addSeries: () => ({ setData: vi.fn(), priceScale: () => ({ applyOptions: vi.fn() }) }),
      timeScale: () => ({ fitContent: fit }),
      subscribeCrosshairMove: vi.fn(),
      applyOptions: vi.fn(),
      remove: vi.fn(),
    }));
    let resolveAll!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.includes("turns=0")
          ? new Promise((resolve) => {
              resolveAll = resolve;
            })
          : Promise.resolve({
              ok: true,
              json: async () => ({ exchange: "global", turns: 48, points: [candle] }),
            })
      )
    );
    render(<MarketOverview exchangeFilter="global" />);
    await waitFor(() => expect(fit).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "ALL" }));
    expect(fit).toHaveBeenCalledTimes(1);
    resolveAll({
      ok: true,
      json: async () => ({ exchange: "global", turns: 0, points: [candle] }),
    });
    await waitFor(() => expect(fit).toHaveBeenCalledTimes(2));
  });

  it("reports first open to last close for the selected range", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            points: [
              { ...candle, open: url.includes("turns=24") ? 120 : 200, close: 110 },
              { ...candle, turn: 11, time: 2000, open: 110, close: 100 },
              { ...candle, turn: 12, time: 3000, open: 100, close: 105 },
            ],
            bucketed: false,
            intradayTurns: 3,
          }),
        })
      )
    );
    render(<MarketOverview exchangeFilter="global" />);
    await waitFor(() => expect(screen.getByText(/-95.*-47.50%/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "6M" }));
    await waitFor(() => expect(screen.getByText(/-15.*-12.50%/)).toBeTruthy());
  });

  it("aligns every volume bucket, marks coverage and defaults ALL to log scale", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            points: [
              { ...candle, intraday: false, volume: 0 },
              { ...candle, turn: 34, time: 2000 },
            ],
            bucketed: true,
            bucketTurns: 24,
            totalTurns: 48,
            intradayTurns: 1,
            firstIntradayTurn: 34,
          }),
        })
      )
    );
    render(<MarketOverview exchangeFilter="global" />);
    await waitFor(() => expect(setCandleData).toHaveBeenCalled());
    expect(setVolumeData.mock.calls.at(-1)?.[0].map((p: { time: number }) => p.time)).toEqual(
      setCandleData.mock.calls.at(-1)?.[0].map((p: { time: number }) => p.time)
    );
    expect(setVolumeData.mock.calls.at(-1)?.[0][0].value).toBe(0);
    expect(screen.getByText("1/48 turns with intraday prints")).toBeTruthy();
    expect(screen.getByText(/coverage begins T34/)).toBeTruthy();
    expect(screen.getByText("6-month buckets (24 turns)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ALL" }));
    await waitFor(() => expect(applyPriceOptions).toHaveBeenCalledWith({ mode: 1 }));
  });

  it("offers only accessible national exchanges and plots a sector comparison", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url.includes("sector=financial")
              ? {
                  points: [
                    {
                      turn: 10,
                      time: 1000,
                      open: 100,
                      close: 100,
                    },
                    {
                      turn: 11,
                      time: 2000,
                      open: 100,
                      close: 110,
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
        { time: 2000, value: expect.closeTo(10) },
      ])
    );
    fireEvent.change(select, { target: { value: "venue:nyse" } });
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/stock-exchange/candles?exchange=nyse&turns=48", {
        cache: "no-store",
      })
    );
    await waitFor(() =>
      expect(setCompareData).toHaveBeenCalledWith([
        { time: 1000, value: 0 },
        { time: 2000, value: expect.closeTo(20) },
      ])
    );
  });
});

describe("world dates and refreshed data", () => {
  it("labels the ending game date of a bucket and reloads without refitting zoom", async () => {
    const fit = vi.fn();
    createChart.mockImplementation(() => ({
      addSeries: () => ({ setData: vi.fn(), priceScale: () => ({ applyOptions: vi.fn() }) }),
      timeScale: () => ({ fitContent: fit }),
      subscribeCrosshairMove: vi.fn(),
      applyOptions: vi.fn(),
      remove: vi.fn(),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          points: [{ ...candle, turn: 1255, endTurn: 1266, invalidVolumeTrades: 2 }],
          totalTurns: 12,
          invalidVolumeTrades: 2,
          calendar: {
            startingYear: 1953,
            currentTurn: 1266,
            preIterationTurns: 48,
            lastTurnProcessed: "2026-10-01",
          },
        }),
      })
    );
    const { rerender } = render(<MarketOverview exchangeFilter="global" currentTurn={1266} />);
    await waitFor(() => expect(screen.getByText(/Through May 1978/)).toBeTruthy());
    // Data can render before the chart's asynchronous import finishes.
    await waitFor(() => expect(fit).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Turnover incomplete/)).toBeTruthy();
    expect(createChart.mock.calls.at(-1)?.[1].timeScale.tickMarkFormatter(1000)).toBe("May 1978");
    rerender(<MarketOverview exchangeFilter="global" currentTurn={1267} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fit).toHaveBeenCalledTimes(1);
  });
});
