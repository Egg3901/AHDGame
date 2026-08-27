import { describe, expect, it } from "vitest";
import { staticZoneGeometry } from "./proxyHostGeometry";
import { VIETNAM_FEATURE_IDS, VIETNAM_GEO_URL } from "./vietnamGeometry";
import { HISTORICAL_GEO_URL } from "./historicalGeometry";

/**
 * The zone resolver behind the front maps. A conflict is fought over
 * `hostEntities`, not over one country, so this has to answer for the whole
 * roster — the front line is placed as a share of the land the map can see, and
 * a missing host is land the line is measured without.
 */
describe("staticZoneGeometry", () => {
  it("has nothing to add for a zone of ordinary countries", () => {
    // DD and DE are full-autonomous countries: their geometry comes from the
    // region shards, not from a static file. An empty result here is what lets
    // the hook resolve immediately instead of awaiting a fetch that never lands.
    expect(staticZoneGeometry(["DD", "DE"])).toEqual({ urls: [], codes: [] });
  });

  it("collects one shard once when two hosts share it", () => {
    // Both Vietnams resolve to the whole country's shard. Loading it twice would
    // stack two identical silhouettes and double-count the land underneath them.
    const zone = staticZoneGeometry(["NVN", "SVN"]);
    expect(zone.urls).toEqual([VIETNAM_GEO_URL]);
    expect(zone.codes.sort()).toEqual([...VIETNAM_FEATURE_IDS].sort());
  });

  it("merges hosts drawn from different shards", () => {
    const zone = staticZoneGeometry(["NVN", "SAAR"]);
    expect(zone.urls).toContain(VIETNAM_GEO_URL);
    expect(zone.urls).toContain(HISTORICAL_GEO_URL);
    expect(zone.codes).toContain("SAAR");
    expect(zone.codes).toContain("NVN");
  });

  it("skips a host nothing draws without dropping the rest of the zone", () => {
    const zone = staticZoneGeometry(["ZZZ", "NVN"]);
    expect(zone.urls).toEqual([VIETNAM_GEO_URL]);
    expect(zone.codes).toContain("NVN");
  });

  it("answers empty for an empty zone rather than throwing", () => {
    expect(staticZoneGeometry([])).toEqual({ urls: [], codes: [] });
  });
});
