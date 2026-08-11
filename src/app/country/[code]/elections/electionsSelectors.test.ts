import { describe, expect, it } from "vitest";
import type { ElectionDisplay } from "@/lib/db/types";
import {
  buildOfficeSections,
  defaultOpenSections,
  OTHER_OFFICE_KEY,
  relevantDeadlineTurn,
  summarize,
} from "./electionsSelectors";

function race(over: Partial<ElectionDisplay> = {}): ElectionDisplay {
  return {
    id: Math.random().toString(36).slice(2),
    electionType: "senate",
    state: "CT",
    countryId: "US",
    cycle: 1,
    status: "active",
    candidates: [],
    endTurn: 192,
    ...over,
  } as ElectionDisplay;
}

function candidate(party = "1") {
  return { id: "c1", characterId: "x", characterName: "A", party };
}

describe("relevantDeadlineTurn", () => {
  it("uses the primary deadline while a race is in its primary", () => {
    expect(relevantDeadlineTurn(race({ inPrimary: true, primaryEndTurn: 144, endTurn: 192 }))).toBe(
      144
    );
  });

  it("uses the general deadline otherwise", () => {
    expect(
      relevantDeadlineTurn(race({ inPrimary: false, primaryEndTurn: 144, endTurn: 192 }))
    ).toBe(192);
  });

  it("falls back to the primary deadline when there is no general turn", () => {
    expect(relevantDeadlineTurn(race({ endTurn: undefined, primaryEndTurn: 144 }))).toBe(144);
  });

  it("returns null when the race carries no turn deadline at all", () => {
    expect(
      relevantDeadlineTurn(race({ endTurn: undefined, primaryEndTurn: undefined }))
    ).toBeNull();
  });
});

describe("summarize", () => {
  it("counts a race with no candidates as uncontested", () => {
    // This is the live 1953 state: 473 active races, zero candidates.
    const s = summarize([race(), race(), race()]);
    expect(s.total).toBe(3);
    expect(s.contested).toBe(0);
  });

  it("counts contested races", () => {
    const s = summarize([race({ candidates: [candidate()] }), race()]);
    expect(s.contested).toBe(1);
  });

  it("reports the soonest deadline across the set", () => {
    const s = summarize([race({ endTurn: 288 }), race({ endTurn: 96 }), race({ endTurn: 192 })]);
    expect(s.nextDeadlineTurn).toBe(96);
  });

  it("ignores races with no deadline when finding the soonest", () => {
    const s = summarize([
      race({ endTurn: undefined, primaryEndTurn: undefined }),
      race({ endTurn: 96 }),
    ]);
    expect(s.nextDeadlineTurn).toBe(96);
  });

  it("excludes presidential races from the competitive count", () => {
    const polled = (shares: Record<string, number>) =>
      ({
        leaderId: "a",
        leaderName: null,
        leaderParty: null,
        sharesPct: shares,
        candidateNames: {},
        candidateParties: {},
        source: "general",
      }) as ElectionDisplay["polling"];
    const s = summarize([
      race({ electionType: "president", state: "US", polling: polled({ a: 51, b: 49 }) }),
      race({ polling: polled({ a: 51, b: 49 }) }),
    ]);
    expect(s.competitive).toBe(1);
  });

  it("returns an all-zero summary for an empty set", () => {
    expect(summarize([])).toEqual({
      total: 0,
      contested: 0,
      competitive: 0,
      nextDeadlineTurn: null,
    });
  });
});

describe("buildOfficeSections", () => {
  it("groups US races by office in config order, executive first", () => {
    const sections = buildOfficeSections("US", [
      race({ electionType: "governor", state: "TX" }),
      race({ electionType: "senate", state: "CT" }),
      race({ electionType: "president", state: "US" }),
      race({ electionType: "house", state: "CA" }),
    ]);
    expect(sections.map((s) => s.key)).toEqual(["president", "senate", "house", "governor"]);
  });

  it("drops offices with no races rather than showing empty sections", () => {
    const sections = buildOfficeSections("US", [race({ electionType: "senate" })]);
    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe("senate");
  });

  it("resolves a chamber-keyed election type into its office section", () => {
    // FR seeds `assembleeNationale`; the office is keyed `deputy`.
    const sections = buildOfficeSections("FR", [
      race({ electionType: "assembleeNationale", countryId: "FR", state: "IDF" }),
    ]);
    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe("deputy");
  });

  it("surfaces an unresolvable race in a visible catch-all rather than dropping it", () => {
    const sections = buildOfficeSections("US", [
      race({ electionType: "senate" }),
      race({ electionType: "spaceCouncil" }),
    ]);
    const other = sections.find((s) => s.key === OTHER_OFFICE_KEY);
    expect(other).toBeDefined();
    expect(other!.total).toBe(1);
    expect(other!.label).toBe("Other races");
    // Nothing is lost.
    expect(sections.reduce((n, s) => n + s.total, 0)).toBe(2);
  });

  it("carries per-section counts and the soonest deadline", () => {
    const sections = buildOfficeSections("US", [
      race({ electionType: "senate", state: "CT", endTurn: 192, candidates: [candidate()] }),
      race({ electionType: "senate", state: "DE", endTurn: 96 }),
    ]);
    expect(sections[0]).toMatchObject({ total: 2, contested: 1, nextDeadlineTurn: 96 });
  });

  it("sorts races within a section by region", () => {
    const sections = buildOfficeSections("US", [
      race({ electionType: "senate", state: "WY" }),
      race({ electionType: "senate", state: "AL" }),
      race({ electionType: "senate", state: "MT" }),
    ]);
    expect(sections[0].elections.map((e) => e.state)).toEqual(["AL", "MT", "WY"]);
  });

  it("does not mutate the caller's array", () => {
    const input = [race({ state: "WY" }), race({ state: "AL" })];
    const before = input.map((e) => e.state);
    buildOfficeSections("US", input);
    expect(input.map((e) => e.state)).toEqual(before);
  });

  it("returns nothing for a country with no races", () => {
    expect(buildOfficeSections("US", [])).toEqual([]);
  });
});

describe("defaultOpenSections", () => {
  it("opens the largest section so the page is never all-closed", () => {
    const sections = buildOfficeSections("US", [
      race({ electionType: "governor", state: "TX" }),
      race({ electionType: "senate", state: "CT" }),
      race({ electionType: "senate", state: "DE" }),
    ]);
    expect(defaultOpenSections(sections)).toEqual(["senate"]);
  });

  it("opens the only section when there is just one", () => {
    const sections = buildOfficeSections("US", [race({ electionType: "senate" })]);
    expect(defaultOpenSections(sections)).toEqual(["senate"]);
  });

  it("handles an empty page", () => {
    expect(defaultOpenSections([])).toEqual([]);
  });
});
