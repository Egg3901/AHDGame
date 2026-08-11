/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useActionPreview } from "./useActionPreview";

afterEach(() => {
  vi.unstubAllGlobals();
});

interface FakePreview {
  ok: boolean;
  effectiveCost: number;
}

describe("useActionPreview", () => {
  it("fetches the preview and exposes it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ ok: true, effectiveCost: 7 }) })
    );
    const { result } = renderHook(() =>
      useActionPreview<FakePreview>("/api/x/preview", { enabled: true, refetchKey: 0 })
    );
    await waitFor(() => expect(result.current.preview).not.toBeNull());
    expect(result.current.preview?.effectiveCost).toBe(7);
    expect(result.current.loading).toBe(false);
  });

  it("does not fetch when disabled", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderHook(() => useActionPreview<FakePreview>(null, { enabled: false, refetchKey: 0 }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
