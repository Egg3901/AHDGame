import { describe, expect, it } from "vitest";
import {
  bg1991DecisionAvailability,
  passesBgConstitution1991,
  bg1991ConstituentDisposition,
  passesBgContinuedAssemblyDissolution,
  bgContinuedAssemblyDissolutionAvailability,
} from "./constitutionalDecision1991";
import { bgRegions1991 } from "../data/bgRegions1991";
import {
  bgElectionSeatsForPreset,
  isBgOrdinaryCapacity,
  BG_ORDINARY_ASSEMBLY_SEATS,
} from "./assemblyTransition";
describe("Bulgarian founding constitutional authority", () => {
  it("opens in July1991 with no automatic adoption and preserves old settlements", () => {
    expect(bg1991DecisionAvailability({ preset: "1991-default", calendarTurn: 24 }).available).toBe(
      false
    );
    expect(bg1991DecisionAvailability({ preset: "1991-default", calendarTurn: 25 }).available).toBe(
      true
    );
    expect(
      bg1991DecisionAvailability({ preset: "1991-default", calendarTurn: 1000, completedTurn: 41 })
        .reason
    ).toBe("existing-settlement");
    expect(
      bg1991DecisionAvailability({ preset: "1991-default", calendarTurn: 1000, authorizedTurn: 25 })
        .available
    ).toBe(false);
    expect(bg1991DecisionAvailability({ preset: "2027-default", calendarTurn: 25 }).available).toBe(
      false
    );
  });
  it("uses two thirds of the whole400-seat constituent chamber", () => {
    expect(passesBgConstitution1991({ for: 266, against: 0, abstain: 0 }, 400)).toBe(false);
    expect(passesBgConstitution1991({ for: 267, against: 133, abstain: 0 }, 400)).toBe(true);
    expect(passesBgConstitution1991({ for: 267, against: 134, abstain: 0 }, 400)).toBe(false);
    expect(passesBgConstitution1991({ for: NaN, against: 0, abstain: 0 }, 400)).toBe(false);
  });
  it("retains founding capacities until a decision and routes frozen ballots correctly", () => {
    const old = Object.fromEntries(bgRegions1991.map((row) => [row._id, row.houseDistricts]));
    expect(bgElectionSeatsForPreset(old, "1991-default", false)).toEqual(old);
    expect(bgElectionSeatsForPreset(old, "1991-default", false, true)).toEqual(
      BG_ORDINARY_ASSEMBLY_SEATS
    );
    expect(bgElectionSeatsForPreset(old, "1991-default", true, true)).toEqual(old);
    for (const region of bgRegions1991) {
      expect(isBgOrdinaryCapacity(String(region._id), region.houseDistricts)).toBe(false);
      expect(
        isBgOrdinaryCapacity(String(region._id), BG_ORDINARY_ASSEMBLY_SEATS[String(region._id)])
      ).toBe(true);
    }
  });
});

describe("explicit constituent transitional clauses", () => {
  it("preserves old drafts as dissolution and keeps continuation explicit", () => {
    expect(bg1991ConstituentDisposition()).toBe("dissolve");
    expect(bg1991ConstituentDisposition("continue")).toBe("continue");
  });
  it.each([
    [201, 199, 0, true],
    [200, 200, 0, false],
    [101, 100, 0, true],
    [100, 101, 0, false],
    [200, 0, 0, false],
    [101, 0, 100, true],
    [201, 201, 0, false],
  ] as const)(
    "requires a quorate ordinary majority for%s/%s/%s",
    (forVotes, against, abstain, pass) => {
      expect(
        passesBgContinuedAssemblyDissolution(
          { for: forVotes, against: against, abstain: abstain },
          400
        )
      ).toBe(pass);
    }
  );
  it("does not confuse ordinary dissolution with constituent adoption", () => {
    expect(passesBgContinuedAssemblyDissolution({ for: 201, against: 199, abstain: 0 }, 400)).toBe(
      true
    );
    expect(passesBgConstitution1991({ for: 201, against: 199, abstain: 0 }, 400)).toBe(false);
    expect(passesBgContinuedAssemblyDissolution({ for: NaN, against: 0, abstain: 0 }, 400)).toBe(
      false
    );
  });
  it("opens dissolution only under an enacted continuation and preserves existing settlements", () => {
    const input = { preset: "1991-default", turn: 30, constitutionTurn: 26, continuationTurn: 26 };
    expect(bgContinuedAssemblyDissolutionAvailability(input).available).toBe(true);
    expect(
      bgContinuedAssemblyDissolutionAvailability({ ...input, continuationTurn: undefined })
        .available
    ).toBe(false);
    expect(bgContinuedAssemblyDissolutionAvailability({ ...input, founding: true }).available).toBe(
      false
    );
    expect(
      bgContinuedAssemblyDissolutionAvailability({ ...input, dissolutionTurn: 29 }).available
    ).toBe(false);
    expect(
      bgContinuedAssemblyDissolutionAvailability({ ...input, ordinaryTurn: 29 }).available
    ).toBe(false);
    expect(
      bgContinuedAssemblyDissolutionAvailability({ ...input, hasParliament: false }).available
    ).toBe(false);
  });
});
