/**
 * Route tests for the primary-phase party gate on
 * POST /api/elections/[id]/endorse (ticket #1179).
 *
 * Primaries are intra-party contests: same-party endorsers only. Cross-party
 * endorsements become legal in the general phase. The other route paths
 * (auth, rate limit, self-endorsement, suspension) are not covered here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireHumanSessionWithCharacter: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));
vi.mock("@/lib/elections/electionParamResolution", () => ({
  resolveElectionRouteParam: vi.fn(),
}));
vi.mock("@/lib/turn/elections/supportEvents", () => ({
  applyEndorsementSupportBump: vi.fn().mockResolvedValue(1),
}));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));

import { POST } from "./route";
import { getDb } from "@/lib/mongodb";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { resolveElectionRouteParam } from "@/lib/elections/electionParamResolution";
import { getGameTime } from "@/lib/time/gameTime";

const electionOid = new ObjectId();
const candidateRowOid = new ObjectId();
const endorserOid = new ObjectId();
const endorsedCharOid = new ObjectId();

interface SetupOpts {
  /** Party id of the ENDORSER's character record. */
  endorserParty: string;
  /** Party id printed on the target candidacy row. */
  candidateParty: string | null;
  /** Turn counter handed to getGameTime; primary closes at turn 100. */
  currentTurn?: number;
}

function setupScenario(opts: SetupOpts): MockDb {
  const db = createMockDb();
  db.collection("electionCandidates");
  db.collection("playerEndorsements");

  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const election = {
    _id: electionOid,
    electionType: "president",
    countryId: "US",
    status: "active",
    primaryEndTurn: 100,
  };
  vi.mocked(resolveElectionRouteParam).mockResolvedValue({
    ok: true,
    election,
  } as never);

  vi.mocked(requireHumanSessionWithCharacter).mockResolvedValue({
    ok: true,
    user: {
      userId: new ObjectId().toString(),
      character: {
        _id: endorserOid,
        name: "Vladimir Iskra",
        countryId: "US",
        party: opts.endorserParty,
      },
    },
  } as never);

  vi.mocked(getGameTime).mockResolvedValue({
    currentTurn: opts.currentTurn ?? 50,
    effectiveNow: new Date("2026-08-24T00:00:00Z"),
  } as never);

  // First findOne: the target candidacy row. Second findOne: own candidacy.
  db.collectionMocks
    .electionCandidates!.findOne.mockResolvedValueOnce({
      _id: candidateRowOid,
      electionId: electionOid,
      characterId: endorsedCharOid,
      characterName: "Lyndon B. Johnson",
      party: opts.candidateParty,
      status: "active",
      isNPP: false,
      support: 55,
    })
    .mockResolvedValue(null); // no own candidacy → not suspended

  return db;
}

function makeRequest(): Request {
  return new Request("http://localhost/api/elections/x/endorse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidateId: candidateRowOid.toString() }),
  });
}

describe("POST /api/elections/[id]/endorse — primary-phase party gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a cross-party endorsement while the primary is running", async () => {
    const db = setupScenario({ endorserParty: "4", candidateParty: "1" });

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ id: electionOid.toString() }),
    });

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toMatch(/own party/i);
    expect(db.collectionMocks.playerEndorsements!.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.playerEndorsements!.updateMany).not.toHaveBeenCalled();
  });

  it("accepts a same-party endorsement during the primary", async () => {
    const db = setupScenario({ endorserParty: "1", candidateParty: "1" });

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ id: electionOid.toString() }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
    expect(db.collectionMocks.playerEndorsements!.insertOne).toHaveBeenCalledTimes(1);
  });

  it("allows a cross-party endorsement once the race is in its general phase", async () => {
    const db = setupScenario({
      endorserParty: "4",
      candidateParty: "1",
      currentTurn: 150,
    });

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ id: electionOid.toString() }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
    expect(db.collectionMocks.playerEndorsements!.insertOne).toHaveBeenCalledTimes(1);
  });
});
