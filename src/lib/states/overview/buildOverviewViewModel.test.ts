import { describe, it, expect } from "vitest";
import { buildOverviewViewModel } from "./buildOverviewViewModel";
import type { StateOverviewResult } from "./types";

const NEUTRAL_COLOR = "#6b6b7a";

const fixture: StateOverviewResult = {
  stateId: "PA",
  countryId: "US",
  kpis: {
    topPartyOrgPct: 42,
    topPartyId: "dem",
    topPartyRegPct: 44,
    regSource: "field",
    gdp: 940_000_000_000,
    competitiveRacesCount: 4,
  },
  partyOrg: [
    { id: "dem", abbr: "DEM", name: "Democratic Party", color: "#2563eb", orgPct: 42, regPct: 44 },
    { id: "gop", abbr: "GOP", name: "Republican Party", color: "#dc2626", orgPct: 41, regPct: 42 },
    {
      id: "wfp",
      abbr: "WFP",
      name: "Working Families Party",
      color: "#7c3aed",
      orgPct: 4,
      regPct: 4,
    },
  ],
  unaffiliatedPct: 13,
  regionalExecutive: { partyId: "dem", sign: 2, label: "Governor" },
  hotRaces: [],
  contestedPrimaries: [],
  registrationPool: { parties: [], independent: 0, unregistered: 0, seeded: false },
  economy: { gdp: 940_000_000_000, gdpDeltaPct: 1.4, topSectors: [], unemployment: 4.2 },
};

describe("buildOverviewViewModel", () => {
  it("highlights the viewer's party slice when they have one", () => {
    const vm = buildOverviewViewModel(fixture, { viewerPartyId: "gop" });
    expect(vm.pieFocusPartyId).toBe("gop");
    expect(vm.focusPartyColor).toBe("#dc2626");
    expect(vm.focusPartyAbbr).toBe("GOP");
    expect(vm.narrative.rank).toBe(2);
    expect(vm.narrative.totalParties).toBe(3);
    expect(vm.narrative.gapToTop).toBeCloseTo(1.0, 1);
  });

  it("surfaces the focus party's OWN org pct, not the leader's", () => {
    // Regression: the donut center previously paired focusPartyAbbr with the
    // leader's org pct (kpis.topPartyOrgPct), so an RFP/GOP viewer saw their
    // own abbr glued to REP/DEM's number. The focus party's own pct must
    // travel with its abbr.
    const vm = buildOverviewViewModel(fixture, { viewerPartyId: "gop" });
    expect(vm.focusPartyOrgPct).toBe(41);
    expect(vm.focusPartyOrgPct).not.toBe(vm.kpis.topPartyOrgPct);
  });

  it("falls back to the leading party when the viewer has none", () => {
    const vm = buildOverviewViewModel(fixture, { viewerPartyId: null });
    expect(vm.pieFocusPartyId).toBe("dem");
    expect(vm.focusPartyColor).toBe("#2563eb");
    expect(vm.focusPartyAbbr).toBe("DEM");
    expect(vm.focusPartyOrgPct).toBe(42);
    expect(vm.narrative.rank).toBe(1);
    expect(vm.narrative.gapToTop).toBe(0);
  });

  it("falls back to the leading party when the viewer's party has no row in this state", () => {
    const vm = buildOverviewViewModel(fixture, { viewerPartyId: "lib" });
    expect(vm.pieFocusPartyId).toBe("dem");
  });

  it("ranks the bottom party correctly", () => {
    const vm = buildOverviewViewModel(fixture, { viewerPartyId: "wfp" });
    expect(vm.narrative.rank).toBe(3);
    expect(vm.narrative.gapToTop).toBeCloseTo(38, 0);
  });

  it("preserves all StateOverviewResult fields on the view-model", () => {
    const vm = buildOverviewViewModel(fixture, { viewerPartyId: "dem" });
    expect(vm.stateId).toBe("PA");
    expect(vm.kpis).toBe(fixture.kpis);
    expect(vm.partyOrg).toBe(fixture.partyOrg);
    expect(vm.unaffiliatedPct).toBe(13);
    expect(vm.regionalExecutive).toBe(fixture.regionalExecutive);
  });

  it("handles empty partyOrg lists without throwing", () => {
    const empty: StateOverviewResult = {
      ...fixture,
      partyOrg: [],
      kpis: { ...fixture.kpis, topPartyId: "", topPartyOrgPct: 0, topPartyRegPct: 0 },
    };
    const vm = buildOverviewViewModel(empty, { viewerPartyId: null });
    expect(vm.pieFocusPartyId).toBe("");
    expect(vm.focusPartyColor).toBe(NEUTRAL_COLOR);
    expect(vm.focusPartyAbbr).toBe("");
    expect(vm.focusPartyOrgPct).toBe(0);
    expect(vm.narrative.rank).toBe(0);
    expect(vm.narrative.totalParties).toBe(0);
    expect(vm.narrative.gapToTop).toBe(0);
  });
});
