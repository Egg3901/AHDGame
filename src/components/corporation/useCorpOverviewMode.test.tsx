/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  value: null as null | { user: Record<string, unknown> | null; loading: boolean },
}));
vi.mock("@/contexts/AuthDataContext", () => ({ useOptionalAuthMe: () => auth.value }));
const fetchJson = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true }));
vi.mock("@/lib/observability/fetchJson", () => ({ fetchJson }));

import { CORP_OVERVIEW_MODE_KEY, useCorpOverviewMode } from "./useCorpOverviewMode";

describe("useCorpOverviewMode", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchJson.mockClear();
    auth.value = null;
  });

  it("defaults to Pro", () => {
    const { result } = renderHook(() => useCorpOverviewMode());
    expect(result.current.mode).toBe("pro");
  });

  it("prefers the account choice over this device's", () => {
    localStorage.setItem(CORP_OVERVIEW_MODE_KEY, "pro");
    auth.value = { user: { corpOverviewMode: "simple" }, loading: false };
    const { result } = renderHook(() => useCorpOverviewMode());
    expect(result.current.mode).toBe("simple");
    expect(localStorage.getItem(CORP_OVERVIEW_MODE_KEY)).toBe("simple");
  });

  it("saves a change to the account when signed in", () => {
    auth.value = { user: { id: "u1" }, loading: false };
    const { result } = renderHook(() => useCorpOverviewMode());
    act(() => result.current.setMode("simple"));
    expect(result.current.mode).toBe("simple");
    expect(fetchJson).toHaveBeenCalledWith(
      "/api/settings/corp-overview-mode",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ corpOverviewMode: "simple" }),
      })
    );
  });

  it("keeps two toggles on the page in step", () => {
    const a = renderHook(() => useCorpOverviewMode());
    const b = renderHook(() => useCorpOverviewMode());
    act(() => a.result.current.setMode("simple"));
    expect(b.result.current.mode).toBe("simple");
    expect(fetchJson).not.toHaveBeenCalled();
  });
});
