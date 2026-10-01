import { describe, expect, it, vi } from "vitest";
import { buildOpeningMetricSnapshots1991 } from "@/lib/resetMetrics/seedOpening1991";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn().mockResolvedValue({
    collection: () => ({
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    }),
  }),
}));
vi.mock("@/lib/resetMetrics/readBoard", () => ({ readResetMetricBoard: vi.fn() }));

describe("v2 metrics API", () => {
  it("does not expose a staged or unavailable board as live data", async () => {
    const { readResetMetricBoard } = await import("@/lib/resetMetrics/readBoard");
    const { GET } = await import("./route");
    vi.mocked(readResetMetricBoard).mockResolvedValue({ status: "not_enabled" });
    const request = new Request("http://localhost/api/country/us/reset-metrics");
    const context = { params: Promise.resolve({ code: "us" }) };
    expect((await GET(request, context)).status).toBe(409);
    vi.mocked(readResetMetricBoard).mockResolvedValue({ status: "stale" });
    const stale = await GET(request, context);
    expect(stale.status).toBe(503);
    expect((await stale.json()).reason).toBe("stale");
  });

  it("returns the five national primaries with descriptions and source labels", async () => {
    const { readResetMetricBoard } = await import("@/lib/resetMetrics/readBoard");
    const board = buildOpeningMetricSnapshots1991("world-test", 1)[0]!;
    vi.mocked(readResetMetricBoard).mockResolvedValue({ status: "ready", board });
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/country/us/reset-metrics"), {
      params: Promise.resolve({ code: "us" }),
    });
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(payload.metrics).toHaveLength(5);
    expect(payload.metrics[0]).toMatchObject({
      description: expect.any(String),
      observation: { source: expect.any(String), owner: expect.any(String) },
    });
  });
});
