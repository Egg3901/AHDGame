import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  ELECTION_LIMITS: { maxRequests: 20, windowMs: 60000 },
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/elections/electionParamResolution", () => ({
  resolveElectionRouteParam: vi.fn(),
}));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));
vi.mock("@/lib/elections/raceWireEmit", () => ({ emitStateAttackWire: vi.fn() }));
// The real helper opens a Mongo session against a client this test does not
// have. Route it straight to the sequential path, which is what standalone dev
// and production Mongo both take anyway.
vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi.fn(async (_inTx: unknown, fallback: () => Promise<unknown>) =>
    fallback()
  ),
}));

let db: MockDb;
const ELECTION_OID = new ObjectId();
const USER_ID = new ObjectId().toString();
const MY_CHARACTER_OID = new ObjectId();
const MY_ROW_OID = new ObjectId();
const RIVAL_ROW_OID = new ObjectId();
const RIVAL_CHARACTER_OID = new ObjectId();
const CAMPAIGN_OID = new ObjectId();

function body(over: Record<string, unknown> = {}) {
  return {
    targetCandidateId: RIVAL_ROW_OID.toString(),
    stateId: "IA",
    kind: "localFavorability",
    ...over,
  };
}

async function callRoute(payload: Record<string, unknown> = body()) {
  const { POST } = await import("./route");
  const id = ELECTION_OID.toString();
  return POST(
    new Request(`http://t/api/elections/${id}/state-attack`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: {
      userId: USER_ID,
      character: { _id: MY_CHARACTER_OID, name: "Adlai Stevenson", party: "DEM" },
    },
  } as never);

  const { checkRateLimit } = await import("@/lib/api/rateLimit");
  vi.mocked(checkRateLimit).mockReturnValue({ ok: true } as never);

  const { resolveElectionRouteParam } = await import("@/lib/elections/electionParamResolution");
  vi.mocked(resolveElectionRouteParam).mockResolvedValue({
    ok: true,
    election: {
      _id: ELECTION_OID,
      electionType: "president",
      countryId: "US",
      status: "active",
      primaryEndTurn: 40,
    },
  } as never);

  const { getGameTime } = await import("@/lib/time/gameTime");
  vi.mocked(getGameTime).mockResolvedValue({ currentTurn: 12 } as never);

  db.collectionMocks.gameState = db.collection("gameState");
  db.collection("gameState").findOne.mockResolvedValue({ _id: "current" });

  db.collection("electionCandidates").findOne.mockImplementation(
    async (filter: Record<string, unknown>) => {
      if (filter.characterId) {
        return {
          _id: MY_ROW_OID,
          electionId: ELECTION_OID,
          characterId: MY_CHARACTER_OID,
          characterName: "Adlai Stevenson",
          party: "DEM",
          status: "active",
        };
      }
      return {
        _id: RIVAL_ROW_OID,
        electionId: ELECTION_OID,
        characterId: RIVAL_CHARACTER_OID,
        characterName: "Estes Kefauver",
        party: "DEM",
        status: "active",
      };
    }
  );

  db.collection("primaryStateActions").findOne.mockResolvedValue(null);

  db.collection("campaigns").findOne.mockImplementation(async (filter: Record<string, unknown>) => {
    const wantsMine = filter.candidateId?.toString() === MY_CHARACTER_OID.toString();
    if (wantsMine) return { _id: CAMPAIGN_OID, funds: 500_000 };
    // The rival, with Rapid Response unlocked.
    return { _id: new ObjectId(), funds: 250_000, mediaSpendingTree: { starter: true, c: 0 } };
  });

  db.collection("characters").findOne.mockResolvedValue({ _id: MY_CHARACTER_OID, actions: 20 });
  db.collection("states").findOne.mockResolvedValue({ _id: "IA", name: "Iowa" });
});

describe("POST /api/elections/[id]/state-attack", () => {
  it("opens the attack, debiting funds and actions and inserting a live row", async () => {
    const res = await callRoute();
    expect(res.status).toBe(200);

    const inserted = db.collectionMocks.primaryStateActions!.insertOne.mock.calls[0][0];
    expect(inserted.actorCandidateId).toEqual(MY_ROW_OID);
    expect(inserted.targetCandidateId).toEqual(RIVAL_ROW_OID);
    // The engine's favourability map is keyed by character, not candidate row:
    // storing only the row id would charge the attacker and move nobody.
    expect(inserted.targetCharacterId).toEqual(RIVAL_CHARACTER_OID);
    expect(inserted.stateId).toBe("IA");
    expect(inserted.expiresTurn).toBeGreaterThan(12);

    expect(db.collectionMocks.characters!.updateOne).toHaveBeenCalled();
    expect(db.collectionMocks.campaigns!.updateOne).toHaveBeenCalled();
  });

  it("stamps the target's Rapid Response shield onto the row at purchase", async () => {
    db.collection("campaigns").findOne.mockImplementation(
      async (filter: Record<string, unknown>) => {
        if (filter.candidateId?.toString() === MY_CHARACTER_OID.toString()) {
          return { _id: CAMPAIGN_OID, funds: 500_000 };
        }
        return { _id: new ObjectId(), mediaSpendingTree: { starter: true, c: 2 } };
      }
    );
    const res = await callRoute();
    expect(res.status).toBe(200);
    const inserted = db.collectionMocks.primaryStateActions!.insertOne.mock.calls[0][0];
    // A retune of their tree later must not rewrite an attack already paid for.
    expect(inserted.shieldApplied).toBeGreaterThan(0);
  });

  it("rejects a kind that does not exist", async () => {
    const res = await callRoute(body({ kind: "bribeDelegates" }));
    expect(res.status).toBe(400);
    expect(db.collectionMocks.primaryStateActions!.insertOne).not.toHaveBeenCalled();
  });

  it("rejects a phase-2 kind nothing reads yet", async () => {
    // Accepting `voteSuppression` before the engine reads it would charge a
    // player for nothing, exactly as the home-state surge did for months.
    const res = await callRoute(body({ kind: "voteSuppression" }));
    expect(res.status).toBe(400);
    expect(db.collectionMocks.primaryStateActions!.insertOne).not.toHaveBeenCalled();
  });

  it("rejects a code that is not a US electoral unit", async () => {
    const res = await callRoute(body({ stateId: "ZZ" }));
    expect(res.status).toBe(400);
    expect(db.collectionMocks.primaryStateActions!.insertOne).not.toHaveBeenCalled();
  });

  it("refuses self-targeting", async () => {
    const res = await callRoute(body({ targetCandidateId: MY_ROW_OID.toString() }));
    expect(res.status).toBe(400);
    expect(db.collectionMocks.primaryStateActions!.insertOne).not.toHaveBeenCalled();
  });

  it("refuses a rival from the other party", async () => {
    db.collection("electionCandidates").findOne.mockImplementation(
      async (filter: Record<string, unknown>) => {
        if (filter.characterId) {
          return { _id: MY_ROW_OID, characterId: MY_CHARACTER_OID, party: "DEM", status: "active" };
        }
        return {
          _id: RIVAL_ROW_OID,
          characterId: RIVAL_CHARACTER_OID,
          party: "REP",
          status: "active",
        };
      }
    );
    const res = await callRoute();
    expect(res.status).toBe(400);
    expect(db.collectionMocks.primaryStateActions!.insertOne).not.toHaveBeenCalled();
  });

  it("refuses once the primary has closed", async () => {
    const { resolveElectionRouteParam } = await import("@/lib/elections/electionParamResolution");
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({
      ok: true,
      election: {
        _id: ELECTION_OID,
        electionType: "president",
        countryId: "US",
        status: "active",
        primaryEndTurn: 10,
      },
    } as never);
    const res = await callRoute();
    expect(res.status).toBe(400);
    expect(db.collectionMocks.primaryStateActions!.insertOne).not.toHaveBeenCalled();
  });

  it("refuses a second attack on the same rival in the same state", async () => {
    db.collection("primaryStateActions").findOne.mockResolvedValue({ _id: new ObjectId() });
    const res = await callRoute();
    expect(res.status).toBe(409);
    expect(db.collectionMocks.primaryStateActions!.insertOne).not.toHaveBeenCalled();
  });

  it("charges the war chest in the campaign's own currency", async () => {
    // The constant is anchor-denominated. Comparing it against a local balance
    // would let a campaign in a weak currency buy at a fraction of the price.
    db.collection("exchangeRates").findOne.mockResolvedValue({ currencyCode: "USD", rate: 2 });
    const res = await callRoute();
    expect(res.status).toBe(200);
    const [, update] = db.collectionMocks.campaigns!.updateOne.mock.calls[0];
    expect(update.$inc.funds).toBe(-80_000);
  });

  it("refuses a campaign that cannot afford it", async () => {
    db.collection("campaigns").findOne.mockImplementation(
      async (filter: Record<string, unknown>) => {
        if (filter.candidateId?.toString() === MY_CHARACTER_OID.toString()) {
          return { _id: CAMPAIGN_OID, funds: 10 };
        }
        return { _id: new ObjectId() };
      }
    );
    const res = await callRoute();
    expect(res.status).toBe(400);
    expect(db.collectionMocks.primaryStateActions!.insertOne).not.toHaveBeenCalled();
  });

  it("refuses a character without the actions", async () => {
    db.collection("characters").findOne.mockResolvedValue({ _id: MY_CHARACTER_OID, actions: 1 });
    const res = await callRoute();
    expect(res.status).toBe(400);
    expect(db.collectionMocks.primaryStateActions!.insertOne).not.toHaveBeenCalled();
  });

  it("requires a character", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    } as never);
    expect((await callRoute()).status).toBe(401);
  });

  it("refuses a viewer who is not a candidate in the race", async () => {
    db.collection("electionCandidates").findOne.mockImplementation(
      async (filter: Record<string, unknown>) =>
        filter.characterId ? null : { _id: RIVAL_ROW_OID }
    );
    expect((await callRoute()).status).toBe(403);
  });
});
