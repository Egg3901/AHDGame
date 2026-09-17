// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshGameTurnStatus, useGameTurnStatus, useGameEvents } from "./useGameEvents";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("manual local turn refresh", () => {
  it("updates the shared clock and notifies turn subscribers immediately", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          currentTurn: 1,
          isActive: true,
          isProcessing: false,
          nextScheduledTurn: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          currentTurn: 2,
          isActive: true,
          isProcessing: false,
          nextScheduledTurn: null,
        }),
      });
    vi.stubGlobal("fetch", fetcher);
    const completed = vi.fn();
    const { result } = renderHook(() => {
      useGameEvents(completed, ["turn_complete"]);
      return useGameTurnStatus();
    });
    await waitFor(() => expect(result.current?.currentTurn).toBe(1));
    await act(async () => {
      await refreshGameTurnStatus();
    });
    expect(result.current?.currentTurn).toBe(2);
    expect(completed).toHaveBeenCalledWith(expect.objectContaining({ type: "turn_complete" }));
    expect(fetcher).toHaveBeenLastCalledWith(
      "/api/game/turn/status",
      expect.objectContaining({ cache: "no-store" })
    );
  });
});
