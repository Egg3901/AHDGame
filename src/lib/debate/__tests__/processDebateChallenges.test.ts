import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { STAT_KEYS, NEUTRAL_STAT, type CharacterStats } from "@/lib/stats/statsConstants";

// Deterministic rolls: always pass the challenge gate (kind "challenge" → 1,
// which is <= CHALLENGE_THRESHOLD so the candidate is NOT skipped) and always
// select opponents[0] (kind "opponent" → 0).
vi.mock("@/lib/events/substrate/rng", () => ({
  seededRoll: vi.fn((_id: string, _turn: number, _ns: string, kind: string) =>
    kind === "challenge" ? 1 : 0
  ),
  makeSeededRng: vi.fn(() => () => 0.5),
}));

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

import { processDebateChallenges } from "../processDebateChallenges";

function stats(): CharacterStats {
  return STAT_KEYS.reduce((acc, k) => {
    acc[k] = NEUTRAL_STAT;
    return acc;
  }, {} as CharacterStats);
}

const CURRENT_TURN = 100;

function cursor<T>(docs: T[]) {
  return { toArray: vi.fn().mockResolvedValue(docs), sort: vi.fn().mockReturnThis() };
}

/** A player character doc shaped for the driver's projection. */
function playerChar(id: ObjectId, name: string) {
  return {
    _id: id,
    name,
    stats: stats(),
    careerHistory: [],
    currentOffice: null,
    countryId: "US",
  };
}

interface Cand {
  characterId?: ObjectId;
  characterName: string;
  party: string;
  isNPP?: boolean;
  nppId?: ObjectId;
}

/**
 * Wire the mock DB for one presidential election: the candidacies, the matching
 * player character docs, and the election phase (primary still open vs closed).
 */
function setup(
  db: MockDb,
  electionId: ObjectId,
  cands: Cand[],
  { primaryOpen }: { primaryOpen: boolean }
) {
  const candidacies = cands.map((c) => ({
    _id: new ObjectId(),
    electionId,
    countryId: "US",
    characterId: c.characterId,
    characterName: c.characterName,
    party: c.party,
    status: "active",
    isNPP: c.isNPP ?? false,
    nppId: c.nppId,
    enteredAt: new Date(),
  }));

  const playerDocs = cands
    .filter((c) => !c.isNPP && c.characterId)
    .map((c) => playerChar(c.characterId!, c.characterName));

  const election = {
    _id: electionId,
    electionType: "president",
    // Primary boundary is in the future (open) or in the past (closed/general).
    primaryEndTurn: primaryOpen ? CURRENT_TURN + 50 : CURRENT_TURN - 50,
  };

  db.collectionMocks["debateSessions"] = db.collection("debateSessions");
  db.collectionMocks["debateSessions"].find.mockReturnValue(cursor([])); // no active / expired

  db.collectionMocks["electionCandidates"] = db.collection("electionCandidates");
  db.collectionMocks["electionCandidates"].find.mockReturnValue(cursor(candidacies));

  db.collectionMocks["characters"] = db.collection("characters");
  db.collectionMocks["characters"].find.mockReturnValue(cursor(playerDocs));

  db.collectionMocks["elections"] = db.collection("elections");
  db.collectionMocks["elections"].find.mockReturnValue(cursor([election]));
}

function insertedSessions(db: MockDb) {
  return db.collectionMocks["debateSessions"].insertOne.mock.calls.map((c) => c[0]);
}

describe("processDebateChallenges — party-aware opponent selection", () => {
  let db: MockDb;

  beforeEach(async () => {
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("never pairs a primary-phase player with a rival-party candidate", async () => {
    const electionId = new ObjectId();
    const dem = new ObjectId();
    setup(
      db,
      electionId,
      [
        { characterId: dem, characterName: "Player Dem", party: "Democratic" },
        // Pat Buchanan: a Republican primary contender — not in the Dem's race.
        { characterName: "Pat Buchanan", party: "Republican", isNPP: true, nppId: new ObjectId() },
      ],
      { primaryOpen: true }
    );

    const result = await processDebateChallenges(db as unknown as Db, CURRENT_TURN, new Date());

    expect(result.created).toBe(0);
    expect(insertedSessions(db)).toHaveLength(0);
  });

  it("pairs a primary-phase player with a same-party rival", async () => {
    const electionId = new ObjectId();
    const dem = new ObjectId();
    setup(
      db,
      electionId,
      [
        { characterId: dem, characterName: "Player Dem", party: "Democratic" },
        // Same-party rival is the only valid opponent in the primary.
        { characterName: "Gore", party: "Democratic", isNPP: true, nppId: new ObjectId() },
        { characterName: "Pat Buchanan", party: "Republican", isNPP: true, nppId: new ObjectId() },
      ],
      { primaryOpen: true }
    );

    const result = await processDebateChallenges(db as unknown as Db, CURRENT_TURN, new Date());

    expect(result.created).toBe(1);
    const [session] = insertedSessions(db);
    expect(session.opponent.name).toBe("Gore");
  });

  it("still pairs cross-party nominees in the general phase", async () => {
    const electionId = new ObjectId();
    const dem = new ObjectId();
    setup(
      db,
      electionId,
      [
        { characterId: dem, characterName: "Player Dem", party: "Democratic" },
        { characterName: "GOP Nominee", party: "Republican", isNPP: true, nppId: new ObjectId() },
      ],
      { primaryOpen: false }
    );

    const result = await processDebateChallenges(db as unknown as Db, CURRENT_TURN, new Date());

    expect(result.created).toBe(1);
    const [session] = insertedSessions(db);
    expect(session.opponent.name).toBe("GOP Nominee");
  });

  it("stops spawning once a candidate hits the per-election debate cap", async () => {
    const electionId = new ObjectId();
    const dem = new ObjectId();
    setup(
      db,
      electionId,
      [
        { characterId: dem, characterName: "Player Dem", party: "Democratic" },
        { characterName: "GOP Nominee", party: "Republican", isNPP: true, nppId: new ObjectId() },
      ],
      { primaryOpen: false }
    );

    // DEBATE_MAX_PER_ELECTION (3) prior resolved debates for the player in this
    // race. The count query filters on `electionId`; the active-session query
    // (`{ status: "awaitingStrategies" }`) must still see none, or the player
    // would be skipped as already-debating rather than at-cap.
    const priorForElection = Array.from({ length: 3 }, () => ({
      _id: new ObjectId(),
      electionId,
      status: "resolved",
      challenger: { characterId: dem },
      opponent: { name: "GOP Nominee" },
    }));
    db.collectionMocks["debateSessions"].find.mockImplementation(
      (filter: Record<string, unknown>) =>
        cursor(filter && "electionId" in filter ? priorForElection : [])
    );

    const result = await processDebateChallenges(db as unknown as Db, CURRENT_TURN, new Date());

    expect(result.created).toBe(0);
    expect(insertedSessions(db)).toHaveLength(0);
  });
});
