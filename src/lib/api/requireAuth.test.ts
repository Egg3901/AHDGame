import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Character, User } from "@/lib/db/types";

// Mock dependencies
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("jose", () => {
  // Minimal JOSEError stand-in so verifyAuth's `instanceof errors.JOSEError`
  // check correctly identifies the rejected value as a "token genuinely bad"
  // signal (vs a transient throw, which propagates as 5xx).
  class JOSEError extends Error {
    code = "ERR_JOSE_GENERIC";
  }
  class JWSSignatureVerificationFailed extends JOSEError {
    code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  }
  return {
    jwtVerify: vi.fn(),
    errors: { JOSEError, JWSSignatureVerificationFailed },
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

vi.mock("@/lib/api/errors", () => ({
  unauthorized: vi.fn((message?: string) => ({
    toJson: () => ({ error: message || "Authentication required" }),
  })),
  forbidden: vi.fn(() => ({
    toJson: () => ({ error: "Forbidden" }),
  })),
}));

describe("requireAuth guards", () => {
  let mockCookies: ReturnType<typeof vi.fn>;
  let mockJwtVerify: ReturnType<typeof vi.fn>;
  let _mockGetDb: ReturnType<typeof vi.fn>;
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
    homeState: "US_CA",
    countryId: "US",
    politicalInfluence: 0,
    favorability: 50,
    infamy: 0,
    donorBaseLevel: 100,
    policies: { economic: 0, social: 0 },
    party: "DEM",
    currentOffice: null,
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
    _mockGetDb = vi.mocked(getDb);
    mockGetUsersCollection = vi.mocked(getUsersCollection);
    mockGetCharactersCollection = vi.mocked(getCharactersCollection);

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe("requireAuth", () => {
    it("returns 401 when no auth token cookie", async () => {
      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue(undefined),
      } as any);

      const { requireAuth } = await import("./requireAuth");
      const result = await requireAuth();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(401);
        const json = await result.response.json();
        expect(json.error).toBe("Authentication required");
      }
    });

    it("returns 401 when JWT verification fails", async () => {
      const cookieStore = {
        get: vi.fn().mockReturnValue({ value: "invalid-token" }),
        set: vi.fn(),
      };
      mockCookies.mockResolvedValue(cookieStore as any);
      const { errors } = await import("jose");
      mockJwtVerify.mockRejectedValue(
        new (errors.JWSSignatureVerificationFailed as unknown as new () => Error)()
      );

      const { requireAuth } = await import("./requireAuth");
      const result = await requireAuth();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(401);
      }
      expect(cookieStore.set).toHaveBeenCalled();
    });

    it("returns 401 when user not found in database", async () => {
      const validPayload = {
        userId: "507f1f77bcf86cd799439011",
        email: "test@example.com",
        username: "testuser",
        role: "user",
        isAdmin: false,
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(null),
      } as any);

      const { requireAuth } = await import("./requireAuth");
      const result = await requireAuth();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(401);
      }
    });

    it("returns success with user when authenticated (no character)", async () => {
      const validPayload = {
        userId: "507f1f77bcf86cd799439011",
        email: "test@example.com",
        username: "testuser",
        role: "user",
        isAdmin: false,
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(mockUser),
      } as any);
      mockGetCharactersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(null),
      } as any);

      const { requireAuth } = await import("./requireAuth");
      const result = await requireAuth();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.user.userId).toBe(validPayload.userId);
        expect(result.user.username).toBe(validPayload.username);
        expect(result.user.hasCharacter).toBe(false);
      }
    });

    it("returns success with user and character when both exist", async () => {
      const validPayload = {
        userId: "507f1f77bcf86cd799439011",
        email: "test@example.com",
        username: "testuser",
        role: "user",
        isAdmin: false,
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(mockUser),
      } as any);
      mockGetCharactersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(mockCharacter),
      } as any);

      const { requireAuth } = await import("./requireAuth");
      const result = await requireAuth();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.user.userId).toBe(validPayload.userId);
        expect(result.user.hasCharacter).toBe(true);
        if (result.user.hasCharacter) {
          expect(result.user.character).toEqual(mockCharacter);
        }
      }
    });

    it("returns success with isAdmin=true for admin users", async () => {
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
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(adminUser),
      } as any);

      const { requireAuth } = await import("./requireAuth");
      const result = await requireAuth();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.user.isAdmin).toBe(true);
      }
    });

    it("returns 401 and clears the cookie when the user is banned", async () => {
      const bannedUser = { ...mockUser, isBanned: true, banReason: "Violation of rules" };
      const validPayload = {
        userId: "507f1f77bcf86cd799439011",
        email: "test@example.com",
        username: "testuser",
        role: "user",
        iat: Math.floor(Date.now() / 1000),
      };
      const cookieStore = {
        get: vi.fn().mockReturnValue({ value: "token" }),
        set: vi.fn(),
      };

      mockCookies.mockResolvedValue(cookieStore as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(bannedUser),
      } as any);

      const { requireBasicAuth } = await import("./requireAuth");
      const result = await requireBasicAuth();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(401);
      }
      expect(cookieStore.set).toHaveBeenCalled();
    });
  });

  describe("requireBasicAuth", () => {
    it("returns 401 when no auth token cookie", async () => {
      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue(undefined),
      } as any);

      const { requireBasicAuth } = await import("./requireAuth");
      const result = await requireBasicAuth();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(401);
      }
    });

    it("returns 401 when JWT verification fails", async () => {
      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "invalid-token" }),
      } as any);
      const { errors } = await import("jose");
      mockJwtVerify.mockRejectedValue(
        new (errors.JWSSignatureVerificationFailed as unknown as new () => Error)()
      );

      const { requireBasicAuth } = await import("./requireAuth");
      const result = await requireBasicAuth();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(401);
      }
    });

    it("returns success with user when authenticated (no character lookup)", async () => {
      const validPayload = {
        userId: "507f1f77bcf86cd799439011",
        email: "test@example.com",
        username: "testuser",
        role: "user",
        isAdmin: false,
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(mockUser),
      } as any);

      const { requireBasicAuth } = await import("./requireAuth");
      const result = await requireBasicAuth();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.user.userId).toBe(validPayload.userId);
        expect(result.user.username).toBe(validPayload.username);
        expect(result.user.email).toBe(validPayload.email);
      }
    });

    it("does not perform character lookup (faster path)", async () => {
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

      const { requireBasicAuth } = await import("./requireAuth");
      await requireBasicAuth();

      // Character collection should not be accessed
      expect(mockGetCharactersCollection).not.toHaveBeenCalled();
    });
  });

  describe("requireAuthWithCharacter", () => {
    it("returns 401 when no auth token cookie", async () => {
      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue(undefined),
      } as any);

      const { requireAuthWithCharacter } = await import("./requireAuth");
      const result = await requireAuthWithCharacter();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(401);
        const json = await result.response.json();
        expect(json.error).toBe("Authentication with character required");
      }
    });

    it("returns 401 when JWT verification fails", async () => {
      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "invalid-token" }),
      } as any);
      const { errors } = await import("jose");
      mockJwtVerify.mockRejectedValue(
        new (errors.JWSSignatureVerificationFailed as unknown as new () => Error)()
      );

      const { requireAuthWithCharacter } = await import("./requireAuth");
      const result = await requireAuthWithCharacter();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(401);
      }
    });

    it("returns 401 when user not found in database", async () => {
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

      const { requireAuthWithCharacter } = await import("./requireAuth");
      const result = await requireAuthWithCharacter();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(401);
      }
    });

    it("returns 401 when user exists but has no character", async () => {
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
      mockGetCharactersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(null),
      } as any);

      const { requireAuthWithCharacter } = await import("./requireAuth");
      const result = await requireAuthWithCharacter();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(401);
      }
    });

    it("returns success when user has character", async () => {
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
      mockGetCharactersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(mockCharacter),
      } as any);

      const { requireAuthWithCharacter } = await import("./requireAuth");
      const result = await requireAuthWithCharacter();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.user.userId).toBe(validPayload.userId);
        expect(result.user.hasCharacter).toBe(true);
        expect(result.user.character).toEqual(mockCharacter);
      }
    });

    it("provides typed access to character properties on success", async () => {
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
      mockGetCharactersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(mockCharacter),
      } as any);

      const { requireAuthWithCharacter } = await import("./requireAuth");
      const result = await requireAuthWithCharacter();

      if (result.ok) {
        // TypeScript should allow direct character access
        expect(result.user.character.name).toBe("Test Character");
        expect(result.user.character.funds).toBe(10000);
        expect(result.user.character.homeState).toBe("US_CA");
      }
    });
  });
});
