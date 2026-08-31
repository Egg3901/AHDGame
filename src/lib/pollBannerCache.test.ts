import { describe, expect, it, vi } from "vitest";

describe("getCachedPollBanner", () => {
  it("serves a second read from cache instead of hitting the database again", async () => {
    vi.resetModules();
    const findOne = vi.fn().mockResolvedValue({
      _id: "default",
      pollBannerEnabled: true,
      pollBannerMessage: "Survey time:",
      pollBannerUrl: "https://example.com/s",
    });
    vi.doMock("@/lib/mongodb", () => ({
      getDb: vi.fn(async () => ({ collection: () => ({ findOne }) })),
    }));

    const { getCachedPollBanner, invalidatePollBannerCache } = await import("./pollBannerCache");
    invalidatePollBannerCache();

    const first = await getCachedPollBanner();
    const second = await getCachedPollBanner();

    expect(first.enabled).toBe(true);
    expect(second).toEqual(first);
    expect(findOne).toHaveBeenCalledTimes(1);
    vi.doUnmock("@/lib/mongodb");
  });

  it("goes back to the database after the cache is invalidated", async () => {
    vi.resetModules();
    const findOne = vi.fn().mockResolvedValue({ _id: "default", pollBannerEnabled: false });
    vi.doMock("@/lib/mongodb", () => ({
      getDb: vi.fn(async () => ({ collection: () => ({ findOne }) })),
    }));

    const { getCachedPollBanner, invalidatePollBannerCache } = await import("./pollBannerCache");
    invalidatePollBannerCache();

    await getCachedPollBanner();
    invalidatePollBannerCache();
    await getCachedPollBanner();

    expect(findOne).toHaveBeenCalledTimes(2);
    vi.doUnmock("@/lib/mongodb");
  });
});
