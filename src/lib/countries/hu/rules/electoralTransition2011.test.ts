import { describe, expect, it } from "vitest";
import { calendarTurn } from "@/lib/utils/gameDate";
import {
  hu2011DecisionAvailability,
  huAssemblyElectionSystem,
  supportsHu2011NpcAmendment,
} from "./electoralTransition2011";

describe("Hungarian 2011 political electoral transition", () => {
  it("opens only in December 2011 and retains actual constitutional conditions", () => {
    expect(
      hu2011DecisionAvailability({ preset: "1991-default", calendarTurn: 1004 }).available
    ).toBe(false);
    expect(
      hu2011DecisionAvailability({ preset: "1991-default", calendarTurn: 1005 }).available
    ).toBe(true);
    expect(
      hu2011DecisionAvailability({
        preset: "1991-default",
        calendarTurn: 1005,
        hasParliament: false,
      }).reason
    ).toBe("no-legislature");
    expect(
      hu2011DecisionAvailability({
        preset: "1991-default",
        calendarTurn: 1005,
        authorizedTurn: 1005,
      }).reason
    ).toBe("already-authorized");
    expect(
      hu2011DecisionAvailability({
        preset: "1991-default",
        calendarTurn: 1005,
        modernAssemblyYear: 2014,
      }).reason
    ).toBe("modern-law-in-force");
    expect(hu2011DecisionAvailability({ preset: "2019-default", calendarTurn: 1005 }).reason).toBe(
      "other-era"
    );
  });
  it("uses the display calendar after founding turns", () => {
    const date = calendarTurn(1005, { preIterationTurns: 48 });
    expect(
      hu2011DecisionAvailability({ preset: "1991-default", calendarTurn: date }).available
    ).toBe(false);
  });
  it("keeps the original system indefinitely without a decision", () => {
    expect(huAssemblyElectionSystem({ calendarTurn: 1105 })).toBe("mixed-1989-v1");
    expect(huAssemblyElectionSystem({ calendarTurn: 2401 })).toBe("mixed-1989-v1");
  });
  it("waits until 2012 after approval without changing frozen ballots", () => {
    expect(huAssemblyElectionSystem({ calendarTurn: 1008, authorizedTurn: 1005 })).toBe(
      "mixed-1989-v1"
    );
    expect(huAssemblyElectionSystem({ calendarTurn: 1009, authorizedTurn: 1005 })).toBe(
      "mixed-2011-v1"
    );
    expect(
      huAssemblyElectionSystem({
        calendarTurn: 1105,
        authorizedTurn: 1005,
        frozenSystem: "mixed-1989-v1",
      })
    ).toBe("mixed-1989-v1");
    expect(huAssemblyElectionSystem({ calendarTurn: 1105, frozenSystem: "mixed-2011-v1" })).toBe(
      "mixed-2011-v1"
    );
  });
  it("preserves completed modern settlements in older saves", () => {
    expect(huAssemblyElectionSystem({ calendarTurn: 1105, legacyModernAssemblyYear: 2014 })).toBe(
      "mixed-2011-v1"
    );
  });
  it("requires a bounded governing two-thirds mandate for NPC introduction", () => {
    expect(supportsHu2011NpcAmendment(257, 386)).toBe(false);
    expect(supportsHu2011NpcAmendment(258, 386)).toBe(true);
    expect(supportsHu2011NpcAmendment(387, 386)).toBe(false);
    expect(supportsHu2011NpcAmendment(258.5, 386)).toBe(false);
    expect(supportsHu2011NpcAmendment(0, 0)).toBe(false);
  });
  it("rejects malformed clocks and authorization turns", () => {
    expect(() =>
      hu2011DecisionAvailability({ preset: "1991-default", calendarTurn: NaN })
    ).toThrow();
    expect(() => huAssemblyElectionSystem({ calendarTurn: 1105, authorizedTurn: -1 })).toThrow();
  });
});
