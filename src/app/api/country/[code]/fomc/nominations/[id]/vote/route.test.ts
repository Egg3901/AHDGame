import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

const mockGetDb = vi.fn();
const mockRequireBasicAuth = vi.fn();
const mockGetGameTime = vi.fn();

vi.mock("@/lib/mongodb", () => ({ getDb: () => mockGetDb() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: () => mockRequireBasicAuth() }));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: () => mockGetGameTime() }));
// Rate limiter: always allow.
vi.mock("@/lib/api/rateLimit", () => ({
  CONGRESS_LIMITS: { maxRequests: 100, windowMs: 1000 },
  checkRateLimit: () => ({ ok: true }),
  rateLimitResponse: () => new Response("rate", { status: 429 }),
}));

import { POST } from "./route";

const NOM_ID = new ObjectId();
const USER_ID = new ObjectId();
const CHAR_ID = new ObjectId();

/** Mock db: the nomination is active and voting is open (turn 100 < ends 120). */
function makeDb(opts: { senator: boolean }) {
  const updateCalls: unknown[][] = [];
  const collection = (name: string) => {
    if (name === "fomcNominations") {
      return {
        findOne: vi.fn().mockResolvedValue({
          _id: NOM_ID,
          countryId: "US",
          status: "active",
          votingEndsOnTurn: 120,
          votes: {},
        }),
        updateOne: vi.fn((...args: unknown[]) => {
          updateCalls.push(args);
          return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
        }),
      };
    }
    if (name === "characters") {
      return { findOne: vi.fn().mockResolvedValue({ _id: CHAR_ID, userId: USER_ID }) };
    }
    if (name === "electedOfficials") {
      return {
        findOne: vi
          .fn()
          .mockResolvedValue(
            opts.senator ? { characterId: CHAR_ID, officeType: "senate", countryId: "US" } : null
          ),
      };
    }
    return { findOne: vi.fn().mockResolvedValue(null), updateOne: vi.fn().mockResolvedValue({}) };
  };
  return { db: { collection: vi.fn(collection) }, updateCalls };
}

function req() {
  return new Request("http://x/api/country/us/fomc/nominations/x/vote", {
    method: "POST",
    body: JSON.stringify({ vote: "for" }),
  });
}
const params = Promise.resolve({ code: "us", id: NOM_ID.toString() });

describe("POST fomc nominations vote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireBasicAuth.mockResolvedValue({ ok: true, user: { userId: USER_ID.toString() } });
    mockGetGameTime.mockResolvedValue({ effectiveNow: new Date(), currentTurn: 100 });
  });

  it("records a seated senator's vote into the nomination tally", async () => {
    const { db, updateCalls } = makeDb({ senator: true });
    mockGetDb.mockReturnValue(db);
    const res = await POST(req(), { params });
    expect(res.status).toBe(200);
    // The first update is the vote itself, gated on the active nomination.
    // (A second update from clearWhippedFromVote may follow.)
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    expect((updateCalls[0][0] as { status: string }).status).toBe("active");
  });

  it("rejects a non-senator with 403", async () => {
    const { db } = makeDb({ senator: false });
    mockGetDb.mockReturnValue(db);
    const res = await POST(req(), { params });
    expect(res.status).toBe(403);
  });

  it("rejects once the game-clock voting deadline has passed (409)", async () => {
    const { db } = makeDb({ senator: true });
    mockGetDb.mockReturnValue(db);
    mockGetGameTime.mockResolvedValue({ effectiveNow: new Date(), currentTurn: 130 }); // > 120
    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
  });
});
