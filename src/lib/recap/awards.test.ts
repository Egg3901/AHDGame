import { describe, it, expect } from "vitest";
import { assignAwards, buildPersona } from "./awards";
import { recapAccent, contrastOnBlack } from "./accent";
import type { CharacterRecap } from "./types";

function recap(o: Partial<CharacterRecap> & { characterId: string }): CharacterRecap {
  return {
    schemaVersion: 2,
    name: o.characterId,
    party: "Labour",
    countryId: "UK",
    countryName: "United Kingdom",
    iteration: null,
    tenureTurns: 900,
    highestOffice: null,
    actions: { total: 10, byType: {}, topType: null, rank: null },
    influence: { politicalInfluence: 0, nationalInfluence: 0, npi: null },
    favorability: null,
    infamy: 0,
    netWorth: null,
    campaignFunds: null,
    elections: { entered: 0, won: 0, lost: 0 },
    bills: { sponsored: 0, passed: 0 },
    social: null,
    achievements: { count: 0, highlights: [] },
    ...o,
  };
}

describe("assignAwards", () => {
  it("gives a world podium and country firsts without double-awarding", () => {
    const field = [
      recap({ characterId: "a", elections: { entered: 9, won: 9, lost: 0 } }),
      recap({ characterId: "b", elections: { entered: 5, won: 5, lost: 0 } }),
      recap({ characterId: "c", elections: { entered: 4, won: 4, lost: 0 } }),
      recap({
        characterId: "d",
        countryId: "DE",
        countryName: "West Germany",
        elections: { entered: 3, won: 3, lost: 0 },
      }),
      recap({
        characterId: "e",
        countryId: "DE",
        countryName: "West Germany",
        elections: { entered: 2, won: 2, lost: 0 },
      }),
      recap({
        characterId: "f",
        countryId: "DE",
        countryName: "West Germany",
        elections: { entered: 1, won: 1, lost: 0 },
      }),
    ];
    const awards = assignAwards(field);
    const races = (id: string) =>
      (awards.get(id) ?? []).filter((a) => a.title.includes("races won"));
    expect(races("a")[0]).toMatchObject({ title: "Most races won in the world", rank: 1 });
    expect(races("c")[0]).toMatchObject({ title: "3rd most races won in the world" });
    // UK #1 is already the world #1, so no separate UK award.
    expect(races("a")).toHaveLength(1);
    expect(races("d")[0]).toMatchObject({
      title: "Most races won in West Germany",
      scope: "country",
    });
    expect(races("e")).toHaveLength(0);
  });

  it("skips a zero metric and small fields", () => {
    const awards = assignAwards([recap({ characterId: "a" }), recap({ characterId: "b" })]);
    expect(awards.size).toBe(0);
  });
});

describe("buildPersona", () => {
  it("names the top office first", () => {
    const p = buildPersona(
      recap({
        characterId: "a",
        climb: [{ label: "Prime Minister", rank: 8, turn: 900, date: { year: 1970, month: 1 } }],
        bills: { sponsored: 9, passed: 9 },
      })
    );
    expect(p.key).toBe("leader");
    expect(p.reason).toContain("Prime Minister");
  });

  it("reads the action mix", () => {
    const p = buildPersona(
      recap({
        characterId: "a",
        actions: {
          total: 100,
          byType: { fundraise: 35, buildDonorBase: 10, campaign: 55 },
          topType: "campaign",
          rank: null,
        },
      })
    );
    expect(p.key).toBe("campaigner");
    expect(p.reason).toBe("55% of your actions campaigned or ran ads.");
  });

  it("falls back to the backbencher with real numbers", () => {
    const p = buildPersona(
      recap({ characterId: "a", actions: { total: 12, byType: {}, topType: null, rank: null } })
    );
    expect(p.key).toBe("backbencher");
    expect(p.reason).toBe("12 actions across 19 game years.");
  });
});

describe("recapAccent", () => {
  it("lifts a dark party color until it reads on black", () => {
    const navy = recapAccent("#0B1E3B");
    expect(contrastOnBlack(navy)).toBeGreaterThanOrEqual(6);
    expect(navy).not.toBe("#0b1e3b");
  });

  it("keeps a light color and falls back on junk", () => {
    expect(recapAccent("#FDBB30")).toBe("#fdbb30");
    expect(recapAccent("not a color")).toBe("#6EA8FE");
    expect(recapAccent(null)).toBe("#6EA8FE");
  });
});
