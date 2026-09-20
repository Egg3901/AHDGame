/** @vitest-environment happy-dom */
import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useResourceMapData } from "./useResourceMapData";
import type { ExtractableResource } from "@/lib/constants/commodities";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("ignores a late response for a previously selected resource", async () => {
  const requests: { resolve: (r: unknown) => void; signal?: AbortSignal }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((resolve) => requests.push({ resolve, signal: init.signal ?? undefined }))
    )
  );
  const { result, rerender } = renderHook(
    ({ resource }: { resource: ExtractableResource }) =>
      useResourceMapData("resources", "US", resource),
    { initialProps: { resource: "oil" as ExtractableResource } }
  );
  rerender({ resource: "coal" });
  expect(requests[0].signal?.aborted).toBe(true);
  await act(async () => {
    requests[1].resolve({
      ok: true,
      json: async () => ({
        states: { CA: { capacity: 20, contractedPct: 0.3, openAccessPct: 0.7 } },
      }),
    });
  });
  await waitFor(() => expect(result.current.CA.capacity).toBe(20));
  await act(async () => {
    requests[0].resolve({ ok: true, json: async () => ({ states: { CA: { capacity: 99 } } }) });
  });
  expect(result.current.CA.capacity).toBe(20);
});
