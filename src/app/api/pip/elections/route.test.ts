import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
}));

vi.mock("@/lib/countryAccess", () => ({
  getEnabledCountryIds: vi.fn().mockResolvedValue(["US"]),
}));

vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({
    currentTurn: 100,
    effectiveNow: new Date(),
    lastTurnProcessed: new Date(),
    isActive: true,
    pausedAt: null,
  }),
}));

describe("GET /api/pip/elections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not populate playerRace or character-scoped country data for a banned or revoked session", async () => {
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue(null);

    const charactersFindOne = vi.fn();
    const electedOfficialsFind = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    });
    const electionsFind = vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
    });
    const collection = vi.fn().mockImplementation((name: string) => {
      if (name === "characters") return { findOne: charactersFindOne };
      if (name === "elections")
        return { find: electionsFind, findOne: vi.fn().mockResolvedValue(null) };
      if (name === "electedOfficials") return { find: electedOfficialsFind };
      if (name === "electionCandidates")
        return { findOne: vi.fn().mockResolvedValue(null), find: vi.fn() };
      if (name === "electionVoteTallies") return { findOne: vi.fn().mockResolvedValue(null) };
      return { findOne: vi.fn().mockResolvedValue(null) };
    });

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({ collection } as never);

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.playerRace).toBeNull();
    expect(json.legislature.primaryLabel).toContain("House");
    expect(charactersFindOne).not.toHaveBeenCalled();
  });
});
