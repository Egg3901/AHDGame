import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/policy/regionPolicyRecordPayload", () => ({
  loadRegionPolicyRecordPayload: vi.fn(),
}));

const { loadRegionPolicyRecordPayload } = await import("@/lib/policy/regionPolicyRecordPayload");
const { GET } = await import("./route");

const load = vi.mocked(loadRegionPolicyRecordPayload);

const EMPTY = { points: [], events: [], era: null, provenance: {} };

function req() {
  return new Request("http://localhost/api/country/us/region/ga/policy/record");
}

function params(code: string, id: string) {
  return { params: Promise.resolve({ code, id }) };
}

describe("GET /api/country/[code]/region/[id]/policy/record", () => {
  beforeEach(() => {
    load.mockReset();
    load.mockResolvedValue(EMPTY as never);
  });

  it("400s for an unknown country code", async () => {
    const res = await GET(req(), params("zz", "GA"));
    expect(res.status).toBe(400);
    expect(load).not.toHaveBeenCalled();
  });

  it("upper-cases the region id before loading", async () => {
    await GET(req(), params("us", "ga"));
    expect(load).toHaveBeenCalledWith("US", "GA");
  });

  it("returns the payload and forbids caching", async () => {
    const res = await GET(req(), params("us", "ga"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(await res.json()).toEqual(EMPTY);
  });

  it("returns 200 with an empty record for a region that has enacted nothing", async () => {
    // The common case: 81 of 116 regions have no law of their own. An empty
    // record is a valid answer, not an error.
    const res = await GET(req(), params("us", "wy"));
    expect(res.status).toBe(200);
    expect((await res.json()).events).toEqual([]);
  });

  it("surfaces a loader failure as a handled error", async () => {
    load.mockRejectedValue(new Error("db down"));
    const res = await GET(req(), params("us", "ga"));
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
