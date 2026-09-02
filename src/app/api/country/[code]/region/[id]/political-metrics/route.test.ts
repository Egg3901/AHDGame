import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/politicalMetrics/queries/regionPoliticalMetrics", () => ({
  loadRegionPoliticalMetrics: vi.fn(),
}));

const { loadRegionPoliticalMetrics } =
  await import("@/lib/politicalMetrics/queries/regionPoliticalMetrics");
const { GET } = await import("./route");

const load = vi.mocked(loadRegionPoliticalMetrics);

function req() {
  return new Request("http://localhost/api/country/us/region/ga/political-metrics");
}

function params(code: string, id: string) {
  return { params: Promise.resolve({ code, id }) };
}

describe("GET /api/country/[code]/region/[id]/political-metrics", () => {
  beforeEach(() => {
    load.mockReset();
  });

  it("404s for a country with no political-metrics board", async () => {
    const res = await GET(req(), params("fr", "IDF"));
    expect(res.status).toBe(404);
    // The loader must not even be reached for a country that has no board.
    expect(load).not.toHaveBeenCalled();
  });

  it("404s for a region with no board doc", async () => {
    load.mockResolvedValue(null);
    const res = await GET(req(), params("us", "ZZ"));
    expect(res.status).toBe(404);
  });

  it("upper-cases the region id before loading, so /region/ga resolves", async () => {
    load.mockResolvedValue(null);
    await GET(req(), params("us", "ga"));
    expect(load).toHaveBeenCalledWith("US", "GA");
  });

  it("returns the region payload and forbids caching", async () => {
    load.mockResolvedValue({
      regionId: "GA",
      regionName: "Georgia",
    } as never);
    const res = await GET(req(), params("us", "ga"));
    expect(res.status).toBe(200);
    // A cached registry would show a stale board after a turn ticks.
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect((await res.json()).regionId).toBe("GA");
  });

  it("surfaces a loader failure as a handled error, not an unhandled rejection", async () => {
    load.mockRejectedValue(new Error("db down"));
    const res = await GET(req(), params("us", "ga"));
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
