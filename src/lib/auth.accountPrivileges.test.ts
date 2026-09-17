/**
 * Current-account privilege hardening: the DB account record is the sole
 * grant authority for role/isAdmin/isModerator. Verified JWT claims are
 * identity only, so a correctly signed token minted before a demotion must
 * never re-grant staff access, and a stale player-claim token must never
 * mask a promotion.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { User } from "@/lib/db/types";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("jose", () => {
  class JOSEError extends Error {
    code = "ERR_JOSE_GENERIC";
  }
  return {
    jwtVerify: vi.fn(),
    errors: { JOSEError },
  };
});

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/db/collections", () => ({
  getUsersCollection: vi.fn(),
  getCharactersCollection: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  getValidatedEnv: vi.fn(() => ({ AUTH_SECRET: "test-secret" })),
}));

const USER_ID = "507f1f77bcf86cd799439011";

function dbUser(overrides: Partial<User> = {}): User {
  return {
    _id: USER_ID as unknown as User["_id"],
    email: "player@example.com",
    username: "player",
    displayName: "Player",
    password: "hashed",
    role: "player",
    hasCompletedSetup: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User;
}

function claims(overrides: Record<string, unknown> = {}) {
  return {
    userId: USER_ID,
    email: "player@example.com",
    username: "player",
    role: "player",
    ...overrides,
  };
}

describe("current-account privilege authority", () => {
  let mockJwtVerify: ReturnType<typeof vi.fn>;
  let mockFindOne: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { jwtVerify } = await import("jose");
    const { getUsersCollection } = await import("@/lib/db/collections");
    mockJwtVerify = vi.mocked(jwtVerify);
    mockFindOne = vi.fn();
    vi.mocked(getUsersCollection).mockResolvedValue({ findOne: mockFindOne } as never);
    vi.clearAllMocks();
    // clearAllMocks wipes the implementation above; restore it.
    vi.mocked(getUsersCollection).mockResolvedValue({ findOne: mockFindOne } as never);
  });

  afterEach(() => {
    vi.resetModules();
  });

  async function resolveAs(payload: Record<string, unknown>, user: User | null) {
    mockJwtVerify.mockResolvedValue({ payload } as never);
    mockFindOne.mockResolvedValue(user);
    const { getAuthUserFromToken } = await import("./auth");
    return getAuthUserFromToken("signed-token");
  }

  it("denies staff to a signed old admin claim after demotion", async () => {
    const result = await resolveAs(
      claims({ role: "admin", isAdmin: true }),
      dbUser({ role: "player", isAdmin: false })
    );

    expect(result).not.toBeNull();
    expect(result?.isAdmin).toBe(false);
    expect(result?.isModerator).toBe(false);
    expect(result?.role).toBe("player");
    expect(result?.userId).toBe(USER_ID);
  });

  it("denies staff to a stale JWT role=admin claim without isAdmin", async () => {
    const result = await resolveAs(claims({ role: "admin" }), dbUser());

    expect(result?.isAdmin).toBe(false);
    expect(result?.isModerator).toBe(false);
    expect(result?.role).toBe("player");
  });

  it("denies moderator to a stale JWT role=moderator claim", async () => {
    const result = await resolveAs(claims({ role: "moderator" }), dbUser());

    expect(result?.isAdmin).toBe(false);
    expect(result?.isModerator).toBe(false);
    expect(result?.role).toBe("player");
  });

  it("promotes a current moderator holding old player claims", async () => {
    const result = await resolveAs(claims(), dbUser({ role: "moderator" }));

    expect(result?.isAdmin).toBe(false);
    expect(result?.isModerator).toBe(true);
    expect(result?.role).toBe("moderator");
  });

  it("promotes a current admin holding old player claims", async () => {
    const result = await resolveAs(claims(), dbUser({ role: "admin", isAdmin: true }));

    expect(result?.isAdmin).toBe(true);
    expect(result?.isModerator).toBe(true);
    expect(result?.role).toBe("admin");
  });

  it("denies a deleted account during the fresh check", async () => {
    const result = await resolveAs(claims({ role: "admin", isAdmin: true }), null);

    expect(result).toBeNull();
  });

  it("denies a banned account during the fresh check", async () => {
    const result = await resolveAs(
      claims(),
      dbUser({ isBanned: true, banReason: "Violation of rules" })
    );

    expect(result).toBeNull();
  });

  it("denies a token revoked during the fresh check", async () => {
    const result = await resolveAs(
      claims({
        iat: Math.floor(new Date("2026-04-25T11:59:59.000Z").getTime() / 1000),
      }),
      dbUser({ authRevokedAt: new Date("2026-04-25T12:00:00.000Z") })
    );

    expect(result).toBeNull();
  });

  it("fails closed without granting when the account read fails", async () => {
    mockJwtVerify.mockResolvedValue({ payload: claims() } as never);
    mockFindOne.mockRejectedValue(new Error("db unavailable"));
    const { getAuthUserFromToken } = await import("./auth");

    await expect(getAuthUserFromToken("signed-token")).rejects.toThrow("db unavailable");
  });

  it("verifyAuthToken stays JWT-only and touches no DB state", async () => {
    const payload = claims({ role: "admin", isAdmin: true });
    mockJwtVerify.mockResolvedValue({ payload } as never);
    const { getDb } = await import("@/lib/mongodb");
    const { getUsersCollection } = await import("@/lib/db/collections");
    const { verifyAuthToken } = await import("./auth");

    const result = await verifyAuthToken("signed-token");

    expect(result).toEqual(payload);
    expect(vi.mocked(getDb)).not.toHaveBeenCalled();
    expect(vi.mocked(getUsersCollection)).not.toHaveBeenCalled();
    expect(mockFindOne).not.toHaveBeenCalled();
  });
});

describe("staff cache bypass (process cache enabled)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadWithCache() {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const jose = await import("jose");
    const collections = await import("@/lib/db/collections");
    const cache = await import("@/lib/auth/userDocCache");
    const auth = await import("@/lib/auth");
    const findOne = vi.fn();
    vi.mocked(collections.getUsersCollection).mockResolvedValue({ findOne } as never);
    return { auth, cache, findOne, jwtVerify: vi.mocked(jose.jwtVerify) };
  }

  it("re-reads a stale cached staff record and denies after demotion", async () => {
    const { auth, cache, findOne, jwtVerify } = await loadWithCache();
    cache.setCachedUser(USER_ID, dbUser({ role: "admin", isAdmin: true }));
    // Fresh account no longer holds staff.
    findOne.mockResolvedValue(dbUser({ role: "player", isAdmin: false }));
    // Even player-claim tokens must not be served the stale cached grant.
    jwtVerify.mockResolvedValue({ payload: claims() } as never);

    const result = await auth.getAuthUserFromToken("signed-token");

    expect(findOne).toHaveBeenCalledTimes(1);
    expect(result?.isAdmin).toBe(false);
    expect(result?.isModerator).toBe(false);
    expect(result?.role).toBe("player");
  });

  it("keeps the cached fast path for ordinary players", async () => {
    const { auth, cache, findOne, jwtVerify } = await loadWithCache();
    cache.setCachedUser(USER_ID, dbUser());
    findOne.mockResolvedValue(dbUser({ role: "admin", isAdmin: true }));
    jwtVerify.mockResolvedValue({ payload: claims() } as never);

    const result = await auth.getAuthUserFromToken("signed-token");

    expect(findOne).not.toHaveBeenCalled();
    expect(result?.isAdmin).toBe(false);
    expect(result?.role).toBe("player");
  });

  it("re-reads on a staff-claim token even with an empty cache", async () => {
    const { auth, findOne, jwtVerify } = await loadWithCache();
    findOne.mockResolvedValue(dbUser());
    jwtVerify.mockResolvedValue({ payload: claims({ role: "admin", isAdmin: true }) } as never);

    const result = await auth.getAuthUserFromToken("signed-token");

    expect(findOne).toHaveBeenCalledTimes(1);
    expect(result?.isAdmin).toBe(false);
    expect(result?.isModerator).toBe(false);
  });

  it("a staff-claim token against a still-staff account revalidates and grants", async () => {
    const { auth, findOne, jwtVerify } = await loadWithCache();
    const staff = dbUser({ role: "admin", isAdmin: true });
    findOne.mockResolvedValue(staff);
    jwtVerify.mockResolvedValue({ payload: claims({ role: "admin", isAdmin: true }) } as never);

    const result = await auth.getAuthUserFromToken("signed-token");

    expect(findOne).toHaveBeenCalledTimes(1);
    expect(result?.isAdmin).toBe(true);
    expect(result?.isModerator).toBe(true);
    expect(result?.role).toBe("admin");
  });
});
