/**
 * Poll calculation tests — in-race spoiler (region-aware majors), RCV, archetype approvals.
 */
import { describe, it, expect } from "vitest";
import { computePollData } from "./pollCalculations";
import type { Character, State, StateDemographics, DemographicCategory } from "@/lib/db/types";

function makeMinimalDemographics(): {
  demographics: StateDemographics;
  categories: DemographicCategory[];
} {
  const demographics: StateDemographics = {
    _id: "TX",
    stateId: "TX",
    categoryWeights: { ideology: 100 },
    groups: {
      moderate: { population: 100, economicLean: 0, socialLean: 0, turnout: 100 },
    },
  } as unknown as StateDemographics;

  const categories: DemographicCategory[] = [
    {
      _id: "ideology",
      name: "Ideology",
      groups: [
        {
          id: "moderate",
          name: "Moderate",
          defaultEconomicLean: 0,
          defaultSocialLean: 0,
          defaultTurnout: 100,
        },
      ],
    } as unknown as DemographicCategory,
  ];

  return { demographics, categories };
}

function baseCharacter(party: string): Character {
  return {
    policies: { economic: 0, social: 0 },
    favorability: 80,
    politicalInfluence: 80,
    party,
  } as Character;
}

describe("computePollData — in-race / spoiler", () => {
  const { demographics, categories } = makeMinimalDemographics();

  const stateUS = {
    _id: "TX",
    countryId: "US" as const,
    name: "Texas",
    population: 1_000_000,
    gdp: 1,
    houseDistricts: 38,
    stateSenateSeats: 31,
    region: "Southwest",
    votingSystem: "fptp" as const,
  } satisfies State;

  it("applies FPTP spoiler so Democrat loses votes vs RCV when a nearby third party is present", async () => {
    const me = baseCharacter("democrat");
    const opponents = [
      {
        candidateId: "rep",
        economicPosition: 5,
        socialPosition: 5,
        favorability: 80,
        politicalInfluence: 80,
        party: "republican",
      },
      {
        candidateId: "green",
        economicPosition: -4,
        socialPosition: 4,
        favorability: 80,
        politicalInfluence: 80,
        party: "green",
      },
    ];

    const fptp = await computePollData(
      me,
      stateUS,
      demographics,
      categories,
      [],
      opponents,
      null,
      "fptp"
    );
    const rcv = await computePollData(
      me,
      stateUS,
      demographics,
      categories,
      [],
      opponents,
      null,
      "rcv"
    );

    expect(fptp.inRaceVoteShare).toBeDefined();
    expect(rcv.inRaceVoteShare).toBeDefined();
    expect(fptp.inRaceVoteShare!.myVotes).toBeLessThan(rcv.inRaceVoteShare!.myVotes);
  });

  it("uses UK major-party set: spoiler runs with Labour/Conservative + a third party", async () => {
    const stateUK = {
      _id: "ENG",
      countryId: "UK" as const,
      name: "England",
      population: 50_000_000,
      gdp: 1,
      houseDistricts: 543,
      stateSenateSeats: 0,
      region: "England",
      votingSystem: "fptp" as const,
    } satisfies State;

    const me = baseCharacter("uk_labour");
    const opponents = [
      {
        candidateId: "c1",
        economicPosition: 3,
        socialPosition: 2,
        favorability: 75,
        politicalInfluence: 70,
        party: "uk_conservative",
      },
      {
        candidateId: "c2",
        economicPosition: -3,
        socialPosition: 3,
        favorability: 70,
        politicalInfluence: 65,
        party: "uk_green",
      },
    ];

    const fptp = await computePollData(
      me,
      stateUK,
      demographics,
      categories,
      [],
      opponents,
      null,
      "fptp"
    );
    const rcv = await computePollData(
      me,
      stateUK,
      demographics,
      categories,
      [],
      opponents,
      null,
      "rcv"
    );

    expect(fptp.inRaceVoteShare!.myVotes).toBeLessThan(rcv.inRaceVoteShare!.myVotes);
  });

  it("changes in-race weights when an opponent has archetype approvals on the polled group", async () => {
    const me = baseCharacter("democrat");
    const opponentBase = {
      candidateId: "opp",
      economicPosition: 0,
      socialPosition: 0,
      favorability: 50,
      politicalInfluence: 50,
      party: "republican",
    };

    const withoutArchetype = await computePollData(
      me,
      stateUS,
      demographics,
      categories,
      [],
      [opponentBase],
      null,
      "fptp"
    );
    const withArchetype = await computePollData(
      me,
      stateUS,
      demographics,
      categories,
      [],
      [{ ...opponentBase, archetypeApprovals: { moderate: 40 } }],
      null,
      "fptp"
    );

    expect(withoutArchetype.inRaceVoteShare!.myVotes).not.toBe(
      withArchetype.inRaceVoteShare!.myVotes
    );
  });

  it("caps state poll influence at 100 for the player and opponents", async () => {
    const meAtCap = { ...baseCharacter("democrat"), politicalInfluence: 100 };
    const meAboveCap = { ...baseCharacter("democrat"), politicalInfluence: 180 };
    const opponentAtCap = [
      {
        candidateId: "rep",
        economicPosition: 5,
        socialPosition: 5,
        favorability: 80,
        politicalInfluence: 100,
        party: "republican",
      },
    ];
    const opponentAboveCap = [
      {
        ...opponentAtCap[0],
        politicalInfluence: 180,
      },
    ];

    const capped = await computePollData(
      meAtCap,
      stateUS,
      demographics,
      categories,
      [],
      opponentAtCap,
      null,
      "fptp"
    );
    const overflowed = await computePollData(
      meAboveCap,
      stateUS,
      demographics,
      categories,
      [],
      opponentAboveCap,
      null,
      "fptp"
    );

    expect(overflowed.totalPotentialVoters).toBe(capped.totalPotentialVoters);
    expect(overflowed.inRaceVoteShare).toEqual(capped.inRaceVoteShare);
  });

  it("applies infamy penalty in the in-race vote simulation", async () => {
    const meClean = { ...baseCharacter("democrat"), infamy: 0 } as Character;
    const meInfamous = { ...baseCharacter("democrat"), infamy: 100 } as Character;
    const opponent = [
      {
        candidateId: "rep",
        economicPosition: 0,
        socialPosition: 0,
        favorability: 80,
        politicalInfluence: 80,
        party: "republican",
        infamy: 0,
      },
    ];

    const cleanRun = await computePollData(
      meClean,
      stateUS,
      demographics,
      categories,
      [],
      opponent,
      null,
      "rcv" // skip FPTP spoiler so we measure the infamy effect cleanly
    );
    const infamousRun = await computePollData(
      meInfamous,
      stateUS,
      demographics,
      categories,
      [],
      opponent,
      null,
      "rcv"
    );

    // Infamy=100 should reduce my vote share by ~5% relative to clean
    expect(infamousRun.inRaceVoteShare!.myVotes).toBeLessThan(cleanRun.inRaceVoteShare!.myVotes);
    const ratio = infamousRun.inRaceVoteShare!.myVotes / cleanRun.inRaceVoteShare!.myVotes;
    expect(ratio).toBeGreaterThan(0.93);
    expect(ratio).toBeLessThan(0.99);
  });

  it("opponent infamy reduces opponent vote share in poll simulation", async () => {
    const me = baseCharacter("democrat");
    const cleanOpp = [
      {
        candidateId: "rep",
        economicPosition: 0,
        socialPosition: 0,
        favorability: 80,
        politicalInfluence: 80,
        party: "republican",
        infamy: 0,
      },
    ];
    const infamousOpp = [
      {
        ...cleanOpp[0],
        infamy: 100,
      },
    ];

    const cleanRun = await computePollData(
      me,
      stateUS,
      demographics,
      categories,
      [],
      cleanOpp,
      null,
      "rcv"
    );
    const infamousRun = await computePollData(
      me,
      stateUS,
      demographics,
      categories,
      [],
      infamousOpp,
      null,
      "rcv"
    );

    // Infamous opponent → I should get more votes
    expect(infamousRun.inRaceVoteShare!.myVotes).toBeGreaterThan(cleanRun.inRaceVoteShare!.myVotes);
  });

  it("weights in-race Org by the diminishing-returns curve, not the legacy 1.0–1.6× scalar", async () => {
    // Two otherwise-identical major-party candidates; only party Org differs.
    // orgVoteWeight uses sqrt(share): 30 vs 10 ⇒ sqrt(3):1 ≈ 63% (vs the linear
    // share's 75% and the retired scalar's ≈ 53%).
    const me = baseCharacter("democrat");
    const opponents = [
      {
        candidateId: "rep",
        economicPosition: 0,
        socialPosition: 0,
        favorability: 80,
        politicalInfluence: 80,
        party: "republican",
      },
    ];
    const statePartyOrgs = [
      { partyId: "democrat", organization: 30 },
      { partyId: "republican", organization: 10 },
    ] as unknown as Parameters<typeof computePollData>[4];

    const poll = await computePollData(
      me,
      stateUS,
      demographics,
      categories,
      statePartyOrgs,
      opponents,
      null,
      "fptp"
    );
    const my = poll.inRaceVoteShare!.myVotes;
    const opp = Object.values(poll.inRaceVoteShare!.opponentVotes).reduce((s, v) => s + v, 0);
    const myShare = my / (my + opp);
    // Org weight uses ORG_WEIGHT_EXPONENT = 0.2 (flattened from 0.5 in 5569d2d58):
    // ≈ 0.55 — still above the legacy scalar's ≈ 0.53, below the linear share's 0.75.
    expect(myShare).toBeGreaterThan(0.54);
    expect(myShare).toBeLessThan(0.58);
  });

  it("standalone 'potential voters' count is Org-neutral (magnitude doesn't swing with party Org)", async () => {
    // The head-to-head predicted SHARE reflects normalized Org, but the
    // single-candidate "potential voters" reach estimate must not crater with
    // Org — it stays neutral so the displayed count is stable.
    const me = baseCharacter("democrat");
    const lowOrg = [
      { partyId: "democrat", organization: 10 },
      { partyId: "republican", organization: 20 },
    ] as unknown as Parameters<typeof computePollData>[4];
    const highOrg = [
      { partyId: "democrat", organization: 80 },
      { partyId: "republican", organization: 20 },
    ] as unknown as Parameters<typeof computePollData>[4];

    const low = await computePollData(
      me,
      stateUS,
      demographics,
      categories,
      lowOrg,
      undefined,
      null,
      "fptp"
    );
    const high = await computePollData(
      me,
      stateUS,
      demographics,
      categories,
      highOrg,
      undefined,
      null,
      "fptp"
    );

    expect(low.totalPotentialVoters).toBeGreaterThan(0);
    expect(low.totalPotentialVoters).toBe(high.totalPotentialVoters);
  });

  it("falls back to neutral Org (no zeroing) when no Org data exists in the state", async () => {
    // Empty statePartyOrgs ⇒ total share 0; engine + polls treat Org as neutral 1×
    // rather than zeroing every candidate's weight.
    const me = baseCharacter("democrat");
    const opponents = [
      {
        candidateId: "rep",
        economicPosition: 0,
        socialPosition: 0,
        favorability: 80,
        politicalInfluence: 80,
        party: "republican",
      },
    ];
    const poll = await computePollData(
      me,
      stateUS,
      demographics,
      categories,
      [],
      opponents,
      null,
      "fptp"
    );
    const my = poll.inRaceVoteShare!.myVotes;
    const opp = Object.values(poll.inRaceVoteShare!.opponentVotes).reduce((s, v) => s + v, 0);
    expect(my + opp).toBeGreaterThan(0);
  });
});
