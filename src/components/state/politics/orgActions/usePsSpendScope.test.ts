/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePsSpendScope } from "./usePsSpendScope";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePsSpendScope", () => {
  it("returns scope + pools on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({
          ok: true,
          eligibleScopes: { state: true, national: false },
          statePoolPS: 42,
          nationalPoolPS: 7,
        }),
      })
    );
    const { result } = renderHook(() => usePsSpendScope("US", "AK", "9", true));
    await waitFor(() => expect(result.current.eligibleScopes).not.toBeNull());
    expect(result.current.eligibleScopes).toEqual({ state: true, national: false });
    expect(result.current.poolPS).toEqual({ statePoolPS: 42, nationalPoolPS: 7 });
  });

  it("stays null when disabled (no fetch)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => usePsSpendScope("US", "AK", "9", false));
    expect(result.current.eligibleScopes).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
