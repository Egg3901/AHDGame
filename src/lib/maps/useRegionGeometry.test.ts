/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useRegionGeometry } from "./useRegionGeometry";

describe("useRegionGeometry", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              type: "FeatureCollection",
              features: [{ properties: { regionCode: url.includes("germany") ? "BW" : "ZZ" } }],
            }),
            { status: 200 }
          )
        )
      )
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("resolves codes to their shard(s) via the manifest and merges fetched features", async () => {
    const { result } = renderHook(() => useRegionGeometry(["BW"])); // BW → germany shard
    await waitFor(() => expect(result.current.features).not.toBeNull());
    expect(result.current.features?.map((f) => f.properties?.regionCode)).toContain("BW");
    expect(result.current.loading).toBe(false);
  });

  it("returns an empty set when no code has manifest geometry (list-only)", async () => {
    // A synthetic code that will never gain a shard (FR_IDF, the previous
    // example, joined the france shard when FR geometry was built).
    const { result } = renderHook(() => useRegionGeometry(["ZZ_NO_SHARD"]));
    await waitFor(() => expect(result.current.features).not.toBeNull());
    expect(result.current.features).toEqual([]);
  });
});
