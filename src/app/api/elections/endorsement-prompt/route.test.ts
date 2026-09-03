import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireHumanSessionWithCharacter: vi.fn(),
}));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));

import { getDb } from "@/lib/mongodb";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { getGameTime } from "@/lib/time/gameTime";
import { ObjectId } from "mongodb";

const mockGetDb = vi.mocked(getDb);
const mockAuth = vi.mocked(requireHumanSessionWithCharacter);
const mockGameTime = vi.mocked(getGameTime);

const request = () => new Request("http://localhost/api/elections/endorsement-prompt");

const CHAR_ID = new ObjectId();
const ELECTION_ID = new ObjectId();

function authAs(overrides: Record<string, unknown> = {}) {
  mockAuth.mockResolvedValueOnce({
    ok: true,
    user: {
      userId: new ObjectId().toString(),
      isAdmin: false,
      hasCharacter: true,
      character: { _id: CHAR_ID, countryId: "US", party: "1", name: "Voter One", ...overrides },
    },
  } as never);
}

interface WorldOpts {
  election?: Record<string, unknown> | null;
  endorsement?: Record<string, unknown> | null;
  candidates?: Record<string, unknown>[];
}

function world({ election, endorsement = null, candidates = [] }: WorldOpts) {
  const collections: Record<string, unknown> = {
    elections: { findOne: vi.fn().mockResolvedValue(election ?? null) },
    playerEndorsements: { findOne: vi.fn().mockResolvedValue(endorsement) },
    electionCandidates: {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(candidates) }),
    },
    politicalParties: {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { sequentialId: 1, abbreviation: "DEM", color: "#3b82f6", countryId: "US" },
          { sequentialId: 2, abbreviation: "REP", color: "#ef4444", countryId: "US" },
        ]),
      }),
    },
  };
  mockGetDb.mockResolvedValueOnce({
    collection: vi.fn((name: string) => collections[name]),
  } as never);
  return collections;
}

const liveElection = {
  _id: ELECTION_ID,
  electionType: "president",
  countryId: "US",
  status: "active",
  cycle: 3,
  electionYear: 1960,
};

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    characterId: new ObjectId(),
    characterName: "Candidate A",
    party: "1",
    status: "active",
    support: 50,
    ...overrides,
  };
}

describe("GET /api/elections/endorsement-prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: general phase (no primary boundary at all).
    mockGameTime.mockResolvedValue({ currentTurn: 100, effectiveNow: new Date() } as never);
  });

  it("passes the auth failure straight through", async () => {
    mockAuth.mockResolvedValueOnce({
      ok: false,
      response: new Response(null, { status: 401 }),
    } as never);
    const { GET } = await import("./route");
    expect((await GET(request())).status).toBe(401);
  });

  it("returns no prompt when the player's country has no live presidential race", async () => {
    authAs();
    world({ election: null });
    const { GET } = await import("./route");
    const body = await (await GET(request())).json();
    expect(body.prompt).toBeNull();
  });

  it("scopes the race lookup to the caller's own country", async () => {
    authAs({ countryId: "DE" });
    const collections = world({ election: null });
    const { GET } = await import("./route");
    await GET(request());
    expect(
      (collections.elections as { findOne: ReturnType<typeof vi.fn> }).findOne
    ).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: "DE", electionType: "president" }),
      expect.anything()
    );
  });

  it("returns no prompt when the player already endorsed someone in this race", async () => {
    authAs();
    world({
      election: liveElection,
      endorsement: { _id: new ObjectId(), isActive: true },
      candidates: [candidate()],
    });
    const { GET } = await import("./route");
    const body = await (await GET(request())).json();
    expect(body.prompt).toBeNull();
  });

  it("returns the endorsable field, strongest first, with party display data", async () => {
    authAs();
    const weak = candidate({ characterName: "Weak", party: "2", support: 10 });
    const strong = candidate({ characterName: "Strong", party: "1", support: 80 });
    world({ election: liveElection, candidates: [weak, strong] });
    const { GET } = await import("./route");
    const res = await GET(request());
    const body = await res.json();

    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(body.prompt.electionId).toBe(ELECTION_ID.toString());
    expect(body.prompt.year).toBe(1960);
    expect(body.prompt.inPrimary).toBe(false);
    expect(body.prompt.candidates.map((c: { name: string }) => c.name)).toEqual(["Strong", "Weak"]);
    expect(body.prompt.candidates[0]).toMatchObject({ partyAbbr: "DEM", partyColor: "#3b82f6" });
    expect(body.prompt.candidates[1]).toMatchObject({ partyAbbr: "REP", partyColor: "#ef4444" });
  });

  it("never offers the player their own candidacy", async () => {
    authAs();
    world({
      election: liveElection,
      candidates: [candidate({ characterId: CHAR_ID, characterName: "Me" }), candidate()],
    });
    const { GET } = await import("./route");
    const body = await (await GET(request())).json();
    expect(body.prompt.candidates.map((c: { name: string }) => c.name)).toEqual(["Candidate A"]);
  });

  it("hides cross-party candidates while the primary is open", async () => {
    // The endorse route 403s on a cross-party endorsement during the primary,
    // so offering the button would be offering a guaranteed failure.
    authAs();
    mockGameTime.mockResolvedValue({ currentTurn: 5, effectiveNow: new Date() } as never);
    world({
      election: { ...liveElection, primaryEndTurn: 10 },
      candidates: [
        candidate({ characterName: "Same party", party: "1" }),
        candidate({ characterName: "Other party", party: "2" }),
      ],
    });
    const { GET } = await import("./route");
    const body = await (await GET(request())).json();
    expect(body.prompt.inPrimary).toBe(true);
    expect(body.prompt.candidates.map((c: { name: string }) => c.name)).toEqual(["Same party"]);
  });

  it("returns no prompt for a suspended candidate, who cannot endorse at all", async () => {
    authAs();
    world({
      election: liveElection,
      candidates: [
        candidate({ characterId: CHAR_ID, campaignSuspended: true }),
        candidate({ characterName: "Rival" }),
      ],
    });
    const { GET } = await import("./route");
    const body = await (await GET(request())).json();
    expect(body.prompt).toBeNull();
  });

  it("returns no prompt when filtering leaves nobody to endorse", async () => {
    authAs();
    world({ election: liveElection, candidates: [candidate({ characterId: CHAR_ID })] });
    const { GET } = await import("./route");
    const body = await (await GET(request())).json();
    expect(body.prompt).toBeNull();
  });

  it("caps a crowded primary field at six candidates", async () => {
    authAs();
    world({
      election: liveElection,
      candidates: Array.from({ length: 12 }, (_, i) =>
        candidate({ characterName: `C${i}`, support: 100 - i })
      ),
    });
    const { GET } = await import("./route");
    const body = await (await GET(request())).json();
    expect(body.prompt.candidates).toHaveLength(6);
    expect(body.prompt.candidates[0].name).toBe("C0");
  });
});
