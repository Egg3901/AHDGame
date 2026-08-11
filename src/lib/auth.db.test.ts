/**
 * Ensures auth DB access uses a single getDb() scope for user + character loading.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Character, User } from "@/lib/db/types";

const mockFindOneUser = vi.fn();
const mockFindOneCharacter = vi.fn();

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue({ value: "fake.jwt.token" }),
  }),
}));

vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
}));

describe("getAuthUserWithCharacter DB usage", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: (name: string) => {
        if (name === "users") {
          return { findOne: mockFindOneUser };
        }
        if (name === "characters") {
          return { findOne: mockFindOneCharacter };
        }
        return { findOne: vi.fn() };
      },
    } as never);

    const { jwtVerify } = await import("jose");
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        userId: "507f1f77bcf86cd799439011",
        email: "a@b.com",
        username: "player",
        role: "user",
        isAdmin: false,
      },
      protectedHeader: {},
    } as never);

    const userDoc = {
      _id: new ObjectId("507f1f77bcf86cd799439011"),
      email: "a@b.com",
      username: "player",
      displayName: "Player",
      password: "x",
      role: "player" as const,
      hasCompletedSetup: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies User;
    mockFindOneUser.mockResolvedValue(userDoc);

    const charDoc = {
      _id: new ObjectId(),
      userId: userDoc._id,
      countryId: "US",
      name: "Test",
      homeState: "CA",
      politicalInfluence: 0,
      favorability: 0,
      infamy: 0,
      funds: 0,
      actions: 3,
      donorBaseLevel: 0,
      policies: { economic: 0, social: 0 },
      party: "DEM",
      currentOffice: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies Character;
    mockFindOneCharacter.mockResolvedValue(charDoc);
  });

  it("calls getDb once while loading user and character", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const { getAuthUserWithCharacter } = await import("./auth");
    const user = await getAuthUserWithCharacter();

    expect(vi.mocked(getDb)).toHaveBeenCalledTimes(1);
    expect(user?.hasCharacter).toBe(true);
    expect(user?.character?.name).toBe("Test");
  });
});
