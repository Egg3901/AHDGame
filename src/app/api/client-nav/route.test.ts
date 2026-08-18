import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
  getJwtSecret: vi.fn(() => new TextEncoder().encode("test-secret")),
  getAuthCookieOptions: vi.fn(async () => ({
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  })),
  clearAuthCookie: vi.fn(async () => {}),
}));

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/db/collections", () => ({
  getGameStateCollection: vi.fn(),
}));

vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn(async () => true),
}));

describe("GET /api/client-nav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns guest data and clears the cookie when the session is revoked", async () => {
    const cookieStore = {
      get: vi.fn().mockReturnValue({ value: "stale.jwt.token" }),
      set: vi.fn(),
    };

    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue(cookieStore as never);

    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue(null);

    const electionFindOne = vi.fn().mockResolvedValue(null);
    const gameStateFindOne = vi.fn().mockResolvedValue({ wikiDisabled: false });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "elections") return { findOne: electionFindOne };
        return { findOne: vi.fn().mockResolvedValue(null) };
      }),
    } as never);

    const { getGameStateCollection } = await import("@/lib/db/collections");
    vi.mocked(getGameStateCollection).mockResolvedValue({
      findOne: gameStateFindOne,
    } as never);

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.user).toBeNull();
    expect(json.hasCharacter).toBe(false);
    const { clearAuthCookie } = await import("@/lib/auth");
    expect(clearAuthCookie).toHaveBeenCalledWith(expect.stringContaining("client_nav:"));
    expect(electionFindOne).toHaveBeenCalledTimes(1);
    expect(gameStateFindOne).toHaveBeenCalledTimes(1);
  });

  it("includes currentParty.countryId for multi-country party links", async () => {
    const cookieStore = {
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
    };

    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue(cookieStore as never);

    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({
      userId: "507f1f77bcf86cd799439011",
      email: "uk@example.com",
      username: "uk-player",
      role: "player",
      isAdmin: false,
    } as never);

    const userId = new ObjectId("507f1f77bcf86cd799439011");
    const characterId = new ObjectId("507f191e810c19729de860ea");

    const db = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "elections") {
          return {
            findOne: vi.fn().mockResolvedValue(null),
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([]),
              }),
            }),
          };
        }

        if (name === "users") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: userId,
              role: "player",
              isAdmin: false,
              activeCharacterId: null,
              activeCharacterType: "character",
              activeImperialCharacterId: null,
            }),
            updateOne: vi.fn().mockResolvedValue({}),
          };
        }

        if (name === "characters") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: characterId,
              name: "Sheev Palpatine",
              homeState: "WMI",
              countryId: "UK",
              party: "1",
              displayCurrencyPreference: "JPY",
              demographics: { age: 42 },
              actions: 12,
              funds: 5000,
            }),
            // Phase 6 — pendingCharterCount lookup walks every character
            // owned by the userId, then counts charters where any of them
            // is a founder. Test stub: one character, zero charters.
            find: vi.fn().mockReturnValue({
              project: () => ({
                toArray: vi.fn().mockResolvedValue([{ _id: characterId }]),
              }),
            }),
          };
        }

        if (name === "states") {
          return {
            findOne: vi.fn().mockResolvedValue({ _id: "WMI", name: "West Midlands" }),
          };
        }

        if (name === "politicalParties") {
          return {
            findOne: vi.fn().mockResolvedValue({
              name: "Labour Party",
              sequentialId: 1,
              countryId: "UK",
            }),
          };
        }

        if (name === "notifications" || name === "playerMail") {
          return {
            countDocuments: vi.fn().mockResolvedValue(0),
          };
        }

        if (name === "partyCharters") {
          return {
            countDocuments: vi.fn().mockResolvedValue(0),
          };
        }

        if (name === "electionCandidates" || name === "cabinetMembers" || name === "campaigns") {
          return {
            findOne: vi.fn().mockResolvedValue(null),
          };
        }

        return {
          findOne: vi.fn().mockResolvedValue(null),
        };
      }),
    };

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { getGameStateCollection } = await import("@/lib/db/collections");
    vi.mocked(getGameStateCollection).mockResolvedValue({
      // rpgStatsEnabled gates needsStatAllocation — on here so the flag surfaces.
      findOne: vi.fn().mockResolvedValue({ wikiDisabled: false, rpgStatsEnabled: true }),
    } as never);

    const { GET } = await import("./route");
    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.currentParty).toEqual({
      id: "1",
      name: "Labour Party",
      countryId: "UK",
    });
    expect(json.homeState).toEqual({
      id: "WMI",
      name: "West Midlands",
      countryId: "UK",
    });
    expect(json.myCorporationType).toBeNull();
    expect(json.myCorporationCountryId).toBeNull();
    expect(json.user.forexEnabled).toBe(true);
    expect(json.user.character).toEqual({
      id: characterId.toString(),
      name: "Sheev Palpatine",
      countryId: "UK",
      party: "1",
      displayCurrencyPreference: "JPY",
      avatarUrl: null,
      profileHeaderImageUrl: null,
      borderKey: null,
      tintColor: null,
      // Fixture character has no statsAllocated → grandfather flag is true.
      needsStatAllocation: true,
    });
  });

  it("surfaces the active imperial display preference for currency bootstrap consumers", async () => {
    const cookieStore = {
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
    };

    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue(cookieStore as never);

    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({
      userId: "507f1f77bcf86cd799439011",
      email: "emperor@example.com",
      username: "emperor",
      role: "player",
      isAdmin: false,
    } as never);

    const userId = new ObjectId("507f1f77bcf86cd799439011");
    const imperialId = new ObjectId("507f191e810c19729de860eb");

    const db = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "elections") {
          return {
            findOne: vi.fn().mockResolvedValue(null),
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([]),
              }),
            }),
          };
        }

        if (name === "users") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: userId,
              role: "player",
              isAdmin: false,
              activeCharacterId: null,
              activeCharacterType: "imperial",
              activeImperialCharacterId: imperialId,
            }),
            updateOne: vi.fn().mockResolvedValue({}),
          };
        }

        if (name === "characters") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: new ObjectId("507f191e810c19729de860ea"),
              name: "Fallback Character",
              countryId: "US",
              party: "1",
              demographics: { age: 42 },
              actions: 12,
              funds: 5000,
            }),
            // Phase 6 — see note in earlier test stub.
            find: vi.fn().mockReturnValue({
              project: () => ({
                toArray: vi
                  .fn()
                  .mockResolvedValue([{ _id: new ObjectId("507f191e810c19729de860ea") }]),
              }),
            }),
          };
        }

        if (name === "imperialCharacters") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: imperialId,
              name: "Aurelia",
              countryId: "JP",
              displayCurrencyPreference: "EUR",
            }),
          };
        }

        if (name === "corporations") {
          return {
            findOne: vi.fn().mockResolvedValue({ sequentialId: 777 }),
          };
        }

        if (name === "notifications" || name === "playerMail") {
          return {
            countDocuments: vi.fn().mockResolvedValue(0),
          };
        }

        if (name === "partyCharters") {
          return {
            countDocuments: vi.fn().mockResolvedValue(0),
          };
        }

        if (name === "electionCandidates" || name === "cabinetMembers" || name === "campaigns") {
          return {
            findOne: vi.fn().mockResolvedValue(null),
          };
        }

        return {
          findOne: vi.fn().mockResolvedValue(null),
        };
      }),
    };

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { getGameStateCollection } = await import("@/lib/db/collections");
    vi.mocked(getGameStateCollection).mockResolvedValue({
      // rpgStatsEnabled gates needsStatAllocation — on here so the flag surfaces.
      findOne: vi.fn().mockResolvedValue({ wikiDisabled: false, rpgStatsEnabled: true }),
    } as never);

    const { GET } = await import("./route");
    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.characterCountryId).toBe("JP");
    expect(json.characterName).toBe("Aurelia");
    expect(json.myCorporationId).toBe(777);
    expect(json.myUnionId).toBeNull();
    expect(json.myCorporationType).toBeNull();
    expect(json.myCorporationCountryId).toBeNull();
    expect(json.user.imperialCharacter).toEqual({
      id: imperialId.toString(),
      name: "Aurelia",
      countryId: "JP",
      displayCurrencyPreference: "EUR",
      avatarUrl: null,
      profileHeaderImageUrl: null,
      borderKey: null,
      tintColor: null,
    });
  });
});
