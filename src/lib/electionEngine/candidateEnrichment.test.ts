/**
 * Unit tests for fetchEnrichedCandidates.
 *
 * Covers:
 *  - Player character enrichment (charEP, charSP, favorability, politicalInfluence,
 *    nationalInfluence, archetypeApprovals)
 *  - NPP enrichment (same fields, plus politicalInfluence-as-national-proxy)
 *  - Missing character/NPP fallback to safe defaults
 *  - Party position enrichment (includePartyPositions flag)
 *  - Empty candidate list — no DB queries made
 *  - Mixed player + NPP candidates in one call
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { ElectionCandidate } from "@/lib/db/types";
import { DEFAULT_OPS_VOTE_MULTIPLIERS } from "@/lib/constants/countries";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlayerCandidate(overrides: Partial<ElectionCandidate> = {}): ElectionCandidate {
  return {
    _id: new ObjectId(),
    electionId: new ObjectId(),
    characterId: new ObjectId(),
    characterName: "Alice Player",
    party: "dem",
    status: "active",
    isNPP: false,
    enteredAt: new Date(),
    ...overrides,
  } as ElectionCandidate;
}

function makeNPPCandidate(overrides: Partial<ElectionCandidate> = {}): ElectionCandidate {
  return {
    _id: new ObjectId(),
    electionId: new ObjectId(),
    characterId: new ObjectId(),
    characterName: "Bob NPP",
    party: "rep",
    status: "active",
    isNPP: true,
    nppId: new ObjectId(),
    enteredAt: new Date(),
    ...overrides,
  } as ElectionCandidate;
}

function setupCharacters(db: MockDb, characters: object[]) {
  db.collection("characters");
  db.collectionMocks["characters"]!.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(characters),
  });
}

function setupNPPs(db: MockDb, npps: object[]) {
  db.collection("npps");
  db.collectionMocks["npps"]!.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(npps),
  });
}

function setupParties(db: MockDb, parties: object[]) {
  db.collection("politicalParties");
  db.collectionMocks["politicalParties"]!.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(parties),
  });
}

function setupEndorsements(db: MockDb, endorsements: object[]) {
  db.collection("nppEndorsements");
  db.collectionMocks["nppEndorsements"]!.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(endorsements),
  });
}

/**
 * Phase 1b: candidateEnrichment now reads runtime countryState for the
 * election country's governmentType + opsVoteMultipliers. Tests that
 * exercise the regime-multiplier path need to stub the lookup.
 */
function setupCountryState(
  db: MockDb,
  countryId: string,
  governmentType:
    "presidential" | "parliamentaryMonarchy" | "parliamentaryRepublic" | "onePartyState"
) {
  db.collection("countryState");
  db.collectionMocks["countryState"]!.findOne.mockResolvedValue({
    _id: countryId,
    countryId,
    governmentType,
    rulingPartyId: governmentType === "onePartyState" ? 1 : null,
    opsVoteMultipliers: null,
    hasLeaderConfidenceModel: governmentType === "onePartyState",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

// ── Empty candidates ──────────────────────────────────────────────────────────

describe("fetchEnrichedCandidates — empty list", () => {
  it("returns empty array without touching the DB when candidates is empty", async () => {
    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");

    const result = await fetchEnrichedCandidates([]);

    expect(result).toEqual([]);
    // No DB reads should have been issued
    expect(db.collection).not.toHaveBeenCalled();
  });
});

// ── Player character enrichment ───────────────────────────────────────────────

describe("fetchEnrichedCandidates — player character", () => {
  it("maps character fields onto enriched candidate", async () => {
    const candidateId = new ObjectId();
    const charId = new ObjectId();

    const candidate = makePlayerCandidate({ _id: candidateId, characterId: charId, party: "dem" });
    const character = {
      _id: charId,
      policies: { economic: 3, social: -2 },
      favorability: 165,
      politicalInfluence: 120,
      nationalInfluence: 80,
      archetypeApprovals: { liberal: 10, conservative: -5 },
    };

    setupCharacters(db, [character]);
    setupNPPs(db, []);
    setupEndorsements(db, []);

    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const [enriched] = await fetchEnrichedCandidates([candidate]);

    expect(enriched.candidateId).toBe(candidateId.toString());
    expect(enriched.characterId).toBe(charId.toString());
    expect(enriched.characterName).toBe("Alice Player");
    expect(enriched.party).toBe("dem");
    expect(enriched.isNPP).toBe(false);
    expect(enriched.charEP).toBe(3);
    expect(enriched.charSP).toBe(-2);
    expect(enriched.favorability).toBe(100);
    expect(enriched.politicalInfluence).toBe(100);
    expect(enriched.nationalInfluence).toBe(80);
    expect(enriched.archetypeApprovals).toEqual({ liberal: 10, conservative: -5 });
  });

  it("defaults nationalInfluence to 0 when character lacks the field", async () => {
    const charId = new ObjectId();
    const candidate = makePlayerCandidate({ characterId: charId });
    const character = {
      _id: charId,
      policies: { economic: 0, social: 0 },
      favorability: 50,
      politicalInfluence: 50,
      // nationalInfluence intentionally omitted
    };

    setupCharacters(db, [character]);
    setupNPPs(db, []);
    setupEndorsements(db, []);

    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const [enriched] = await fetchEnrichedCandidates([candidate]);

    expect(enriched.nationalInfluence).toBe(0);
  });

  it("uses safe defaults when character record is not found in DB", async () => {
    const candidate = makePlayerCandidate({ characterId: new ObjectId() });
    // Return empty array — character not found
    setupCharacters(db, []);
    setupNPPs(db, []);
    setupEndorsements(db, []);

    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const [enriched] = await fetchEnrichedCandidates([candidate]);

    expect(enriched.charEP).toBe(0);
    expect(enriched.charSP).toBe(0);
    expect(enriched.favorability).toBe(50);
    expect(enriched.politicalInfluence).toBe(10);
    expect(enriched.nationalInfluence).toBe(0);
    expect(enriched.archetypeApprovals).toBeUndefined();
  });

  it("adds a small direct favorability bump from active NPP endorsements", async () => {
    const electionId = new ObjectId();
    const charId = new ObjectId();
    const candidate = makePlayerCandidate({ electionId, characterId: charId });
    const character = {
      _id: charId,
      policies: { economic: 0, social: 0 },
      favorability: 50,
      politicalInfluence: 40,
      nationalInfluence: 25,
    };

    setupCharacters(db, [character]);
    setupNPPs(db, []);
    setupEndorsements(db, [
      {
        _id: new ObjectId(),
        nppId: new ObjectId(),
        electionId,
        candidateId: charId,
        isActive: true,
      },
      {
        _id: new ObjectId(),
        nppId: new ObjectId(),
        electionId,
        candidateId: charId,
        isActive: true,
      },
    ]);

    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const [enriched] = await fetchEnrichedCandidates([candidate]);

    expect(enriched.favorability).toBe(53);
    expect(db.collectionMocks["nppEndorsements"]!.find).toHaveBeenCalledWith({
      $and: [
        {
          electionId: { $in: [electionId] },
          candidateId: { $in: [charId] },
        },
        { isActive: true },
        {
          $or: [{ source: { $exists: false } }, { source: "arranged" }],
        },
      ],
    });
  });
});

// ── NPP enrichment ────────────────────────────────────────────────────────────

describe("fetchEnrichedCandidates — NPP candidate", () => {
  it("maps NPP fields onto enriched candidate", async () => {
    const candidateId = new ObjectId();
    const nppId = new ObjectId();
    const candidate = makeNPPCandidate({ _id: candidateId, nppId, party: "rep" });
    const npp = {
      _id: nppId,
      policies: { economic: -4, social: 5 },
      favorability: 142,
      politicalInfluence: 190,
      archetypeApprovals: { rural: 20 },
    };

    setupCharacters(db, []);
    setupNPPs(db, [npp]);
    setupEndorsements(db, []);

    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const [enriched] = await fetchEnrichedCandidates([candidate]);

    expect(enriched.isNPP).toBe(true);
    expect(enriched.charEP).toBe(-4);
    expect(enriched.charSP).toBe(5);
    expect(enriched.favorability).toBe(100);
    expect(enriched.politicalInfluence).toBe(100);
    // NPPs use politicalInfluence as a proxy for nationalInfluence
    expect(enriched.nationalInfluence).toBe(100);
    expect(enriched.archetypeApprovals).toEqual({ rural: 20 });
  });

  it("uses safe defaults when NPP record is not found in DB", async () => {
    const candidate = makeNPPCandidate({ nppId: new ObjectId() });
    setupCharacters(db, []);
    setupNPPs(db, []); // NPP not found
    setupEndorsements(db, []);

    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const [enriched] = await fetchEnrichedCandidates([candidate]);

    expect(enriched.charEP).toBe(0);
    expect(enriched.charSP).toBe(0);
    expect(enriched.favorability).toBe(50);
    expect(enriched.politicalInfluence).toBe(10);
    expect(enriched.nationalInfluence).toBe(0);
  });

  it("treats isNPP candidate without nppId like a missing NPP (uses defaults)", async () => {
    // isNPP=true but nppId is absent — edge case from legacy data
    const candidate = makeNPPCandidate({ nppId: undefined });
    setupCharacters(db, []);
    setupNPPs(db, []);
    setupEndorsements(db, []);

    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const [enriched] = await fetchEnrichedCandidates([candidate]);

    expect(enriched.isNPP).toBe(true);
    expect(enriched.favorability).toBe(50);
    expect(enriched.politicalInfluence).toBe(10);
  });
});

// ── Party position enrichment ─────────────────────────────────────────────────

describe("fetchEnrichedCandidates — party positions", () => {
  it("does NOT include party positions by default", async () => {
    const charId = new ObjectId();
    const candidate = makePlayerCandidate({ characterId: charId, party: "dem" });
    const character = {
      _id: charId,
      policies: { economic: 1, social: 1 },
      favorability: 50,
      politicalInfluence: 50,
    };

    setupCharacters(db, [character]);
    setupNPPs(db, []);
    // Parties are always loaded for chair detection, but positions stay off
    // unless includePartyPositions is set.
    setupParties(db, []);

    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const [enriched] = await fetchEnrichedCandidates([candidate]);

    expect(enriched.partyEcon).toBeUndefined();
    expect(enriched.partySocial).toBeUndefined();
    expect(enriched.partyChairRole).toBe(null);
  });

  it("includes partyEcon and partySocial when includePartyPositions is true", async () => {
    const charId = new ObjectId();
    // party: "1" matches String(sequentialId) — production convention
    const candidate = makePlayerCandidate({ characterId: charId, party: "1" });
    const character = {
      _id: charId,
      policies: { economic: 1, social: 1 },
      favorability: 50,
      politicalInfluence: 50,
    };
    const party = {
      _id: new ObjectId(),
      sequentialId: 1,
      economicPosition: -3,
      socialPosition: -1,
    };

    setupCharacters(db, [character]);
    setupNPPs(db, []);
    setupParties(db, [party]);

    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const [enriched] = await fetchEnrichedCandidates([candidate], { includePartyPositions: true });

    expect(enriched.partyEcon).toBe(-3);
    expect(enriched.partySocial).toBe(-1);
  });

  it("leaves partyEcon/partySocial absent when party is not in the DB results", async () => {
    const charId = new ObjectId();
    const candidate = makePlayerCandidate({ characterId: charId, party: "independent" });
    const character = {
      _id: charId,
      policies: { economic: 0, social: 0 },
      favorability: 50,
      politicalInfluence: 50,
    };
    // Party collection returns a different party — "independent" has no record
    const party = { _id: "dem", economicPosition: -2, socialPosition: 0 };

    setupCharacters(db, [character]);
    setupNPPs(db, []);
    setupParties(db, [party]);

    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const [enriched] = await fetchEnrichedCandidates([candidate], { includePartyPositions: true });

    expect(enriched.partyEcon).toBeUndefined();
    expect(enriched.partySocial).toBeUndefined();
  });
});

// ── Mixed player + NPP ────────────────────────────────────────────────────────

describe("fetchEnrichedCandidates — mixed player and NPP", () => {
  it("enriches both player and NPP candidates in a single call, preserving order", async () => {
    const charId = new ObjectId();
    const nppId = new ObjectId();

    const playerCandidate = makePlayerCandidate({ characterId: charId, party: "dem" });
    const nppCandidate = makeNPPCandidate({ nppId, party: "rep" });

    const character = {
      _id: charId,
      policies: { economic: 2, social: -1 },
      favorability: 55,
      politicalInfluence: 100,
      nationalInfluence: 70,
    };
    const npp = {
      _id: nppId,
      policies: { economic: -5, social: 4 },
      favorability: 38,
      politicalInfluence: 60,
    };

    setupCharacters(db, [character]);
    setupNPPs(db, [npp]);

    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const results = await fetchEnrichedCandidates([playerCandidate, nppCandidate]);

    expect(results).toHaveLength(2);

    // First result must correspond to the first candidate (player)
    const [playerResult, nppResult] = results;
    expect(playerResult.candidateId).toBe(playerCandidate._id.toString());
    expect(playerResult.isNPP).toBe(false);
    expect(playerResult.charEP).toBe(2);
    expect(playerResult.nationalInfluence).toBe(70);

    // Second result must correspond to the NPP
    expect(nppResult.candidateId).toBe(nppCandidate._id.toString());
    expect(nppResult.isNPP).toBe(true);
    expect(nppResult.charEP).toBe(-5);
    // NPP national influence proxied from politicalInfluence
    expect(nppResult.nationalInfluence).toBe(60);
  });

  it("makes exactly one characters query and one npps query for a mixed list", async () => {
    const charId1 = new ObjectId();
    const charId2 = new ObjectId();
    const nppId1 = new ObjectId();

    const players = [
      makePlayerCandidate({ characterId: charId1 }),
      makePlayerCandidate({ characterId: charId2 }),
    ];
    const npps = [makeNPPCandidate({ nppId: nppId1 })];

    setupCharacters(db, [
      {
        _id: charId1,
        policies: { economic: 0, social: 0 },
        favorability: 50,
        politicalInfluence: 50,
      },
      {
        _id: charId2,
        policies: { economic: 1, social: 1 },
        favorability: 55,
        politicalInfluence: 60,
      },
    ]);
    setupNPPs(db, [
      {
        _id: nppId1,
        policies: { economic: -1, social: 2 },
        favorability: 45,
        politicalInfluence: 40,
      },
    ]);

    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const results = await fetchEnrichedCandidates([...players, ...npps]);

    expect(results).toHaveLength(3);
    // Each collection should be queried exactly once (parallel Promise.all)
    expect(db.collectionMocks["characters"]!.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks["npps"]!.find).toHaveBeenCalledTimes(1);
  });
});

// ── Players-only / NPPs-only — no unnecessary DB call ────────────────────────

describe("fetchEnrichedCandidates — single-type lists", () => {
  it("does not query npps collection when all candidates are players", async () => {
    const charId = new ObjectId();
    const candidate = makePlayerCandidate({ characterId: charId });
    const character = {
      _id: charId,
      policies: { economic: 0, social: 0 },
      favorability: 50,
      politicalInfluence: 50,
    };

    setupCharacters(db, [character]);

    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    await fetchEnrichedCandidates([candidate]);

    // npps collection must not have been queried at all
    expect(db.collectionMocks["npps"]).toBeUndefined();
  });

  it("does not query characters collection when all candidates are NPPs", async () => {
    const nppId = new ObjectId();
    const candidate = makeNPPCandidate({ nppId });
    const npp = {
      _id: nppId,
      policies: { economic: 0, social: 0 },
      favorability: 50,
      politicalInfluence: 50,
    };

    setupNPPs(db, [npp]);

    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    await fetchEnrichedCandidates([candidate]);

    // characters collection must not have been queried at all
    expect(db.collectionMocks["characters"]).toBeUndefined();
  });
});

describe("fetchEnrichedCandidates — regime multiplier", () => {
  it("attaches regimeMult=DEFAULT.ruling for a CN ruling-party candidate", async () => {
    const candidate = makePlayerCandidate({ party: "1" });
    setupCharacters(db, [
      {
        _id: candidate.characterId,
        policies: { economic: 0, social: 0 },
        favorability: 50,
        politicalInfluence: 10,
        nationalInfluence: 0,
      },
    ]);
    setupParties(db, [{ sequentialId: 1, countryId: "CN", regimeStatus: "ruling" }]);
    setupEndorsements(db, []);
    setupCountryState(db, "CN", "onePartyState");

    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const [enriched] = await fetchEnrichedCandidates([candidate], { countryId: "CN" });
    expect(enriched.regimeMult).toBe(DEFAULT_OPS_VOTE_MULTIPLIERS.ruling);
    expect(enriched.regimeStatus).toBe("ruling");
  });

  it("attaches regimeMult=DEFAULT.approved for a CN approved-party candidate", async () => {
    const candidate = makePlayerCandidate({ party: "2" });
    setupCharacters(db, [
      {
        _id: candidate.characterId,
        policies: { economic: 0, social: 0 },
        favorability: 50,
        politicalInfluence: 10,
        nationalInfluence: 0,
      },
    ]);
    setupParties(db, [{ sequentialId: 2, countryId: "CN", regimeStatus: "approved" }]);
    setupEndorsements(db, []);
    setupCountryState(db, "CN", "onePartyState");

    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const [enriched] = await fetchEnrichedCandidates([candidate], { countryId: "CN" });
    expect(enriched.regimeMult).toBe(DEFAULT_OPS_VOTE_MULTIPLIERS.approved);
    expect(enriched.regimeStatus).toBe("approved");
  });

  it("attaches regimeMult=0 for a CN banned-party candidate", async () => {
    const candidate = makePlayerCandidate({ party: "3" });
    setupCharacters(db, [
      {
        _id: candidate.characterId,
        policies: { economic: 0, social: 0 },
        favorability: 50,
        politicalInfluence: 10,
        nationalInfluence: 0,
      },
    ]);
    setupParties(db, [{ sequentialId: 3, countryId: "CN", regimeStatus: "banned" }]);
    setupEndorsements(db, []);
    setupCountryState(db, "CN", "onePartyState");

    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const [enriched] = await fetchEnrichedCandidates([candidate], { countryId: "CN" });
    expect(enriched.regimeMult).toBe(0);
    expect(enriched.regimeStatus).toBe("banned");
  });

  it("attaches regimeMult=0 for a CN independent candidate (no party doc)", async () => {
    const candidate = makePlayerCandidate({ party: "independent" });
    setupCharacters(db, [
      {
        _id: candidate.characterId,
        policies: { economic: 0, social: 0 },
        favorability: 50,
        politicalInfluence: 10,
        nationalInfluence: 0,
      },
    ]);
    setupParties(db, []); // no party doc for "independent"
    setupEndorsements(db, []);
    setupCountryState(db, "CN", "onePartyState");

    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const [enriched] = await fetchEnrichedCandidates([candidate], { countryId: "CN" });
    expect(enriched.regimeMult).toBe(0);
  });

  it("honest-by-election flag overrides every multiplier with atMultiplier (1.0) and clears the flag", async () => {
    const candidate = makePlayerCandidate({ party: "1" });
    setupCharacters(db, [
      {
        _id: candidate.characterId,
        policies: { economic: 0, social: 0 },
        favorability: 50,
        politicalInfluence: 10,
        nationalInfluence: 0,
      },
    ]);
    setupParties(db, [{ sequentialId: 1, countryId: "CN", regimeStatus: "ruling" }]);
    setupEndorsements(db, []);
    // Stub a countryState row WITH the honest-by-election flag and the
    // findOneAndUpdate the helper will use to clear it.
    db.collection("countryState");
    db.collectionMocks["countryState"]!.findOne.mockResolvedValue({
      _id: "CN",
      countryId: "CN",
      governmentType: "onePartyState",
      rulingPartyId: 1,
      opsVoteMultipliers: { ...DEFAULT_OPS_VOTE_MULTIPLIERS },
      hasLeaderConfidenceModel: true,
      reformCooldowns: {},
      popularBoostModifiers: [],
      pendingHonestByElection: { atMultiplier: 1.0 },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    db.collectionMocks["countryState"]!.findOneAndUpdate.mockResolvedValue({
      _id: "CN",
      countryId: "CN",
      governmentType: "onePartyState",
      rulingPartyId: 1,
      opsVoteMultipliers: { ...DEFAULT_OPS_VOTE_MULTIPLIERS },
      hasLeaderConfidenceModel: true,
      reformCooldowns: {},
      popularBoostModifiers: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const [enriched] = await fetchEnrichedCandidates([candidate], { countryId: "CN" });

    // Ruling candidate normally gets 3.0; with override, gets 1.0.
    expect(enriched.regimeMult).toBe(1.0);

    // The flag was cleared via updateCountryState.
    const writes = db.collectionMocks["countryState"]!.findOneAndUpdate.mock.calls;
    const clearCall = writes.find((c) => {
      const op = c[1] as { $set?: { pendingHonestByElection?: unknown } };
      return (
        op.$set &&
        "pendingHonestByElection" in op.$set &&
        op.$set.pendingHonestByElection === undefined
      );
    });
    expect(clearCall).toBeDefined();
  });

  it("attaches regimeMult=1.0 for a US candidate regardless of party regimeStatus", async () => {
    const candidate = makePlayerCandidate({ party: "1" });
    setupCharacters(db, [
      {
        _id: candidate.characterId,
        policies: { economic: 0, social: 0 },
        favorability: 50,
        politicalInfluence: 10,
        nationalInfluence: 0,
      },
    ]);
    setupParties(db, [{ sequentialId: 1, countryId: "US", regimeStatus: "ruling" }]);
    setupEndorsements(db, []);
    setupCountryState(db, "US", "presidential");

    const { fetchEnrichedCandidates } = await import("./candidateEnrichment");
    const [enriched] = await fetchEnrichedCandidates([candidate], { countryId: "US" });
    expect(enriched.regimeMult).toBe(1.0);
  });
});
