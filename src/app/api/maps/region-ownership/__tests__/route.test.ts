import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/maps/regionOwnership", () => ({
  getRegionDetails: vi.fn().mockResolvedValue({
    NIR: {
      countryId: "IE",
      name: "Northern Ireland",
      population: 1_577_113,
      houseDistricts: 71,
      region: "Ulster",
    },
    LON: { countryId: "UK", name: "London", population: 8_900_000, houseDistricts: 73, region: "" },
  }),
}));

import { GET } from "../route";
import { getRegionDetails } from "@/lib/maps/regionOwnership";
import { allRegionCodes } from "@/lib/maps/regionManifest";

describe("GET /api/maps/region-ownership", () => {
  it("returns live ownership + region detail for the British-Isles regions", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    // ownership is derived from the region details
    expect(body.ownership).toEqual({ NIR: "IE", LON: "UK" });
    // regions carry the live, preset-correct figures the IE map renders
    expect(body.regions.NIR.houseDistricts).toBe(71);
    expect(body.regions.NIR.region).toBe("Ulster");
    // Queried with the full manifest code set (every shard's codes), so adding a
    // country shard keeps the world overlay covered with no route/test edit.
    expect(vi.mocked(getRegionDetails).mock.calls[0][1]).toEqual(allRegionCodes());
  });
});
