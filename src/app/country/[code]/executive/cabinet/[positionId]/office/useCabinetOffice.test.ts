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
  it("hides the previous office and ignores its late response after navigation", async () => {
    let finishOld!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      })
    );
    const { result, rerender } = renderHook(({ seat }) => useCabinetOffice("us", seat), {
      initialProps: { seat: "secretary_of_defense" },
    });
    rerender({ seat: "secretary_of_labor" });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data).toEqual(payload));
    await act(async () => {
      finishOld(new Response(JSON.stringify({ canAct: false, old: true })));
    });
    expect(result.current.data).toEqual(payload);
  });
  it("keeps the newest refresh when responses arrive out of order", async () => {
    const { result } = renderHook(() => useCabinetOffice("us", "secretary_of_defense"));
    await waitFor(() => expect(result.current.data).toEqual(payload));
    let finishOlder!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise((resolve) => {
        finishOlder = resolve;
      })
    );
    let older!: Promise<void>;
    await act(async () => {
      older = result.current.refetch();
      await result.current.refetch();
    });
    await act(async () => {
      finishOlder(new Response(JSON.stringify({ error: "stale" }), { status: 409 }));
      await older;
    });
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual(payload);
  });
});
