// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const events = vi.hoisted(() => ({ callbacks: new Set<() => void>() }));
vi.mock("@/hooks/useGameEvents", () => ({
  useGameEvents: (callback: () => void) => {
    events.callbacks.add(callback);
  },
}));
import { useWorldFlags } from "./useWorldFlags";

describe("shared world flags", () => {
  beforeEach(() => {
    events.callbacks.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  it("shares requests and refreshes membership on events and focus, preserving the last good state on failure", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        preset: "1991-default",
        eurozoneEnabled: false,
        euroMemberCurrencies: [],
        resetV2Countries: ["US", "UK", "JP"],
        resetSystemVersions: { metrics: "v1", legislation: "v1", cabinet: "v1" },
      }),
    });
    vi.stubGlobal("fetch", fetch);
    const a = renderHook(() => useWorldFlags());
    const b = renderHook(() => useWorldFlags());
    await waitFor(() => expect(a.result.current.loaded).toBe(true));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(b.result.current.euroMemberCurrencies).toEqual([]);
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        preset: "1991-default",
        eurozoneEnabled: true,
        euroMemberCurrencies: ["EUR", "IEP", "GBP"],
        resetV2Countries: ["US", "UK", "JP"],
        resetSystemVersions: { metrics: "v1", legislation: "v1", cabinet: "v1" },
      }),
    });
    act(() => {
      events.callbacks.forEach((callback) => callback());
    });
    await waitFor(() => expect(a.result.current.euroMemberCurrencies).toContain("GBP"));
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockResolvedValueOnce({ ok: false });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(b.result.current.euroMemberCurrencies).toContain("GBP");
    await waitFor(() => expect(b.result.current.failed).toBe(true));
    expect(fetch).toHaveBeenLastCalledWith("/api/world/flags", { cache: "no-store" });
  });
});
