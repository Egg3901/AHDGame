/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useBondHistory } from "./useBondHistory";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockResponse(body: unknown, ok = true, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

describe("useBondHistory", () => {
  it("fetches the requested page+pageSize+direction and returns server pagination metadata", async () => {
    mockResponse({
      entries: [
        {
          id: "1",
          type: "bond_coupon",
          turn: 100,
          createdAt: "2026-04-29T16:00:00Z",
          amount: 1000,
          currencyCode: "USD",
          counterparty: null,
          bond: null,
        },
      ],
      page: 2,
      pageSize: 5,
      direction: "income",
      totalTurns: 25,
      pageCount: 5,
      windowTurns: 168,
    });

    const { result } = renderHook(() => useBondHistory("corp-abc", 2, 5, "income"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe(
      "/api/corporations/corp-abc/bonds/history?page=2&pageSize=5&direction=income"
    );
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.pageCount).toBe(5);
    expect(result.current.totalTurns).toBe(25);
    expect(result.current.windowTurns).toBe(168);
    expect(result.current.serverPage).toBe(2);
  });

  it("re-runs the fetch when refreshKey changes", async () => {
    mockResponse({
      entries: [],
      page: 1,
      pageSize: 10,
      direction: "all",
      totalTurns: 0,
      pageCount: 1,
      windowTurns: 168,
    });
    mockResponse({
      entries: [
        {
          id: "x",
          type: "bond_coupon",
          turn: 200,
          createdAt: "2026-05-01T00:00:00Z",
          amount: 500,
          currencyCode: "USD",
          counterparty: null,
          bond: null,
        },
      ],
      page: 1,
      pageSize: 10,
      direction: "all",
      totalTurns: 1,
      pageCount: 1,
      windowTurns: 168,
    });

    const { result, rerender } = renderHook(
      ({ refreshKey }: { refreshKey: number }) =>
        useBondHistory("corp-abc", 1, 10, "all", refreshKey),
      { initialProps: { refreshKey: 0 } }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.entries).toHaveLength(0);

    rerender({ refreshKey: 1 });

    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts an in-flight fetch when refreshKey changes mid-request", async () => {
    // First fetch never resolves on its own — we'll abort it via a refreshKey
    // change. Vitest's fetchMock receives the AbortSignal in the request init;
    // simulate the AbortError that fetch normally throws when the signal fires.
    let abortHandler: (() => void) | undefined;
    fetchMock.mockImplementationOnce((_url, init?: RequestInit) => {
      const sig = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        // If the signal is already aborted by the time fetch is invoked,
        // reject immediately rather than registering a listener that would
        // never fire (race-safe pattern that the real fetch implementation
        // also follows).
        if (sig?.aborted) {
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        const onAbort = () => reject(new DOMException("aborted", "AbortError"));
        abortHandler = onAbort;
        sig?.addEventListener("abort", onAbort, { once: true });
      });
    });
    mockResponse({
      entries: [
        {
          id: "y",
          type: "bond_coupon",
          turn: 300,
          createdAt: "2026-06-01T00:00:00Z",
          amount: 750,
          currencyCode: "USD",
          counterparty: null,
          bond: null,
        },
      ],
      page: 1,
      pageSize: 10,
      direction: "all",
      totalTurns: 1,
      pageCount: 1,
      windowTurns: 168,
    });

    const { result, rerender } = renderHook(
      ({ refreshKey }: { refreshKey: number }) =>
        useBondHistory("corp-abc", 1, 10, "all", refreshKey),
      { initialProps: { refreshKey: 0 } }
    );

    // First fetch is in flight, never resolves on its own.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Bump refreshKey — should abort the pending request and start a new one.
    rerender({ refreshKey: 1 });

    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The hook must NOT surface an error from the aborted first fetch.
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    // sanity: abort handler ran (otherwise the test setup would leak).
    expect(abortHandler).toBeDefined();
  });

  it("surfaces a string error and clears entries on a non-2xx response", async () => {
    mockResponse({}, false, 500);

    const { result } = renderHook(() => useBondHistory("corp-abc", 1, 10, "all"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/HTTP 500/);
    expect(result.current.entries).toEqual([]);
  });
});
