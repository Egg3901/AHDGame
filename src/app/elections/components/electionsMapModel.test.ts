import { describe, expect, it } from "vitest";
import type { ElectionDisplay } from "@/lib/db/types";
import {
  buildLegend,
  buildRegionGroups,
  buildRegionMapData,
  filterByRegion,
  filterElections,
  isMapAvailable,
  selectElectionGroups,
  type MapRegionGroup,
} from "./electionsMapModel";

function election(over: Partial<ElectionDisplay> = {}): ElectionDisplay {
  return {
    id: "e1",
    state: "NE",
    electionType: "governor",
    status: "active",
    candidates: [],
    ...over,
  } as unknown as ElectionDisplay;
}

function polled(partyId: string, name: string, color: string, pcts: number[]) {
  return {
    leaderId: "c1",
    leaderName: "Leader",
    leaderParty: partyId,
    sharesPct: Object.fromEntries(pcts.map((p, i) => [`c${i + 1}`, p])),
    candidateNames: { c1: "Leader" },
    candidateParties: { c1: partyId },
    candidatePartyNames: { c1: name },
    candidatePartyColors: { c1: color },
    source: "general" as const,
  };
}

describe("filterElections", () => {
  const all = { race: "", hideUpcoming: false, competitive: false };

  it("does not apply any region filter — that is the map's input", () => {
    const elections = [election({ state: "NE" }), election({ state: "IA" })];
    expect(filterElections(elections, all)).toHaveLength(2);
  });

  it("selects a single senate class", () => {
    const elections = [
      election({ electionType: "senate", senateClass: 1 } as Partial<ElectionDisplay>),
      election({ electionType: "senate", senateClass: 2 } as Partial<ElectionDisplay>),
      election({ electionType: "governor" }),
    ];
    const out = filterElections(elections, { ...all, race: "senate-2" });
    expect(out).toHaveLength(1);
    expect((out[0] as unknown as { senateClass: number }).senateClass).toBe(2);
  });

  it("matches non-senate races by election type", () => {
    const elections = [election({ electionType: "governor" }), election({ electionType: "house" })];
    expect(filterElections(elections, { ...all, race: "governor" })).toHaveLength(1);
  });

  it("drops upcoming races only when asked", () => {
    const elections = [election({ status: "upcoming" }), election({ status: "active" })];
    expect(filterElections(elections, all)).toHaveLength(2);
    expect(filterElections(elections, { ...all, hideUpcoming: true })).toHaveLength(1);
  });

  it("selects races by primary stage", () => {
    const elections = [
      election({ inPrimary: true } as Partial<ElectionDisplay>),
      election({ inPrimary: false } as Partial<ElectionDisplay>),
    ];
    expect(filterElections(elections, all)).toHaveLength(2);
    expect(filterElections(elections, { ...all, primary: "in" })).toHaveLength(1);
    expect(filterElections(elections, { ...all, primary: "out" })).toHaveLength(1);
    expect(
      (
        filterElections(elections, { ...all, primary: "in" })[0] as unknown as {
          inPrimary: boolean;
        }
      ).inPrimary
    ).toBe(true);
  });

  it("treats a lone candidate as uncontested, two or more as contested", () => {
    const elections = [
      election({ candidates: [] }),
      election({ candidates: [{ id: "c1" }] } as unknown as Partial<ElectionDisplay>),
      election({ candidates: [{ id: "c1" }, { id: "c2" }] } as unknown as Partial<ElectionDisplay>),
    ];
    expect(filterElections(elections, { ...all, contest: "uncontested" })).toHaveLength(2);
    expect(filterElections(elections, { ...all, contest: "contested" })).toHaveLength(1);
  });

  it("keeps presidential races when filtering to competitive ones", () => {
    const elections = [
      election({ electionType: "president", state: "US" }),
      election({ polling: polled("1", "Dem", "#3B82F6", [80, 20]) }),
    ];
    const out = filterElections(elections, { ...all, competitive: true });
    expect(out).toHaveLength(1);
    expect(out[0].electionType).toBe("president");
  });
});

describe("filterByRegion", () => {
  it("narrows to the selected region", () => {
    const elections = [election({ state: "NE" }), election({ state: "IA" })];
    expect(filterByRegion(elections, "NE")).toHaveLength(1);
  });

  it("keeps national presidential races while a region is selected", () => {
    const elections = [
      election({ state: "US", electionType: "president" }),
      election({ state: "IA" }),
    ];
    const out = filterByRegion(elections, "NE");
    expect(out).toHaveLength(1);
    expect(out[0].electionType).toBe("president");
  });

  it("is a no-op with no region selected", () => {
    const elections = [election({ state: "NE" }), election({ state: "IA" })];
    expect(filterByRegion(elections, "")).toHaveLength(2);
  });
});

describe("buildRegionGroups", () => {
  it("groups by region and drops empty ones", () => {
    const groups = buildRegionGroups(
      ["NE", "IA", "TX"],
      [election({ state: "NE" }), election({ state: "IA" })]
    );
    expect(groups.map((g) => g.stateId)).toEqual(["NE", "IA"]);
  });

  it("floats the national group first", () => {
    const groups = buildRegionGroups(
      ["NE", "US"],
      [election({ state: "NE" }), election({ state: "US", electionType: "president" })]
    );
    expect(groups[0].stateId).toBe("US");
  });
});

describe("selectElectionGroups", () => {
  const allStates = ["NE", "IA", "TX"];
  const elections = [
    election({ state: "NE", electionType: "governor" }),
    election({ state: "IA", electionType: "governor" }),
    election({ state: "TX", electionType: "governor" }),
  ];
  const base = { race: "governor", hideUpcoming: false, competitive: false, region: "" };

  it("gives the map every region and the list only the selected one", () => {
    // Regression: the map collapsed to a single state because its groups were
    // built from the region-filtered list. The map's input must stay
    // country-wide no matter which region is selected.
    const { mapGroups, listGroups } = selectElectionGroups(elections, allStates, {
      ...base,
      region: "NE",
    });

    expect(mapGroups.map((g) => g.stateId)).toEqual(["NE", "IA", "TX"]);
    expect(listGroups.map((g) => g.stateId)).toEqual(["NE"]);
  });

  it("matches the list when no region is selected", () => {
    const { mapGroups, listGroups } = selectElectionGroups(elections, allStates, base);
    expect(mapGroups.map((g) => g.stateId)).toEqual(listGroups.map((g) => g.stateId));
  });

  it("still applies race filters to the map", () => {
    const mixed = [...elections, election({ state: "NE", electionType: "house" })];
    const { mapGroups } = selectElectionGroups(mixed, allStates, { ...base, race: "house" });
    expect(mapGroups.map((g) => g.stateId)).toEqual(["NE"]);
  });

  it("narrows listElections while keeping national races visible", () => {
    const withPresident = [...elections, election({ state: "US", electionType: "president" })];
    const { listElections } = selectElectionGroups(withPresident, [...allStates, "US"], {
      ...base,
      race: "",
      region: "NE",
    });
    const states = listElections.map((e) => e.state).sort();
    expect(states).toEqual(["NE", "US"]);
  });
});

describe("isMapAvailable", () => {
  const groups: MapRegionGroup[] = [{ stateId: "NE", elections: [election()] }];

  it("is available for a state-scoped race in a country with geometry", () => {
    expect(isMapAvailable("US", "governor", groups)).toBe(true);
  });

  it("is unavailable when no specific race is selected", () => {
    expect(isMapAvailable("US", "", groups)).toBe(false);
  });

  it("is unavailable for national presidential races", () => {
    const national: MapRegionGroup[] = [
      { stateId: "US", elections: [election({ state: "US", electionType: "president" })] },
    ];
    expect(isMapAvailable("US", "president", national)).toBe(false);
  });

  it("is unavailable for countries without geometry even when they have a house", () => {
    const ng: MapRegionGroup[] = [
      {
        stateId: "NORTH_WEST",
        elections: [election({ state: "NORTH_WEST", electionType: "house" })],
      },
    ];
    expect(isMapAvailable("NG", "house", ng)).toBe(false);
  });

  it("is available for UK/JP/DE region races", () => {
    expect(
      isMapAvailable("UK", "commons", [
        { stateId: "LON", elections: [election({ state: "LON", electionType: "commons" })] },
      ])
    ).toBe(true);
    expect(
      isMapAvailable("DE", "bundestag", [
        { stateId: "BW", elections: [election({ state: "BW", electionType: "bundestag" })] },
      ])
    ).toBe(true);
  });

  it("is unavailable when no group sits in a mappable region", () => {
    expect(isMapAvailable("US", "governor", [{ stateId: "ZZ", elections: [election()] }])).toBe(
      false
    );
  });

  it("ignores groups with no elections", () => {
    expect(isMapAvailable("US", "governor", [{ stateId: "NE", elections: [] }])).toBe(false);
  });
});

describe("buildRegionMapData", () => {
  it("keys colors and tooltips by region", () => {
    const groups: MapRegionGroup[] = [
      {
        stateId: "NE",
        elections: [election({ polling: polled("2", "Republican Party", "#EF4444", [60, 40]) })],
      },
    ];
    const data = buildRegionMapData(groups);
    expect(data.NE.color).toBe("#EF4444");
    expect(data.NE.label).toBe("NE");
    expect(data.NE.tooltip?.[0]).toContain("Governor");
  });

  it("omits regions with no elections", () => {
    expect(buildRegionMapData([{ stateId: "NE", elections: [] }])).toEqual({});
  });

  it("marks competitive races in the tooltip", () => {
    const groups: MapRegionGroup[] = [
      {
        stateId: "NE",
        elections: [election({ polling: polled("1", "Democratic Party", "#3B82F6", [51, 49]) })],
      },
    ];
    expect(buildRegionMapData(groups).NE.tooltip?.[0]).toContain("⚡");
  });
});

describe("buildLegend", () => {
  it("derives entries from polling rather than hardcoded US parties", () => {
    const groups: MapRegionGroup[] = [
      {
        stateId: "BW",
        elections: [election({ polling: polled("cdu", "CDU", "#000000", [55, 45]) })],
      },
      {
        stateId: "BY",
        elections: [election({ polling: polled("spd", "SPD", "#E3000F", [70, 30]) })],
      },
      {
        stateId: "BE",
        elections: [election({ polling: polled("spd", "SPD", "#E3000F", [65, 35]) })],
      },
    ];
    const { parties, hasUnpolled } = buildLegend(groups);
    expect(parties.map((p) => p.name)).toEqual(["SPD", "CDU"]);
    expect(parties[0].regions).toBe(2);
    expect(parties[0].color).toBe("#E3000F");
    expect(hasUnpolled).toBe(false);
  });

  it("flags unpolled regions instead of inventing a party", () => {
    const { parties, hasUnpolled } = buildLegend([{ stateId: "NE", elections: [election()] }]);
    expect(parties).toEqual([]);
    expect(hasUnpolled).toBe(true);
  });

  it("orders ties deterministically by party name", () => {
    const groups: MapRegionGroup[] = [
      {
        stateId: "BY",
        elections: [election({ polling: polled("spd", "SPD", "#E3000F", [70, 30]) })],
      },
      {
        stateId: "BW",
        elections: [election({ polling: polled("cdu", "CDU", "#000000", [55, 45]) })],
      },
    ];
    const runs = Array.from({ length: 20 }, () =>
      buildLegend(groups)
        .parties.map((p) => p.name)
        .join(",")
    );
    expect(new Set(runs).size).toBe(1);
    expect(runs[0]).toBe("CDU,SPD");
  });
});
