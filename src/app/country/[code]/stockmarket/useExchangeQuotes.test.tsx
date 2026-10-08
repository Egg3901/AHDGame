// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useExchangeQuotes } from "./useExchangeQuotes";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const quote = (exchange = "NYSE", asOf = "2026-10-01T12:00:00Z") => ({
  exchange,
  exchangeName: exchange,
  asOf,
  listings: [],
});
const response = (data: ReturnType<typeof quote>) => ({ ok: true, json: async () => data });

describe("live stock quote polling", () => {
  it("tags unmount cancellation and consumes the pending request rejection", async () => {
    let signal!: AbortSignal;
    const fetch = vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal!;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetch);
    const { unmount } = renderHook(() => useExchangeQuotes("nyse", 100));
    await act(async () => unmount());
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toMatchObject({
      name: "AbortError",
      message: "Market polling stopped after view cleanup",
    });
  });

  it("refreshes quotes every minute without waiting for the other market boards", async () => {
    const fetch = vi.fn().mockResolvedValue(response(quote()));
    vi.stubGlobal("fetch", fetch);
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ turn }) => useExchangeQuotes("nyse", turn), {
      initialProps: { turn: 100 },
    });
    await act(async () => {});
    expect(result.current.data?.exchange).toBe("NYSE");
    const initial = result.current.data;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe(initial);
    fetch.mockResolvedValue(response(quote("NYSE", "2026-10-01T12:05:00Z")));
    await act(async () => {
      rerender({ turn: 101 });
    });
    expect(result.current.data?.asOf).toBe("2026-10-01T12:05:00Z");
  });

  it("ignores a delayed response from the previous venue", async () => {
    let resolveOld!: (res: ReturnType<typeof response>) => void;
    const fetch = vi
      .fn()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve;
        })
      )
      .mockResolvedValue(response(quote("GLOBAL")));
    vi.stubGlobal("fetch", fetch);
    const { result, rerender } = renderHook(({ exchange }) => useExchangeQuotes(exchange, 100), {
      initialProps: { exchange: "nyse" },
    });
    rerender({ exchange: "global" });
    await waitFor(() => expect(result.current.data?.exchange).toBe("GLOBAL"));
    await act(async () => {
      resolveOld(response(quote()));
    });
    expect(result.current.data?.exchange).toBe("GLOBAL");
  });

  it("retains the observed quotes and reports a failed refresh", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(quote()))
      .mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useExchangeQuotes("nyse", 100));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.error).toContain("Unable to refresh");
    expect(result.current.data?.exchange).toBe("NYSE");
  });
});
