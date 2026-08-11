import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
}));

vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));

describe("Presidential running mate integration tests", () => {
  const electionId = new ObjectId();
  const userId = new ObjectId().toString();
  const candidateId = new ObjectId();
  const runningMateId = new ObjectId();

  beforeEach(async () => {
    vi.clearAllMocks();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId,
        username: "testuser",
        email: "a@b.c",
        role: "user",
        isAdmin: false,
        hasCharacter: true,
        character: {
          _id: candidateId,
          name: "Nominee",
          party: "democrat",
          homeState: "california",
          countryId: "US",
        },
      },
    } as never);
  });

  it("rejects a running mate who already served two presidential terms", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const runningMateUserId = new ObjectId();

    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "elections") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: electionId,
              electionType: "president",
              status: "active",
              countryId: "US",
            }),
          };
        }
        if (name === "electionCandidates") {
          return {
            findOne: vi
              .fn()
              .mockResolvedValueOnce({
                _id: new ObjectId(),
                electionId,
                characterId: candidateId,
                status: "active",
                party: "democrat",
              })
              .mockResolvedValueOnce(null),
          };
        }
        if (name === "electedOfficials") {
          return {
            findOne: vi.fn().mockResolvedValue(null),
          };
        }
        if (name === "characters") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: runningMateId,
              userId: runningMateUserId,
              name: "Former President",
              party: "democrat",
              countryId: "US",
              executiveTermsServed: { US: 2 },
            }),
          };
        }
        if (name === "users") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: runningMateUserId,
              isBanned: false,
            }),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
        };
      }),
    };

    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const { POST } = await import("../[id]/running-mate/route");
    const req = new Request(
      `http://localhost/api/elections/${electionId.toString()}/running-mate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runningMateId: runningMateId.toString() }),
      }
    );

    const res = await POST(req, { params: Promise.resolve({ id: electionId.toString() }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("maximum number of presidential terms");
  });

  it("allows selecting a running mate from a different party", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const runningMateUserId = new ObjectId();
    const findCandidate = vi
      .fn()
      .mockResolvedValueOnce({
        _id: new ObjectId(),
        electionId,
        characterId: candidateId,
        status: "active",
        party: "democrat",
      })
      .mockResolvedValueOnce(null);
    const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });

    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "elections") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: electionId,
              electionType: "president",
              status: "active",
              countryId: "US",
            }),
          };
        }
        if (name === "electionCandidates") {
          return {
            findOne: findCandidate,
            updateOne,
          };
        }
        if (name === "electedOfficials") {
          return {
            findOne: vi.fn().mockResolvedValue(null),
          };
        }
        if (name === "characters") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: runningMateId,
              userId: runningMateUserId,
              name: "Across The Aisle",
              party: "republican",
              countryId: "US",
              executiveTermsServed: { US: 0 },
            }),
          };
        }
        if (name === "users") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: runningMateUserId,
              isBanned: false,
            }),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
        };
      }),
    };

    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const { POST } = await import("../[id]/running-mate/route");
    const req = new Request(
      `http://localhost/api/elections/${electionId.toString()}/running-mate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runningMateId: runningMateId.toString() }),
      }
    );

    const res = await POST(req, { params: Promise.resolve({ id: electionId.toString() }) });
    const json = await res.json();
    expect(res.status, JSON.stringify(json)).toBe(200);
    expect(json.success).toBe(true);
    expect(json.message).toContain("Across The Aisle");
    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  it("rejects a banned character even if a crafted POST targets them directly", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const runningMateUserId = new ObjectId();
    const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });

    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "elections") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: electionId,
              electionType: "president",
              status: "active",
              countryId: "US",
            }),
          };
        }
        if (name === "electionCandidates") {
          return {
            findOne: vi
              .fn()
              .mockResolvedValueOnce({
                _id: new ObjectId(),
                electionId,
                characterId: candidateId,
                status: "active",
                party: "democrat",
              })
              .mockResolvedValueOnce(null),
            updateOne,
          };
        }
        if (name === "electedOfficials") {
          return {
            findOne: vi.fn().mockResolvedValue(null),
          };
        }
        if (name === "characters") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: runningMateId,
              userId: runningMateUserId,
              name: "Banned Target",
              party: "republican",
              countryId: "US",
              executiveTermsServed: { US: 0 },
            }),
          };
        }
        if (name === "users") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: runningMateUserId,
              isBanned: true,
            }),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
        };
      }),
    };

    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const { POST } = await import("../[id]/running-mate/route");
    const req = new Request(
      `http://localhost/api/elections/${electionId.toString()}/running-mate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runningMateId: runningMateId.toString() }),
      }
    );

    const res = await POST(req, { params: Promise.resolve({ id: electionId.toString() }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("not eligible");
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("filters banned, term-limited, and already-active candidates out of the running mate picker list", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const eligibleId = new ObjectId();
    const eligibleUserId = new ObjectId();
    const bannedId = new ObjectId();
    const bannedUserId = new ObjectId();
    const activeCandidateId = new ObjectId();
    const activeCandidateUserId = new ObjectId();

    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "elections") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: electionId,
              electionType: "president",
              status: "active",
              countryId: "US",
            }),
          };
        }
        if (name === "electionCandidates") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: new ObjectId(),
              electionId,
              characterId: candidateId,
              status: "active",
              party: "democrat",
            }),
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([
                  {
                    characterId: candidateId,
                  },
                  {
                    characterId: activeCandidateId,
                  },
                ]),
              }),
            }),
          };
        }
        if (name === "electedOfficials") {
          return {
            findOne: vi.fn().mockResolvedValue(null),
          };
        }
        if (name === "characters") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                sort: vi.fn().mockReturnValue({
                  toArray: vi.fn().mockResolvedValue([
                    {
                      _id: runningMateId,
                      userId: new ObjectId(),
                      name: "Former President",
                      party: "democrat",
                      homeState: "texas",
                      careerHistory: [
                        {
                          type: "elected",
                          office: { type: "president" },
                          officeLabel: "President",
                          date: new Date("2021-01-20T12:00:00Z"),
                        },
                        {
                          type: "elected",
                          office: { type: "president" },
                          officeLabel: "President",
                          date: new Date("2025-01-20T12:00:00Z"),
                        },
                      ],
                      countryId: "US",
                    },
                    {
                      _id: eligibleId,
                      userId: eligibleUserId,
                      name: "Fresh Face",
                      party: "democrat",
                      homeState: "ohio",
                      countryId: "US",
                      executiveTermsServed: { US: 1 },
                    },
                    {
                      _id: bannedId,
                      userId: bannedUserId,
                      name: "Banned Character",
                      party: "republican",
                      homeState: "florida",
                      countryId: "US",
                      executiveTermsServed: { US: 0 },
                    },
                    {
                      _id: activeCandidateId,
                      userId: activeCandidateUserId,
                      name: "Already Running",
                      party: "independent",
                      homeState: "nevada",
                      countryId: "US",
                      executiveTermsServed: { US: 0 },
                    },
                  ]),
                }),
              }),
            }),
          };
        }
        if (name === "users") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([
                {
                  _id: eligibleUserId,
                  isBanned: false,
                },
                {
                  _id: bannedUserId,
                  isBanned: true,
                },
                {
                  _id: activeCandidateUserId,
                  isBanned: false,
                },
              ]),
            }),
          };
        }
        if (name === "politicalParties") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([]),
            }),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
        };
      }),
    };

    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const { GET } = await import("../[id]/running-mate/characters/route");
    const req = new Request(
      `http://localhost/api/elections/${electionId.toString()}/running-mate/characters`
    );

    const res = await GET(req, { params: Promise.resolve({ id: electionId.toString() }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.characters).toHaveLength(1);
    expect(json.characters[0].name).toBe("Fresh Face");
  });

  it("returns a human-readable party name (not the raw sequential id) for the picker", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const eligibleId = new ObjectId();
    const eligibleUserId = new ObjectId();

    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "elections") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: electionId,
              electionType: "president",
              status: "active",
              countryId: "NG",
            }),
          };
        }
        if (name === "electionCandidates") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: new ObjectId(),
              electionId,
              characterId: candidateId,
              status: "active",
              party: "6",
            }),
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([{ characterId: candidateId }]),
              }),
            }),
          };
        }
        if (name === "electedOfficials") {
          return { findOne: vi.fn().mockResolvedValue(null) };
        }
        if (name === "characters") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                sort: vi.fn().mockReturnValue({
                  toArray: vi.fn().mockResolvedValue([
                    {
                      _id: eligibleId,
                      userId: eligibleUserId,
                      name: "Chinedu Okafor",
                      // Party stored as the sequential id, as in production data.
                      party: "6",
                      homeState: "LAGOS",
                      countryId: "NG",
                    },
                  ]),
                }),
              }),
            }),
          };
        }
        if (name === "users") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([{ _id: eligibleUserId, isBanned: false }]),
            }),
          };
        }
        if (name === "politicalParties") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([
                {
                  countryId: "NG",
                  sequentialId: 6,
                  name: "All Progressives Congress",
                  color: "#008000",
                },
              ]),
            }),
          };
        }
        return { findOne: vi.fn().mockResolvedValue(null) };
      }),
    };

    vi.mocked(getDb).mockResolvedValue(mockDb as never);

    const { GET } = await import("../[id]/running-mate/characters/route");
    const req = new Request(
      `http://localhost/api/elections/${electionId.toString()}/running-mate/characters`
    );

    const res = await GET(req, { params: Promise.resolve({ id: electionId.toString() }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.characters).toHaveLength(1);
    // Party key stays the sequential id (used for filtering + PartyLogo lookup)…
    expect(json.characters[0].party).toBe("6");
    // …but a readable name is surfaced for display, resolved from the party doc.
    expect(json.characters[0].partyName).toBe("All Progressives Congress");
  });
});
