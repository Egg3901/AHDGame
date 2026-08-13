/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useCabinetOffice } from "./useCabinetOffice";

const payload = { canAct: true, units: [] };

describe("useCabinetOffice refetch", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => payload,
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps loading false on refetch so the office tree stays mounted", async () => {
    const { result } = renderHook(() => useCabinetOffice("us", "secretary_of_defense"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(payload);

    await act(async () => {
      const pending = result.current.refetch();
      expect(result.current.loading).toBe(false);
      await pending;
    });
    expect(result.current.loading).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
