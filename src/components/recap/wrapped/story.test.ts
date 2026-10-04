import { describe, it, expect } from "vitest";
import type { CharacterRecap } from "@/lib/recap/types";
import { money } from "@/lib/recap/format";
import { actionLabel, buildStory, guessOptions } from "./story";

function recap(o: Partial<CharacterRecap> = {}): CharacterRecap {
  return {
    schemaVersion: 1,
    characterId: "6a77b65918e42bc9dfb15aca",
    name: "P",
    party: "Labour",
    countryId: "UK",
    iteration: null,
    tenureTurns: 100,
    highestOffice: null,
    actions: { total: 0, byType: {}, topType: null, rank: null },
    influence: {
      politicalInfluence: 0,
      nationalInfluence: 0,
      npi: { value: 0, rank: 3, total: 3 },
    },
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

const kinds = (r: CharacterRecap) => buildStory(r).map((s) => s.kind);

describe("buildStory", () => {
  it("plays open and finale for an empty life, and skips zero-influence standings", () => {
    expect(kinds(recap())).toEqual(["open", "finale"]);
  });

  it("plays a v1 recap from its v1 fields only", () => {
    const k = kinds(
      recap({
        actions: {
          total: 50,
          byType: { campaign: 30, fundraise: 15, poll: 5 },
          topType: "campaign",
          rank: null,
        },
        highestOffice: "MP",
        elections: { entered: 2, won: 1, lost: 1 },
        influence: {
          politicalInfluence: 1,
          nationalInfluence: 9,
          npi: { value: 9, rank: 1, total: 5 },
        },
        achievements: { count: 2, highlights: [] },
      })
    );
    expect(k).toEqual(["open", "strip", "guess", "climb", "votes", "standing", "honors", "finale"]);
  });

  it("prefers the race slide when a single-seat story exists", () => {
    const race = {
      label: "Seat",
      year: 1960,
      turn: 1,
      won: true,
      seats: 1,
      marginPct: 5,
      marginVotes: 50,
      field: [],
    };
    const k = kinds(
      recap({
        elections: { entered: 1, won: 1, lost: 0 },
        races: {
          contested: 1,
          totalVotes: 10,
          bestWin: race,
          closest: null,
          firstWin: race,
          rival: null,
          winsByRegion: {},
        },
      })
    );
    expect(k).toContain("race");
    expect(k).not.toContain("votes");
  });
});

describe("guessOptions", () => {
  it("offers the true top action among three, stable per character", () => {
    const r = recap({
      actions: {
        total: 60,
        byType: { splitSector: 40, campaign: 15, fundraise: 5 },
        topType: "splitSector" as never,
        rank: null,
      },
    });
    const opts = guessOptions(r)!;
    expect(opts).toHaveLength(3);
    expect(opts).toContain("splitSector");
    expect(guessOptions(r)).toEqual(opts);
    expect(actionLabel("splitSector")).toBe("Split sector");
  });

  it("skips the guess under 10 actions", () => {
    expect(
      guessOptions(
        recap({ actions: { total: 5, byType: { campaign: 5 }, topType: "campaign", rank: null } })
      )
    ).toBeNull();
  });
});

describe("money", () => {
  it("hugs glyph symbols and spaces letter symbols with word suffixes", () => {
    expect(money({ countryId: "UK", currencySymbol: "£" }, 29_200_000)).toBe("£29.2M");
    expect(money({ countryId: "DD", currencySymbol: "M" }, 133_400_000)).toBe("M 133.4mn");
    expect(money({ countryId: "US" }, -1500)).toBe("-$1.5K");
  });
});
