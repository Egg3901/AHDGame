import { describe, expect, it } from "vitest";
import { chamberBreakdown, readAtlasPreferences } from "./atlasModel";
import type { MapOfficeholder } from "@/lib/map/officeholderService";

const holder = (overrides: Partial<MapOfficeholder>): MapOfficeholder => ({
  id: "seat",
  name: "Example official",
  office: "house",
  party: "1",
  partyName: "Example party",
  color: "#123456",
  avatarUrl: null,
  seats: 1,
  ...overrides,
});

describe("atlas chamber charts", () => {
  it("counts multi-seat delegations without assigning a state's entire delegation to its leader", () => {
    expect(
      chamberBreakdown(
        [
          holder({ seats: 5 }),
          holder({ seats: 2 }),
          holder({ party: "2", partyName: "Other party", seats: 4 }),
          holder({ office: "senate", seats: 1 }),
        ],
        "house"
      ).map((r) => [r.id, r.value])
    ).toEqual([
      ["1", 7],
      ["2", 4],
    ]);
  });
  it("excludes zero-seat delegations and preserves empty charts", () => {
    expect(chamberBreakdown([holder({ seats: 0 })], "house")).toEqual([]);
    expect(chamberBreakdown([], "senate")).toEqual([]);
  });
});
describe("atlas display preferences", () => {
  it("recovers from malformed, stale and missing browser storage", () => {
    for (const raw of [null, "broken", "null", "[]", '{"view":"obsolete","labels":"false"}']) {
      expect(readAtlasPreferences(raw)).toEqual({ view: "atlas", labels: true, charts: true });
    }
  });
  it("restores explicit false values and the chosen display", () => {
    expect(readAtlasPreferences('{"view":"table","labels":false,"charts":false}')).toEqual({
      view: "table",
      labels: false,
      charts: false,
    });
  });
});
