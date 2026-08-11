/**
 * Test fixture factories for A House Divided.
 *
 * Each factory provides sensible defaults for required fields and accepts
 * partial overrides so tests only specify fields relevant to the scenario.
 *
 * Usage:
 *   import { makeCharacter, makeElection, makeBill } from "@/lib/test-utils/factories";
 *
 *   const char = makeCharacter({ funds: 500_000, party: "DEM" });
 *   const election = makeElection({ electionType: "president", state: "US" });
 */

import { ObjectId } from "mongodb";
import type {
  Character,
  Bill,
  Election,
  ElectionCandidate,
  Corporation,
  NPP,
  PoliticalParty,
  ElectedOfficial,
} from "@/lib/db/types";

const ts = () => new Date("2025-06-15T00:00:00Z");

// ── Character ────────────────────────────────────────────────────────────────

export function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    _id: new ObjectId(),
    userId: new ObjectId(),
    countryId: "US",
    name: "Test Character",
    homeState: "CA",
    politicalInfluence: 50,
    nationalInfluence: 0,
    favorability: 50,
    infamy: 0,
    funds: 100_000,
    actions: 5,
    donorBaseLevel: 0,
    policies: { economic: 0, social: 0 },
    party: "independent",
    currentOffice: null,
    createdAt: ts(),
    updatedAt: ts(),
    ...overrides,
  } as Character;
}

// ── Bill ─────────────────────────────────────────────────────────────────────

export function makeBill(overrides: Partial<Bill> = {}): Bill {
  return {
    _id: new ObjectId(),
    title: "Test Bill",
    summary: "A test bill for unit testing.",
    originChamber: "house",
    currentChamber: "house",
    sponsorId: new ObjectId(),
    sponsorName: "Test Sponsor",
    status: "active",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    coSponsors: [],
    proposedAt: ts(),
    createdAt: ts(),
    updatedAt: ts(),
    ...overrides,
  } as Bill;
}

// ── Election ─────────────────────────────────────────────────────────────────

export function makeElection(overrides: Partial<Election> = {}): Election {
  return {
    _id: new ObjectId(),
    countryId: "US",
    electionType: "senate",
    state: "CA",
    cycle: 2026,
    status: "active",
    createdAt: ts(),
    updatedAt: ts(),
    ...overrides,
  } as Election;
}

// ── ElectionCandidate ────────────────────────────────────────────────────────

export function makeCandidate(overrides: Partial<ElectionCandidate> = {}): ElectionCandidate {
  return {
    _id: new ObjectId(),
    electionId: new ObjectId(),
    characterId: new ObjectId(),
    characterName: "Test Candidate",
    party: "DEM",
    status: "active",
    isNPP: false,
    enteredAt: ts(),
    ...overrides,
  } as ElectionCandidate;
}

// ── NPP ──────────────────────────────────────────────────────────────────────

export function makeNPP(overrides: Partial<NPP> = {}): NPP {
  return {
    _id: new ObjectId(),
    name: "Test NPP",
    homeState: "CA",
    countryId: "US",
    party: "DEM",
    politicalInfluence: 50,
    favorability: 50,
    policies: { economic: 0, social: 0 },
    currentOffice: null,
    personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
    generatedAt: ts(),
    retiredAt: null,
    createdAt: ts(),
    updatedAt: ts(),
    ...overrides,
  } as NPP;
}

// ── Corporation ──────────────────────────────────────────────────────────────

export function makeCorporation(overrides: Partial<Corporation> = {}): Corporation {
  // Default fixture: no `liquidCurrencyCode`. Post-v0.2.6 readers
  // (`resolveCorpLiquidCurrencyCode`, `readCorpEconomicAnchor`,
  // `writeCorpEconomicLocal`) treat an unset code as pre-forex passthrough —
  // values are interpreted as already being in ₳ (rate=1 effectively). Tests
  // that exercise a specific currency pass `{ countryId, liquidCurrencyCode }`
  // through overrides.
  return {
    _id: new ObjectId(),
    name: "Test Corp",
    type: "manufacturing",
    ceoId: new ObjectId(),
    userId: new ObjectId(),
    headquartersState: "CA",
    liquidCapital: 1_000_000,
    marketingBudget: 100,
    marketingStrength: 50,
    logisticsBudget: 50,
    logisticsStrength: 50,
    totalShares: 1_000_000,
    sharePrice: 10,
    shareholders: [],
    createdAt: ts(),
    updatedAt: ts(),
    ...overrides,
  } as Corporation;
}

// ── PoliticalParty ───────────────────────────────────────────────────────────

export function makeParty(overrides: Partial<PoliticalParty> = {}): PoliticalParty {
  return {
    _id: new ObjectId(),
    sequentialId: 1,
    countryId: "US",
    name: "Test Party",
    abbreviation: "TP",
    color: "#FF0000",
    economicPosition: 0,
    socialPosition: 0,
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
    createdAt: ts(),
    updatedAt: ts(),
    ...overrides,
  } as PoliticalParty;
}

// ── ElectedOfficial ──────────────────────────────────────────────────────────

export function makeOfficial(overrides: Partial<ElectedOfficial> = {}): ElectedOfficial {
  return {
    _id: new ObjectId(),
    officeType: "house",
    characterId: new ObjectId(),
    characterName: "Test Official",
    party: "DEM",
    countryId: "US",
    state: "CA",
    isNPP: false,
    seatsHeld: 1,
    createdAt: ts(),
    updatedAt: ts(),
    ...overrides,
  } as ElectedOfficial;
}

// ── Cursor helper ────────────────────────────────────────────────────────────

/** Create a chainable mock cursor for find() results. */
export function makeCursor(docs: unknown[]) {
  return {
    toArray: () => Promise.resolve(docs),
    sort: function () {
      return this;
    },
    limit: function () {
      return this;
    },
    skip: function () {
      return this;
    },
    project: function () {
      return this;
    },
  };
}
