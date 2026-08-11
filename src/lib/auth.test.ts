import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { User, Character } from "@/lib/db/types";

// Mock dependencies
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("jose", () => {
  // Minimal JOSEError hierarchy stand-in so verifyAuth's
  // `err instanceof errors.JOSEError` check works inside the mock environment.
  class JOSEError extends Error {
    code = "ERR_JOSE_GENERIC";
  }
  class JWSSignatureVerificationFailed extends JOSEError {
    code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  }
  class JWTExpired extends JOSEError {
    code = "ERR_JWT_EXPIRED";
  }
  return {
    jwtVerify: vi.fn(),
    errors: { JOSEError, JWSSignatureVerificationFailed, JWTExpired },
  };
});

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/db/collections", () => ({
  getUsersCollection: vi.fn(),
  getCharactersCollection: vi.fn(),
}));

vi.mock("@/lib/env", () => ({}));

describe("auth", () => {
  let mockCookies: ReturnType<typeof vi.fn>;
  let mockJwtVerify: ReturnType<typeof vi.fn>;
  let mockGetDb: ReturnType<typeof vi.fn>;
  let mockGetUsersCollection: ReturnType<typeof vi.fn>;
  let mockGetCharactersCollection: ReturnType<typeof vi.fn>;

  const mockUser: User = {
    _id: "507f1f77bcf86cd799439011" as any,
    email: "test@example.com",
    username: "testuser",
    displayName: "Test User",
    password: "hashed_password",
    role: "player",
    isAdmin: false,
    hasCompletedSetup: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCharacter: Character = {
    _id: "507f1f77bcf86cd799439022" as any,
    userId: "507f1f77bcf86cd799439011" as any,
    name: "Test Character",
    funds: 10000,
    actions: 10,
    stateId: "US_CA",
    countryId: "US",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;

  beforeEach(async () => {
    const { cookies } = await import("next/headers");
    const { jwtVerify } = await import("jose");
    const { getDb } = await import("@/lib/mongodb");
    const { getUsersCollection, getCharactersCollection } = await import("@/lib/db/collections");

    mockCookies = vi.mocked(cookies);
    mockJwtVerify = vi.mocked(jwtVerify);
    mockGetDb = vi.mocked(getDb);
    mockGetUsersCollection = vi.mocked(getUsersCollection);
    mockGetCharactersCollection = vi.mocked(getCharactersCollection);

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe("verifyAuth", () => {
    it("returns null when no auth token cookie", async () => {
      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue(undefined),
      } as any);

      const { verifyAuth } = await import("./auth");
      const result = await verifyAuth();

      expect(result).toBeNull();
    });

    it("returns null when JWT verification fails with a JOSE error (token genuinely bad)", async () => {
      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "invalid-token" }),
      } as any);
      const { errors } = await import("jose");
      mockJwtVerify.mockRejectedValue(
        new (errors.JWSSignatureVerificationFailed as unknown as new () => Error)()
      );

      const { verifyAuth } = await import("./auth");
      const result = await verifyAuth();

      expect(result).toBeNull();
    });

    it("THROWS on non-JOSE errors so transient failures don't log users out", async () => {
      // Regression guard for the auth-logout investigation: previously the bare
      // try/catch in verifyAuth swallowed every error and returned null, so any
      // transient throw (env validation hiccup, unexpected SDK error, etc.)
      // looked identical to a known-bad token and the caller would clear the
      // user's auth cookie. Now non-JOSE errors propagate so the route's outer
      // try/catch returns 5xx instead and the cookie survives.
      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "any-token" }),
      } as any);
      mockJwtVerify.mockRejectedValue(new Error("env validation failed: AUTH_SECRET missing"));

      const { verifyAuth } = await import("./auth");

      await expect(verifyAuth()).rejects.toThrow(/env validation failed/);
    });

    it("returns null when JWT payload fails schema validation", async () => {
      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({
        payload: { userId: 123 }, // Invalid - userId should be string
      } as any);

      const { verifyAuth } = await import("./auth");
      const result = await verifyAuth();

      expect(result).toBeNull();
    });

    it("returns parsed payload when JWT is valid", async () => {
      const validPayload = {
        userId: "507f1f77bcf86cd799439011",
        email: "test@example.com",
        username: "testuser",
        role: "user",
        isAdmin: false,
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "valid-token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);

      const { verifyAuth } = await import("./auth");
      const result = await verifyAuth();

      expect(result).toEqual(validPayload);
    });
  });

  describe("getAuthUser", () => {
    it("returns null when verifyAuth returns null", async () => {
      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue(undefined),
      } as any);

      const { getAuthUser } = await import("./auth");
      const result = await getAuthUser();

      expect(result).toBeNull();
    });

    it("returns null when user not found in database", async () => {
      const validPayload = {
        userId: "507f1f77bcf86cd799439011",
        email: "test@example.com",
        username: "testuser",
        role: "user",
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(null),
      } as any);

      const { getAuthUser } = await import("./auth");
      const result = await getAuthUser();

      expect(result).toBeNull();
    });

    it("returns AuthUser when user exists in database", async () => {
      const validPayload = {
        userId: "507f1f77bcf86cd799439011",
        email: "test@example.com",
        username: "testuser",
        role: "user",
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(mockUser),
      } as any);

      const { getAuthUser } = await import("./auth");
      const result = await getAuthUser();

      expect(result).toEqual({
        userId: validPayload.userId,
        username: validPayload.username,
        email: validPayload.email,
        role: validPayload.role,
        isAdmin: false,
        isModerator: false,
        isBanned: false,
        activeCharacterId: null,
      });
    });

    it("sets isAdmin from user.isAdmin field", async () => {
      const adminUser = { ...mockUser, isAdmin: true };
      const validPayload = {
        userId: "507f1f77bcf86cd799439011",
        email: "admin@example.com",
        username: "adminuser",
        role: "user",
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(adminUser),
      } as any);

      const { getAuthUser } = await import("./auth");
      const result = await getAuthUser();

      expect(result?.isAdmin).toBe(true);
    });

    it("sets isAdmin from user.role field", async () => {
      const adminUser = { ...mockUser, role: "admin" };
      const validPayload = {
        userId: "507f1f77bcf86cd799439011",
        email: "admin@example.com",
        username: "adminuser",
        role: "user",
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(adminUser),
      } as any);

      const { getAuthUser } = await import("./auth");
      const result = await getAuthUser();

      expect(result?.isAdmin).toBe(true);
    });

    it("returns null when the user is banned", async () => {
      const bannedUser = { ...mockUser, isBanned: true, banReason: "Violation of rules" };
      const validPayload = {
        userId: "507f1f77bcf86cd799439011",
        email: "test@example.com",
        username: "testuser",
        role: "user",
        iat: Math.floor(Date.now() / 1000),
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(bannedUser),
      } as any);

      const { getAuthUser } = await import("./auth");
      const result = await getAuthUser();

      expect(result).toBeNull();
    });

    it("returns null when the token was revoked after issuance", async () => {
      const revokedUser = {
        ...mockUser,
        authRevokedAt: new Date("2026-04-25T12:00:00.000Z"),
      };
      const validPayload = {
        userId: "507f1f77bcf86cd799439011",
        email: "test@example.com",
        username: "testuser",
        role: "user",
        iat: Math.floor(new Date("2026-04-25T11:59:59.000Z").getTime() / 1000),
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(revokedUser),
      } as any);

      const { getAuthUser } = await import("./auth");
      const result = await getAuthUser();

      expect(result).toBeNull();
    });
  });

  describe("getAuthUserWithCharacter", () => {
    it("returns null when verifyAuth returns null", async () => {
      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue(undefined),
      } as any);

      const { getAuthUserWithCharacter } = await import("./auth");
      const result = await getAuthUserWithCharacter();

      expect(result).toBeNull();
    });

    it("returns null when user not found in database", async () => {
      const validPayload = {
        userId: "507f1f77bcf86cd799439011",
        email: "test@example.com",
        username: "testuser",
        role: "user",
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetDb.mockResolvedValue({} as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(null),
      } as any);

      const { getAuthUserWithCharacter } = await import("./auth");
      const result = await getAuthUserWithCharacter();

      expect(result).toBeNull();
    });

    it("returns user with hasCharacter=false when no character exists", async () => {
      const validPayload = {
        userId: "507f1f77bcf86cd799439011",
        email: "test@example.com",
        username: "testuser",
        role: "user",
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetDb.mockResolvedValue({} as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(mockUser),
      } as any);
      mockGetCharactersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(null),
      } as any);

      const { getAuthUserWithCharacter } = await import("./auth");
      const result = await getAuthUserWithCharacter();

      expect(result).toEqual({
        userId: validPayload.userId,
        username: validPayload.username,
        email: validPayload.email,
        role: validPayload.role,
        isAdmin: false,
        isModerator: false,
        isBanned: false,
        activeCharacterId: null,
        hasCharacter: false,
        character: undefined,
      });
    });

    it("returns user with character when character exists", async () => {
      const validPayload = {
        userId: "507f1f77bcf86cd799439011",
        email: "test@example.com",
        username: "testuser",
        role: "user",
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetDb.mockResolvedValue({} as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(mockUser),
      } as any);
      mockGetCharactersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(mockCharacter),
      } as any);

      const { getAuthUserWithCharacter } = await import("./auth");
      const result = await getAuthUserWithCharacter();

      expect(result).toEqual({
        userId: validPayload.userId,
        username: validPayload.username,
        email: validPayload.email,
        role: validPayload.role,
        isAdmin: false,
        isModerator: false,
        isBanned: false,
        activeCharacterId: null,
        hasCharacter: true,
        character: mockCharacter,
      });
    });

    it("returns null when the user is banned", async () => {
      const bannedUser = { ...mockUser, isBanned: true, banReason: "Violation of rules" };
      const validPayload = {
        userId: "507f1f77bcf86cd799439011",
        email: "test@example.com",
        username: "testuser",
        role: "user",
        iat: Math.floor(Date.now() / 1000),
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetDb.mockResolvedValue({} as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(bannedUser),
      } as any);

      const { getAuthUserWithCharacter } = await import("./auth");
      const result = await getAuthUserWithCharacter();

      expect(result).toBeNull();
    });

    it("returns null when the token was revoked after issuance", async () => {
      const revokedUser = {
        ...mockUser,
        authRevokedAt: new Date("2026-04-25T12:00:00.000Z"),
      };
      const validPayload = {
        userId: "507f1f77bcf86cd799439011",
        email: "test@example.com",
        username: "testuser",
        role: "user",
        iat: Math.floor(new Date("2026-04-25T11:59:59.000Z").getTime() / 1000),
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetDb.mockResolvedValue({} as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(revokedUser),
      } as any);

      const { getAuthUserWithCharacter } = await import("./auth");
      const result = await getAuthUserWithCharacter();

      expect(result).toBeNull();
    });
  });

  describe("getAuthAdmin", () => {
    it("returns null when user is not admin", async () => {
      const validPayload = {
        userId: "507f1f77bcf86cd799439011",
        email: "test@example.com",
        username: "testuser",
        role: "user",
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetDb.mockResolvedValue({} as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(mockUser),
      } as any);
      mockGetCharactersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(mockCharacter),
      } as any);

      const { getAuthAdmin } = await import("./auth");
      const result = await getAuthAdmin();

      expect(result).toBeNull();
    });

    it("returns admin user when user is admin", async () => {
      const adminUser = { ...mockUser, isAdmin: true };
      const validPayload = {
        userId: "507f1f77bcf86cd799439011",
        email: "admin@example.com",
        username: "adminuser",
        role: "user",
        isAdmin: true,
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetDb.mockResolvedValue({} as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(adminUser),
      } as any);
      mockGetCharactersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(mockCharacter),
      } as any);

      const { getAuthAdmin } = await import("./auth");
      const result = await getAuthAdmin();

      expect(result?.isAdmin).toBe(true);
    });
  });
});
