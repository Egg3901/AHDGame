// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshGameTurnStatus, useGameEvents } from "./useGameEvents";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("shared market tick notifications", () => {
  it("refreshes mounted market views once per update without firing hourly subscribers", async () => {
    let lastMarketTickAt = "2026-10-09T03:15:00Z";
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        currentTurn: 59,
        isActive: true,
        isProcessing: false,
        nextScheduledTurn: null,
        lastMarketTickAt,
      }),
    }));
    vi.stubGlobal("fetch", fetcher);
    const prices = vi.fn();
    const conversions = vi.fn();
    const hourly = vi.fn();
    renderHook(() => {
      useGameEvents(prices, ["market_tick"]);
      useGameEvents(conversions, ["market_tick", "turn_complete"]);
      useGameEvents(hourly);
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(prices).not.toHaveBeenCalled();

    lastMarketTickAt = "2026-10-09T03:30:00Z";
    await act(async () => refreshGameTurnStatus());
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(prices).toHaveBeenCalledOnce();
    expect(conversions).toHaveBeenCalledOnce();
    expect(hourly).not.toHaveBeenCalled();

    await act(async () => refreshGameTurnStatus());
    expect(prices).toHaveBeenCalledOnce();
    expect(conversions).toHaveBeenCalledOnce();
    expect(hourly).not.toHaveBeenCalled();
  });
});
