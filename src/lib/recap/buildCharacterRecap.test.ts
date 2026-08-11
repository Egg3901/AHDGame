import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Character, CareerEvent } from "@/lib/db/types/character";
import { buildCharacterRecap } from "./buildCharacterRecap";
import type { PerCharacterRecapInput, RecapAssemblyContext } from "./buildCharacterRecap";

function makeChar(o: Partial<Character> = {}): Character {
  return {
    _id: new ObjectId(),
    name: "Test Pol",
    countryId: "US",
    politicalInfluence: 40,
    nationalInfluence: 60,
    favorability: 55,
    infamy: 10,
    createdTurn: 100,
    careerHistory: [],
    currentOffice: null,
    ...o,
  } as unknown as Character;
}

function baseInput(o: Partial<PerCharacterRecapInput> = {}): PerCharacterRecapInput {
  return {
    partyName: "Test Party",
    actions: { total: 0, byType: {} },
    bills: { sponsored: 0, passed: 0 },
    social: { subscribers: 0, posts: 0, likes: 0 },
    achievementsCount: 0,
    achievementHighlights: [],
    campaignFunds: 0,
    netWorth: 0,
    ranks: { npi: null, favorability: null, netWorth: null, campaignFunds: null, actions: null },
    ...o,
  };
}

const ctx: RecapAssemblyContext = { currentTurn: 1198, iteration: { type: "Beta", number: 2 } };

describe("buildCharacterRecap", () => {
  it("derives elections (won/lost/entered) from careerHistory", () => {
    const careerHistory = [
      { type: "elected", officeLabel: "Gov", date: new Date(0) },
      { type: "elected", officeLabel: "Sen", date: new Date(0) },
      { type: "lost_election", officeLabel: "Pres", date: new Date(0) },
      { type: "appointed", officeLabel: "Cabinet", date: new Date(0) },
    ] as unknown as CareerEvent[];
    const r = buildCharacterRecap(makeChar({ careerHistory }), baseInput(), ctx);
    expect(r.elections).toEqual({ entered: 3, won: 2, lost: 1 });
  });

  it("picks the signature move and nulls the action rank when zero", () => {
    const active = buildCharacterRecap(
      makeChar(),
      baseInput({
        actions: { total: 130, byType: { fundraise: 100, campaign: 30 } },
        ranks: { ...baseInput().ranks, actions: { rank: 2, total: 50 } },
      }),
      ctx
    );
    expect(active.actions.topType).toBe("fundraise");
    expect(active.actions.rank).toEqual({ value: 130, rank: 2, total: 50 });

    const idle = buildCharacterRecap(makeChar(), baseInput(), ctx);
    expect(idle.actions.topType).toBeNull();
    expect(idle.actions.rank).toBeNull();
  });

  it("nulls money slices at zero and keeps them when positive", () => {
    expect(buildCharacterRecap(makeChar(), baseInput(), ctx).netWorth).toBeNull();
    const rich = buildCharacterRecap(
      makeChar(),
      baseInput({
        netWorth: 4_200_000,
        ranks: { ...baseInput().ranks, netWorth: { rank: 11, total: 333 } },
      }),
      ctx
    );
    expect(rich.netWorth).toEqual({ value: 4_200_000, rank: 11, total: 333 });
  });

  it("collapses social to null only when fully empty", () => {
    expect(buildCharacterRecap(makeChar(), baseInput(), ctx).social).toBeNull();
    const social = buildCharacterRecap(
      makeChar(),
      baseInput({ social: { subscribers: 5, posts: 0, likes: 0 } }),
      ctx
    ).social;
    expect(social).toEqual({ subscribers: 5, posts: 0, likes: 0 });
  });

  it("always reports favorability + influence and computes tenure/iteration", () => {
    const r = buildCharacterRecap(
      makeChar({ createdTurn: 198, favorability: 71 }),
      baseInput({ ranks: { ...baseInput().ranks, favorability: { rank: 3, total: 100 } } }),
      ctx
    );
    expect(r.favorability).toEqual({ value: 71, rank: 3, total: 100 });
    expect(r.influence.nationalInfluence).toBe(60);
    expect(r.tenureTurns).toBe(1000);
    expect(r.iteration).toEqual({ type: "Beta", number: 2 });
  });

  it("takes highest office from the career ladder, not order", () => {
    const careerHistory = [
      {
        type: "elected",
        office: { type: "house", state: "CA", seatsHeld: 1 },
        officeLabel: "US House (CA)",
        date: new Date(0),
      },
      {
        type: "elected",
        office: { type: "governor", state: "CA" },
        officeLabel: "Governor of CA",
        date: new Date(0),
      },
    ] as unknown as CareerEvent[];
    expect(buildCharacterRecap(makeChar({ careerHistory }), baseInput(), ctx).highestOffice).toBe(
      "Governor of CA"
    );
  });

  it("ignores lost elections when picking highest office (ticket #991)", () => {
    // Ran for President and Governor, lost both; only ever held a Senate seat.
    const careerHistory = [
      {
        type: "elected",
        office: { type: "senate", state: "AZ" },
        officeLabel: "US Senate (AZ)",
        date: new Date(0),
      },
      {
        type: "lost_election",
        office: { type: "president" },
        officeLabel: "President of the United States",
        date: new Date(0),
      },
      {
        type: "lost_election",
        office: { type: "governor", state: "AZ" },
        officeLabel: "Governor of Arizona",
        date: new Date(0),
      },
    ] as unknown as CareerEvent[];
    expect(buildCharacterRecap(makeChar({ careerHistory }), baseInput(), ctx).highestOffice).toBe(
      "US Senate (AZ)"
    );
  });
});
