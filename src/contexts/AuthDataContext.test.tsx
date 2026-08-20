/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRefetchNav } from "./AuthDataContext";

/**
 * `/api/client-nav` is fetched once when its provider mounts and never again,
 * so every world-state flag it carries is frozen for a client-routed visit.
 * That is how a closed settlement crisis left "The German Question" standing in
 * the World menu until a hard reload. The status bar calls this on every turn
 * change to bring the nav back in step.
 */
describe("useRefetchNav", () => {
  it("is a no-op outside a provider rather than throwing", () => {
    // The status bar calls this unconditionally, and hooks cannot be skipped.
    // Throwing here would take the whole bar down wherever the provider is
    // absent — which is why the sibling flag accessors are non-throwing too.
    const { result } = renderHook(() => useRefetchNav());
    expect(() => result.current()).not.toThrow();
  });

  it("returns a stable reference, so an effect keyed on it does not loop", () => {
    // The status bar's turn-change effect lists this in its dependency array.
    // A new function identity per render would re-run the effect every render
    // and refetch the bootstrap in a loop.
    const { result, rerender } = renderHook(() => useRefetchNav());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("does not fetch merely by being called outside a provider", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() => useRefetchNav());
    result.current();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
