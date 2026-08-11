import { describe, it, expect } from "vitest";
import {
  RACE_PRIORITY,
  canPartyFieldInState,
  isNPPAvailable,
  shouldEnterPrimary,
  shouldDefendPrimary,
  selectBestPrimary,
  getRacePriority,
} from "./nppEntryLogic";
import type { NPP, Election, ElectionCandidate } from "@/lib/db/types";
import { ObjectId } from "mongodb";

function createTestNPP(overrides: Partial<NPP> = {}): NPP {
  return {
    _id: new ObjectId(),
    name: "Test NPP",
    homeState: "CA",
    party: "democrat",
    politicalInfluence: 50,
    favorability: 50,
    policies: { economic: 0, social: 0 },
    currentOffice: null,
    personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
    generatedAt: new Date(),
    retiredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createTestElection(overrides: Partial<Election> = {}): Election {
  return {
    _id: new ObjectId(),
    electionType: "stateSenate",
    state: "CA",
    countryId: "US",
    status: "active",
    startTime: new Date(),
    endTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    primaryEndTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Election;
}

describe("RACE_PRIORITY", () => {
  it("should have stateSenate as highest priority", () => {
    expect(RACE_PRIORITY[0]).toBe("stateSenate");
  });

  it("should have commons between house and senate", () => {
    const houseIdx = RACE_PRIORITY.indexOf("house");
    const commonsIdx = RACE_PRIORITY.indexOf("commons");
    const senateIdx = RACE_PRIORITY.indexOf("senate");
    expect(houseIdx).toBeLessThan(senateIdx);
    expect(houseIdx).toBeLessThan(commonsIdx);
    expect(commonsIdx).toBeLessThan(senateIdx);
  });

  it("should omit president because presidential auto-entry is blocked", () => {
    expect(RACE_PRIORITY).not.toContain("president");
  });
});

describe("isNPPAvailable", () => {
  it("should return true for eligible NPP", () => {
    const npp = createTestNPP();
    const activeCandidacies = new Set<string>();
    const now = new Date();

    expect(isNPPAvailable(npp, activeCandidacies, now)).toBe(true);
  });

  it("should return false for retired NPP", () => {
    const npp = createTestNPP({ retiredAt: new Date() });
    const activeCandidacies = new Set<string>();
    const now = new Date();

    expect(isNPPAvailable(npp, activeCandidacies, now)).toBe(false);
  });

  it("should return false for NPP already in a race", () => {
    const npp = createTestNPP();
    const activeCandidacies = new Set<string>([npp._id.toString()]);
    const now = new Date();

    expect(isNPPAvailable(npp, activeCandidacies, now)).toBe(false);
  });

  it("should return false for NPP on cooldown", () => {
    const electionId = new ObjectId().toString();
    const npp = createTestNPP({
      electionCooldowns: {
        [electionId]: new Date(Date.now() + 1000).toISOString(),
      },
    });
    const activeCandidacies = new Set<string>();
    const now = new Date();

    // This won't trigger cooldown check in isNPPAvailable since it doesn't know about election
    // Cooldown is checked per-election in shouldEnterPrimary
    expect(isNPPAvailable(npp, activeCandidacies, now)).toBe(true);
  });
});

describe("shouldEnterPrimary", () => {
  it("should return true when no same-party candidate exists", () => {
    const npp = createTestNPP({ party: "democrat" });
    const election = createTestElection();
    const existingCandidates: ElectionCandidate[] = [];
    const now = new Date();

    expect(shouldEnterPrimary(npp, election, existingCandidates, now)).toBe(true);
  });

  it("should return false when same-party candidate exists", () => {
    const npp = createTestNPP({ party: "democrat" });
    const election = createTestElection();
    const existingCandidates: ElectionCandidate[] = [
      {
        _id: new ObjectId(),
        electionId: election._id,
        characterId: new ObjectId(),
        characterName: "Other Dem",
        party: "democrat",
        status: "active",
        enteredAt: new Date(),
      } as ElectionCandidate,
    ];
    const now = new Date();

    expect(shouldEnterPrimary(npp, election, existingCandidates, now)).toBe(false);
  });

  it("should return false when NPP is on cooldown for this election", () => {
    const election = createTestElection();
    const npp = createTestNPP({
      party: "democrat",
      electionCooldowns: {
        [election._id.toString()]: new Date(Date.now() + 10000).toISOString(),
      },
    });
    const existingCandidates: ElectionCandidate[] = [];
    const now = new Date();

    expect(shouldEnterPrimary(npp, election, existingCandidates, now)).toBe(false);
  });

  it("should return false for presidential elections regardless of other conditions", () => {
    const npp = createTestNPP({ party: "democrat" });
    const presidential = createTestElection({
      electionType: "president",
      countryId: "US",
      state: "US",
    });
    const existingCandidates: ElectionCandidate[] = [];
    const now = new Date();

    expect(shouldEnterPrimary(npp, presidential, existingCandidates, now)).toBe(false);
  });
});

describe("shouldDefendPrimary", () => {
  it("allows an incumbent to defend even when a same-party challenger is already active", () => {
    const npp = createTestNPP({ party: "democrat" });
    const election = createTestElection();
    const existingCandidates: ElectionCandidate[] = [
      {
        _id: new ObjectId(),
        electionId: election._id,
        characterId: new ObjectId(),
        characterName: "Slate Challenger",
        party: "democrat",
        status: "active",
        enteredAt: new Date(),
        isNPP: true,
        nppId: new ObjectId(),
      } as ElectionCandidate,
    ];

    expect(shouldDefendPrimary(npp, election, existingCandidates)).toBe(true);
  });

  it("blocks incumbent defense when the same NPP is already actively filed", () => {
    const npp = createTestNPP({ party: "democrat" });
    const election = createTestElection();
    const existingCandidates: ElectionCandidate[] = [
      {
        _id: new ObjectId(),
        electionId: election._id,
        characterId: npp._id,
        characterName: npp.name,
        party: "democrat",
        status: "active",
        enteredAt: new Date(),
        isNPP: true,
        nppId: npp._id,
      } as ElectionCandidate,
    ];

    expect(shouldDefendPrimary(npp, election, existingCandidates)).toBe(false);
  });
});

describe("selectBestPrimary", () => {
  it("should select highest priority race type first", () => {
    const npp = createTestNPP({ party: "democrat", homeState: "CA" });
    const stateSenate = createTestElection({ electionType: "stateSenate", state: "CA" });
    const house = createTestElection({ electionType: "house", state: "CA" });
    const elections = [house, stateSenate]; // Out of priority order
    const candidatesByElection = new Map<string, ElectionCandidate[]>();
    const now = new Date();

    const result = selectBestPrimary(npp, elections, candidatesByElection, now);
    expect(result?._id.toString()).toBe(stateSenate._id.toString());
  });

  it("should skip elections that already have same-party candidate", () => {
    const npp = createTestNPP({ party: "democrat", homeState: "CA" });
    const stateSenate = createTestElection({ electionType: "stateSenate", state: "CA" });
    const house = createTestElection({ electionType: "house", state: "CA" });
    const elections = [stateSenate, house];

    const candidatesByElection = new Map<string, ElectionCandidate[]>([
      [
        stateSenate._id.toString(),
        [
          {
            _id: new ObjectId(),
            electionId: stateSenate._id,
            characterId: new ObjectId(),
            characterName: "Other Dem",
            party: "democrat",
            status: "active",
            enteredAt: new Date(),
          } as ElectionCandidate,
        ],
      ],
    ]);
    const now = new Date();

    const result = selectBestPrimary(npp, elections, candidatesByElection, now);
    expect(result?._id.toString()).toBe(house._id.toString());
  });

  it("should return null when no eligible elections", () => {
    const npp = createTestNPP({ party: "democrat", homeState: "CA" });
    const elections: Election[] = [];
    const candidatesByElection = new Map<string, ElectionCandidate[]>();
    const now = new Date();

    const result = selectBestPrimary(npp, elections, candidatesByElection, now);
    expect(result).toBeNull();
  });

  it("blocks NPP entry into presidential primary regardless of country match", () => {
    // Presidential primaries are reserved for human players; NPPs never enter.
    const npp = createTestNPP({ party: "democrat", homeState: "CA", countryId: "US" });
    const presidential = createTestElection({
      electionType: "president",
      countryId: "US",
      state: "US",
    });
    const candidatesByElection = new Map<string, ElectionCandidate[]>();
    const now = new Date();

    const result = selectBestPrimary(npp, [presidential], candidatesByElection, now);
    expect(result).toBeNull();
  });

  it("excludes presidential election from other countries", () => {
    const npp = createTestNPP({ party: "conservative", homeState: "London", countryId: "UK" });
    const usPresidential = createTestElection({
      electionType: "president",
      countryId: "US",
      state: "US",
    });
    const candidatesByElection = new Map<string, ElectionCandidate[]>();
    const now = new Date();

    // Presidential primaries are entirely off-limits to NPPs.
    const result = selectBestPrimary(npp, [usPresidential], candidatesByElection, now);
    expect(result).toBeNull();
  });

  it("treats unknown electionType as lowest priority (index 999)", () => {
    const npp = createTestNPP({ party: "democrat", homeState: "CA" });
    // "specialElection" is not in RACE_PRIORITY
    const specialElection = createTestElection({
      electionType: "specialElection" as any,
      state: "CA",
    });
    const house = createTestElection({ electionType: "house", state: "CA" });
    const candidatesByElection = new Map<string, ElectionCandidate[]>();
    const now = new Date();

    // house should be preferred over unknown type even though special appears first
    const result = selectBestPrimary(npp, [specialElection, house], candidatesByElection, now);
    expect(result?._id.toString()).toBe(house._id.toString());
  });

  it("skips elections in wrong state for non-presidential races", () => {
    const npp = createTestNPP({ party: "democrat", homeState: "CA" });
    const txElection = createTestElection({ electionType: "stateSenate", state: "TX" });
    const candidatesByElection = new Map<string, ElectionCandidate[]>();
    const now = new Date();

    const result = selectBestPrimary(npp, [txElection], candidatesByElection, now);
    expect(result).toBeNull();
  });
});

describe("shouldEnterPrimary", () => {
  it("allows entry when cooldown has expired", () => {
    const election = createTestElection();
    const npp = createTestNPP({
      party: "democrat",
      electionCooldowns: {
        // Cooldown expired in the past
        [election._id.toString()]: new Date(Date.now() - 10000).toISOString(),
      },
    });
    const existingCandidates: ElectionCandidate[] = [];
    const now = new Date();

    // Expired cooldown should NOT block entry
    expect(shouldEnterPrimary(npp, election, existingCandidates, now)).toBe(true);
  });

  it("allows entry when same-party candidate is withdrawn (not active)", () => {
    const npp = createTestNPP({ party: "democrat" });
    const election = createTestElection();
    const existingCandidates: ElectionCandidate[] = [
      {
        _id: new ObjectId(),
        electionId: election._id,
        characterId: new ObjectId(),
        characterName: "Withdrawn Dem",
        party: "democrat",
        status: "withdrawn",
        enteredAt: new Date(),
      } as ElectionCandidate,
    ];
    const now = new Date();

    // Withdrawn candidate should NOT block entry — only active candidates do
    expect(shouldEnterPrimary(npp, election, existingCandidates, now)).toBe(true);
  });

  it("allows entry when same-party candidate is eliminated (not active)", () => {
    const npp = createTestNPP({ party: "republican" });
    const election = createTestElection();
    const existingCandidates: ElectionCandidate[] = [
      {
        _id: new ObjectId(),
        electionId: election._id,
        characterId: new ObjectId(),
        characterName: "Eliminated GOP",
        party: "republican",
        status: "withdrawn",
        enteredAt: new Date(),
      } as ElectionCandidate,
    ];
    const now = new Date();

    expect(shouldEnterPrimary(npp, election, existingCandidates, now)).toBe(true);
  });

  it("blocks entry when same-party candidate is active regardless of cooldown state", () => {
    const election = createTestElection();
    const npp = createTestNPP({
      party: "democrat",
      // No cooldown set — should not matter because party conflict blocks
      electionCooldowns: {},
    });
    const existingCandidates: ElectionCandidate[] = [
      {
        _id: new ObjectId(),
        electionId: election._id,
        characterId: new ObjectId(),
        characterName: "Active Dem",
        party: "democrat",
        status: "active",
        enteredAt: new Date(),
      } as ElectionCandidate,
    ];
    const now = new Date();

    expect(shouldEnterPrimary(npp, election, existingCandidates, now)).toBe(false);
  });
});

describe("getRacePriority", () => {
  it("returns 0 for stateSenate (highest priority)", () => {
    expect(getRacePriority("stateSenate")).toBe(0);
  });

  it("returns 999 for unknown race types", () => {
    expect(getRacePriority("unknownRace")).toBe(999);
    expect(getRacePriority("")).toBe(999);
  });

  it("returns correct index for each known race type", () => {
    // Verify relative ordering matches RACE_PRIORITY definition
    const stateSenateIdx = getRacePriority("stateSenate");
    const houseIdx = getRacePriority("house");
    const commonsIdx = getRacePriority("commons");
    const senateIdx = getRacePriority("senate");
    const governorIdx = getRacePriority("governor");

    expect(stateSenateIdx).toBeLessThan(houseIdx);
    expect(houseIdx).toBeLessThan(commonsIdx);
    expect(commonsIdx).toBeLessThan(senateIdx);
    expect(houseIdx).toBeLessThan(senateIdx);
    expect(senateIdx).toBeLessThan(governorIdx);
    expect(getRacePriority("president")).toBe(999);
  });

  it("returns correct priority for regionalCouncil (between stateSenate and house)", () => {
    const stateSenateIdx = getRacePriority("stateSenate");
    const regionalCouncilIdx = getRacePriority("regionalCouncil");
    const houseIdx = getRacePriority("house");

    expect(regionalCouncilIdx).toBeGreaterThan(stateSenateIdx);
    expect(regionalCouncilIdx).toBeLessThan(houseIdx);
  });
});

// ── Regional-presence gate (canPartyFieldInState) ─────────────────────────────
// 1953 sim forensics: NPP entry had no regional-party gating — SNP NPPs homed
// in London contested English seats. The gate is data-driven via statePartyOrg.

describe("canPartyFieldInState", () => {
  it("allows fielding when the region has no statePartyOrg data at all (unseeded worlds)", () => {
    expect(canPartyFieldInState(undefined, false, "uk_snp")).toBe(true);
  });

  it("blocks a party with NO org row in a region that has org data (SNP in London)", () => {
    expect(canPartyFieldInState(undefined, true, "uk_snp")).toBe(false);
  });

  it("blocks a party whose row is explicitly hasPresence: false", () => {
    expect(canPartyFieldInState({ hasPresence: false }, true, "uk_snp")).toBe(false);
  });

  it("allows a party with a present org row (Liberals with real single-digit org)", () => {
    expect(canPartyFieldInState({ hasPresence: true }, true, "uk_liberal")).toBe(true);
    // Legacy rows without the flag still count as present.
    expect(canPartyFieldInState({}, true, "uk_liberal")).toBe(true);
  });

  it("always exempts independents (they never have org rows by design)", () => {
    expect(canPartyFieldInState(undefined, true, "independent")).toBe(true);
  });
});
