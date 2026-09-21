import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { loadMapMetrics } from "@/lib/map/metricsService";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/elections/usPoliticalHome", () => ({
  loadUsPoliticalStateIds: vi.fn().mockResolvedValue({ politicalIds: new Set(["CA", "TX"]) }),
}));
vi.mock("@/lib/map/metricsService", () => ({
  loadMapMetrics: vi.fn().mockResolvedValue({ definitions: [], states: { CA: { gdp: 25 } } }),
}));
beforeEach(() => vi.clearAllMocks());
describe("GET /api/map/metrics", () => {
  it("returns roster-scoped data without shared caching", async () => {
    const response = await GET(new Request("http://local/api/map/metrics?countryId=us"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ states: { CA: { gdp: 25 } } });
    expect(loadMapMetrics).toHaveBeenCalledWith({}, ["CA", "TX"]);
  });
  it("rejects unsupported country scope before loading", async () => {
    expect((await GET(new Request("http://local/api/map/metrics?countryId=UK"))).status).toBe(400);
    expect(loadMapMetrics).not.toHaveBeenCalled();
  });
});
