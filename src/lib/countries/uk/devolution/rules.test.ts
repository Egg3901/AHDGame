import { isLegislationTypeActive } from "@/lib/era/legislationCatalog";
import { isMetricActive } from "@/lib/era/metricCatalog";
import { UK_FIRST_MINISTERS_1992 } from "@/lib/constants/historicalSeats";
import { describe, expect, it } from "vitest";
import { canonicalTurnsForCycle } from "@/lib/elections/canonicalCycle";
import { applyUKDevolutionPolicy, executiveCycleAnchor, initialUKDevolutionState } from "./rules";

describe("UK executive settlement", () => {
  it("does not let a general devolution law bypass Northern Ireland public ratification", () => {
    const state = {
      ...initialUKDevolutionState(1991),
      northernIrelandPeace: { posture: "unsettled" as const, changedTurn: 1 },
    };
    const next = applyUKDevolutionPolicy(
      state,
      { billId: "general-law", optionIndex: 1, enactedTurn: 10 },
      {},
      72
    );
    expect(next.regions.SCO.active).toBe(true);
    expect(next.regions.NIR.active).toBe(false);
  });
  it("opens the political decision before institutions exist", () => {
    expect(isLegislationTypeActive("uk_devolution_local_powers", 1978)).toBe(false);
    for (const year of [1979, 1991, 1997]) {
      expect(isLegislationTypeActive("uk_devolution_local_powers", year)).toBe(true);
      expect(isMetricActive("devolutionSatisfaction", "UK", year)).toBe(true);
      const state = initialUKDevolutionState(year);
      expect(Object.values(state.regions).every((region) => !region.active)).toBe(true);
      expect(applyUKDevolutionPolicy(state, null, {}, 72)).toBe(state);
    }
  });

  it("does not create regional executives in a 1991 starting settlement", () => {
    expect(UK_FIRST_MINISTERS_1992).toEqual([]);
    expect(Object.values(initialUKDevolutionState(1991).regions).every((r) => !r.active)).toBe(
      true
    );
  });

  it("preserves established modern institutions and London's later founding", () => {
    expect(initialUKDevolutionState(1999).regions.SCO.active).toBe(true);
    expect(initialUKDevolutionState(1999).regions.LON.active).toBe(false);
    expect(Object.values(initialUKDevolutionState(2019).regions).every((r) => r.active)).toBe(true);
  });

  it("requires an enacted founding option and never mutates the prior settlement", () => {
    const original = initialUKDevolutionState(1991);
    expect(applyUKDevolutionPolicy(original, null, {}, 72)).toBe(original);
    for (const optionIndex of [4, 5, 6]) {
      const state = applyUKDevolutionPolicy(
        original,
        { billId: "restrict", optionIndex, enactedTurn: 90 },
        {},
        72
      );
      expect(Object.values(state.regions).every((r) => !r.active)).toBe(true);
    }
    for (const optionIndex of [0, 1, 2, 3]) {
      const state = applyUKDevolutionPolicy(
        original,
        { billId: "found", optionIndex, enactedTurn: 90 },
        {},
        72
      );
      expect(state.regions.SCO).toEqual({ active: true, firstCycle: 1, firstElectionEndTurn: 162 });
    }
    expect(original.regions.SCO.active).toBe(false);
  });

  it("keeps the founding election anchor through retries and later settlement laws", () => {
    const policy = { billId: "found", optionIndex: 3, enactedTurn: 90 };
    const founded = applyUKDevolutionPolicy(initialUKDevolutionState(1991), policy, {}, 72);
    expect(applyUKDevolutionPolicy(founded, policy, {}, 72)).toBe(founded);
    const retained = applyUKDevolutionPolicy(
      founded,
      { ...policy, billId: "amend", enactedTurn: 190 },
      {},
      72
    );
    expect(retained.regions).toEqual(founded.regions);
  });

  it("abolishes and restores offices without reusing past election cycles", () => {
    const abolished = applyUKDevolutionPolicy(
      initialUKDevolutionState(2019),
      { billId: "abolish", optionIndex: 6, enactedTurn: 400 },
      { SCO: 3 },
      72
    );
    expect(abolished.regions.SCO.active).toBe(false);
    const restored = applyUKDevolutionPolicy(
      abolished,
      { billId: "restore", optionIndex: 3, enactedTurn: 500 },
      { SCO: 3 },
      72
    );
    expect(restored.regions.SCO).toEqual({
      active: true,
      firstCycle: 4,
      firstElectionEndTurn: 572,
    });
    const anchor = executiveCycleAnchor(restored.regions.SCO, 192);
    expect(
      canonicalTurnsForCycle({
        electionType: "governor",
        countryId: "UK",
        cycle: 4,
        customCycle1EndTurn: anchor,
      })?.endTurn
    ).toBe(572);
    expect(
      canonicalTurnsForCycle({
        electionType: "governor",
        countryId: "UK",
        cycle: 5,
        customCycle1EndTurn: anchor,
      })?.endTurn
    ).toBe(764);
  });
});
