/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useActiveReferendumCampaign } from "./useActiveReferendumCampaign";

describe("useActiveReferendumCampaign", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it("does not fetch until enabled, then reflects the response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ hasActiveCampaign: true }),
    });
    const { result, rerender } = renderHook(({ on }) => useActiveReferendumCampaign("UK", on), {
      initialProps: { on: false },
    });
    expect(result.current).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
    rerender({ on: true });
    await waitFor(() => expect(result.current).toBe(true));
    expect(global.fetch).toHaveBeenCalledWith("/api/country/uk/referendums/active");
  });
});
