import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";

import type { Character, ElectionCandidate, PoliticalParty, State } from "@/lib/db/types";

import { enrichElectionCandidates } from "./candidateEnrichment";

describe("enrichElectionCandidates", () => {
  it("caps favorability and political influence at 100 for display and primary scoring", () => {
    const electionId = new ObjectId();
    const candidateId = new ObjectId();
    const characterId = new ObjectId();

    const candidate: ElectionCandidate = {
      _id: candidateId,
      electionId,
      characterId,
      characterName: "Kimi Antonelli",
      party: "1",
      status: "active",
      isNPP: false,
      enteredAt: new Date(),
    } as ElectionCandidate;

    const character: Character = {
      _id: characterId,
      userId: new ObjectId(),
      name: "Kimi Antonelli",
      countryId: "US",
      homeState: "CA",
      party: "1",
      policies: { economic: 2, social: -1 },
      favorability: 143,
      politicalInfluence: 181,
      nationalInfluence: 72,
      donorBaseLevel: 0,
      actions: 4,
      funds: 100_000,
      infamy: 0,
      currentOffice: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Character;

    const party: PoliticalParty = {
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Democratic Party",
      abbreviation: "DEM",
      color: "#1d4ed8",
      economicPosition: -2,
      socialPosition: -2,
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
      memberCount: 0,
      isDefault: false,
      createdBy: null,
      treasury: 0,
      nationalTaxRate: 0,
      politicalStrength: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const [enriched] = enrichElectionCandidates({
      candidates: [candidate],
      characters: [character],
      npps: [],
      parties: [party],
      nppEndorsements: [],
      playerEndorsements: [],
      campaigns: [],
      statePartyOrgs: [],
      isPresident: false,
      myCharId: null,
    });

    expect(enriched.favorability).toBe(100);
    expect(enriched.politicalInfluence).toBe(100);
    expect(enriched.nationalInfluence).toBe(72);
  });

  it("preserves the running mate character ObjectId alongside the display-friendly ID", () => {
    const candidateId = new ObjectId();
    const runningMateId = new ObjectId();
    const electionCandidateId = new ObjectId();

    const enriched = enrichElectionCandidates({
      candidates: [
        {
          _id: electionCandidateId,
          electionId: new ObjectId(),
          characterId: candidateId,
          characterName: "Nominee",
          party: "1",
          status: "active",
          enteredAt: new Date("2026-04-01T00:00:00.000Z"),
          runningMateId,
        },
      ],
      characters: [
        {
          _id: candidateId,
          userId: new ObjectId(),
          countryId: "US",
          name: "Nominee",
          homeState: "california",
          politicalInfluence: 42,
          favorability: 55,
          infamy: 0,
          funds: 1000,
          actions: 3,
          donorBaseLevel: 1,
          policies: { economic: 1, social: -1 },
          party: "1",
          currentOffice: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-04-01T00:00:00.000Z"),
          sequentialId: 10,
        },
        {
          _id: runningMateId,
          userId: new ObjectId(),
          countryId: "US",
          name: "Running Mate",
          homeState: "ohio",
          politicalInfluence: 35,
          favorability: 51,
          infamy: 0,
          funds: 500,
          actions: 3,
          donorBaseLevel: 1,
          policies: { economic: 0, social: 0 },
          party: "2",
          currentOffice: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-04-01T00:00:00.000Z"),
          sequentialId: 24,
        },
      ],
      npps: [],
      parties: [
        {
          _id: new ObjectId(),
          sequentialId: 1,
          countryId: "US",
          name: "Democrats",
          abbreviation: "DEM",
          color: "#0000ff",
          economicPosition: 1,
          socialPosition: -1,
          chairId: null,
          viceChairId: null,
          treasurerId: null,
          committeeIds: [],
          memberCount: 1,
          isDefault: true,
          createdBy: null,
          treasury: 0,
          nationalTaxRate: 0,
          politicalStrength: 0,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-04-01T00:00:00.000Z"),
        },
        {
          _id: new ObjectId(),
          sequentialId: 2,
          countryId: "US",
          name: "Republicans",
          abbreviation: "GOP",
          color: "#ff0000",
          economicPosition: 2,
          socialPosition: 2,
          chairId: null,
          viceChairId: null,
          treasurerId: null,
          committeeIds: [],
          memberCount: 1,
          isDefault: true,
          createdBy: null,
          treasury: 0,
          nationalTaxRate: 0,
          politicalStrength: 0,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-04-01T00:00:00.000Z"),
        },
      ],
      nppEndorsements: [],
      playerEndorsements: [],
      campaigns: [],
      statePartyOrgs: [],
      isPresident: true,
      myCharId: candidateId.toString(),
    });

    expect(enriched).toHaveLength(1);
    expect(enriched[0].runningMateCharacterId).toBe(runningMateId.toString());
    expect(enriched[0].runningMateId).toBe("24");
    expect(enriched[0].runningMateName).toBe("Running Mate");
  });

  it("passes state cached lean into calcPrimaryScore for state-level offices", () => {
    const electionId = new ObjectId();
    const hivenId = new ObjectId();
    const noemId = new ObjectId();
    const hivenCharId = new ObjectId();
    const noemCharId = new ObjectId();

    const hivenCand: ElectionCandidate = {
      _id: hivenId,
      electionId,
      characterId: hivenCharId,
      characterName: "Hiven",
      party: "2",
      status: "active",
      isNPP: false,
      enteredAt: new Date(),
    } as ElectionCandidate;
    const noemCand: ElectionCandidate = {
      _id: noemId,
      electionId,
      characterId: noemCharId,
      characterName: "Noem",
      party: "2",
      status: "active",
      isNPP: false,
      enteredAt: new Date(),
    } as ElectionCandidate;

    const hiven: Character = {
      _id: hivenCharId,
      userId: new ObjectId(),
      name: "Hiven",
      countryId: "US",
      homeState: "TX",
      party: "2",
      policies: { economic: 1, social: 1.75 },
      favorability: 97.7,
      politicalInfluence: 84.2,
      nationalInfluence: 215,
      donorBaseLevel: 0,
      actions: 4,
      funds: 0,
      infamy: 12.6,
      currentOffice: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Character;
    const noem: Character = {
      _id: noemCharId,
      userId: new ObjectId(),
      name: "Noem",
      countryId: "US",
      homeState: "TX",
      party: "2",
      policies: { economic: 1, social: 1 },
      favorability: 98,
      politicalInfluence: 92.1,
      nationalInfluence: 416,
      donorBaseLevel: 0,
      actions: 4,
      funds: 0,
      infamy: 0,
      currentOffice: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Character;

    const gop: PoliticalParty = {
      _id: new ObjectId(),
      sequentialId: 2,
      countryId: "US",
      name: "Republican Party",
      abbreviation: "GOP",
      color: "#dc2626",
      economicPosition: 2,
      socialPosition: 2,
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
      memberCount: 0,
      isDefault: false,
      createdBy: null,
      treasury: 0,
      nationalTaxRate: 0,
      politicalStrength: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const tx: State = {
      _id: "TX",
      countryId: "US",
      name: "Texas",
      population: 30_000_000,
      gdp: 2_000_000_000_000,
      houseDistricts: 38,
      stateSenateSeats: 31,
      region: "Southwest",
      cachedEconomicLean: 1,
      cachedSocialLean: 0.5,
    } as State;

    const enriched = enrichElectionCandidates({
      candidates: [hivenCand, noemCand],
      characters: [hiven, noem],
      npps: [],
      parties: [gop],
      nppEndorsements: [],
      playerEndorsements: [],
      campaigns: [],
      statePartyOrgs: [],
      isPresident: false,
      myCharId: null,
      states: new Map([["TX", tx]]),
      electionSeatId: "US-senate-TX-2",
    });

    const hivenE = enriched.find((c) => c.characterName === "Hiven")!;
    const noemE = enriched.find((c) => c.characterName === "Noem")!;
    // With state lean (TX 1, 0.5) Noem (1, 1) is closer to TX than Hiven (1, 1.75),
    // and Noem has higher fav, higher PI, and zero infamy. Noem should win.
    expect(noemE.primaryScore).toBeGreaterThan(hivenE.primaryScore);
  });

  it("falls back to party-only alignment when states map omits the seat region", () => {
    const electionId = new ObjectId();
    const candidateId = new ObjectId();
    const characterId = new ObjectId();
    const candidate: ElectionCandidate = {
      _id: candidateId,
      electionId,
      characterId,
      characterName: "C",
      party: "2",
      status: "active",
      isNPP: false,
      enteredAt: new Date(),
    } as ElectionCandidate;
    const character: Character = {
      _id: characterId,
      userId: new ObjectId(),
      name: "C",
      countryId: "US",
      homeState: "TX",
      party: "2",
      policies: { economic: 1, social: 1.75 },
      favorability: 50,
      politicalInfluence: 50,
      nationalInfluence: 0,
      donorBaseLevel: 0,
      actions: 4,
      funds: 0,
      infamy: 0,
      currentOffice: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Character;
    const gop: PoliticalParty = {
      _id: new ObjectId(),
      sequentialId: 2,
      countryId: "US",
      name: "Republican Party",
      abbreviation: "GOP",
      color: "#dc2626",
      economicPosition: 2,
      socialPosition: 2,
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
      memberCount: 0,
      isDefault: false,
      createdBy: null,
      treasury: 0,
      nationalTaxRate: 0,
      politicalStrength: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const enrichedNoMap = enrichElectionCandidates({
      candidates: [candidate],
      characters: [character],
      npps: [],
      parties: [gop],
      nppEndorsements: [],
      playerEndorsements: [],
      campaigns: [],
      statePartyOrgs: [],
      isPresident: false,
      myCharId: null,
    });
    const enrichedEmptyMap = enrichElectionCandidates({
      candidates: [candidate],
      characters: [character],
      npps: [],
      parties: [gop],
      nppEndorsements: [],
      playerEndorsements: [],
      campaigns: [],
      statePartyOrgs: [],
      isPresident: false,
      myCharId: null,
      states: new Map(),
      electionSeatId: "US-senate-TX-2",
    });
    // No states/seatId vs empty map both fall back to party-only alignment, scores match
    expect(enrichedNoMap[0].primaryScore).toBe(enrichedEmptyMap[0].primaryScore);
  });

  it("populates infamy on the EnrichedCandidate so downstream voteDistribution can apply the penalty", () => {
    const electionId = new ObjectId();
    const candidateId = new ObjectId();
    const characterId = new ObjectId();
    const candidate: ElectionCandidate = {
      _id: candidateId,
      electionId,
      characterId,
      characterName: "C",
      party: "1",
      status: "active",
      isNPP: false,
      enteredAt: new Date(),
    } as ElectionCandidate;
    const character: Character = {
      _id: characterId,
      userId: new ObjectId(),
      name: "C",
      countryId: "US",
      homeState: "TX",
      party: "1",
      policies: { economic: 0, social: 0 },
      favorability: 50,
      politicalInfluence: 50,
      nationalInfluence: 0,
      donorBaseLevel: 0,
      actions: 4,
      funds: 0,
      infamy: 42,
      currentOffice: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Character;
    const dems: PoliticalParty = {
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Democratic Party",
      abbreviation: "DEM",
      color: "#1d4ed8",
      economicPosition: -2,
      socialPosition: -2,
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
      memberCount: 0,
      isDefault: false,
      createdBy: null,
      treasury: 0,
      nationalTaxRate: 0,
      politicalStrength: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const [enriched] = enrichElectionCandidates({
      candidates: [candidate],
      characters: [character],
      npps: [],
      parties: [dems],
      nppEndorsements: [],
      playerEndorsements: [],
      campaigns: [],
      statePartyOrgs: [],
      isPresident: false,
      myCharId: null,
    });
    expect(enriched.infamy).toBe(42);
  });

  it("uses ballot party instead of live character.party when preferBallotParty is set (#939)", () => {
    const electionId = new ObjectId();
    const candidateId = new ObjectId();
    const characterId = new ObjectId();

    const dems: PoliticalParty = {
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Democratic Party",
      abbreviation: "DEM",
      color: "#1d4ed8",
      economicPosition: -2,
      socialPosition: -2,
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
      memberCount: 0,
      isDefault: false,
      createdBy: null,
      treasury: 0,
      nationalTaxRate: 0,
      politicalStrength: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const gop: PoliticalParty = {
      ...dems,
      _id: new ObjectId(),
      sequentialId: 2,
      name: "Republican Party",
      abbreviation: "GOP",
      color: "#dc2626",
      economicPosition: 2,
      socialPosition: 2,
    };

    const candidate: ElectionCandidate = {
      _id: candidateId,
      electionId,
      characterId,
      characterName: "Switcher",
      party: "1", // ran as Democrat
      status: "withdrawn",
      isNPP: false,
      enteredAt: new Date(),
    } as ElectionCandidate;

    const character: Character = {
      _id: characterId,
      userId: new ObjectId(),
      name: "Switcher",
      countryId: "US",
      homeState: "OH",
      party: "2", // now Republican
      policies: { economic: 0, social: 0 },
      favorability: 50,
      politicalInfluence: 40,
      nationalInfluence: 20,
      donorBaseLevel: 0,
      actions: 4,
      funds: 0,
      infamy: 0,
      currentOffice: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Character;

    const [live] = enrichElectionCandidates({
      candidates: [candidate],
      characters: [character],
      npps: [],
      parties: [dems, gop],
      nppEndorsements: [],
      playerEndorsements: [],
      campaigns: [],
      statePartyOrgs: [],
      isPresident: true,
      myCharId: null,
    });
    expect(live.party).toBe("2");
    expect(live.partyName).toBe("Republican Party");

    const [historical] = enrichElectionCandidates({
      candidates: [candidate],
      characters: [character],
      npps: [],
      parties: [dems, gop],
      nppEndorsements: [],
      playerEndorsements: [],
      campaigns: [],
      statePartyOrgs: [],
      isPresident: true,
      myCharId: null,
      preferBallotParty: true,
    });
    expect(historical.party).toBe("1");
    expect(historical.partyName).toBe("Democratic Party");
    expect(historical.partyColor).toBe("#1d4ed8");
  });
});
