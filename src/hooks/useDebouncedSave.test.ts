// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useDebouncedSave } from "./useDebouncedSave";

afterEach(() => vi.unstubAllGlobals());

describe("useDebouncedSave", () => {
  it("does not write on the first render (seeding is not an edit)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useDebouncedSave("/api/x", { a: 1 }, true));
    await new Promise((r) => setTimeout(r, 700));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the server's reason when a save is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Seat lost" }) })
    );
    const { result, rerender } = renderHook(({ body }) => useDebouncedSave("/api/x", body, true), {
      initialProps: { body: { a: 1 } },
    });
    rerender({ body: { a: 2 } });
    await waitFor(() => expect(result.current).toBe("Seat lost"), { timeout: 3000 });
  });

  it("clears the error once a save succeeds again", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Seat lost" }) })
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ body }) => useDebouncedSave("/api/x", body, true), {
      initialProps: { body: { a: 1 } },
    });
    rerender({ body: { a: 2 } });
    await waitFor(() => expect(result.current).toBe("Seat lost"), { timeout: 3000 });
    rerender({ body: { a: 3 } });
    await waitFor(() => expect(result.current).toBeNull(), { timeout: 3000 });
  });

  it("never writes for a viewer who may not write", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = renderHook(({ body }) => useDebouncedSave("/api/x", body, false), {
      initialProps: { body: { a: 1 } },
    });
    rerender({ body: { a: 2 } });
    await new Promise((r) => setTimeout(r, 700));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
