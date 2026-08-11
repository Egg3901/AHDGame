import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { User, Character } from "@/lib/db/types";

// Mock dependencies
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
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
  forbidden: vi.fn(() => ({
    toJson: () => ({ error: "Forbidden" }),
  })),
}));

describe("requireAdmin", () => {
  let mockCookies: ReturnType<typeof vi.fn>;
  let mockJwtVerify: ReturnType<typeof vi.fn>;
  let _mockGetDb: ReturnType<typeof vi.fn>;
  let mockGetUsersCollection: ReturnType<typeof vi.fn>;
  let mockGetCharactersCollection: ReturnType<typeof vi.fn>;

  const mockNonAdminUser: User = {
    _id: "507f1f77bcf86cd799439011" as any,
    email: "user@example.com",
    username: "regularuser",
    displayName: "Regular User",
    password: "hashed_password",
    role: "player",
    isAdmin: false,
    hasCompletedSetup: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockAdminUser: User = {
    _id: "507f1f77bcf86cd799439022" as any,
    email: "admin@example.com",
    username: "adminuser",
    displayName: "Admin User",
    password: "hashed_password",
    role: "admin",
    isAdmin: true,
    hasCompletedSetup: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCharacter: Character = {
    _id: "507f1f77bcf86cd799439033" as any,
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

  describe("requireAdmin", () => {
    it("returns 403 when no auth token cookie", async () => {
      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue(undefined),
      } as any);

      const { requireAdmin } = await import("./requireAdmin");
      const result = await requireAdmin();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(403);
        const json = await result.response.json();
        expect(json.error).toBe("Forbidden");
      }
    });

    it("returns 403 when JWT verification fails", async () => {
      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "invalid-token" }),
      } as any);
      const { errors } = await import("jose");
      mockJwtVerify.mockRejectedValue(
        new (errors.JWSSignatureVerificationFailed as unknown as new () => Error)()
      );

      const { requireAdmin } = await import("./requireAdmin");
      const result = await requireAdmin();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(403);
      }
    });

    it("returns 403 when user not found in database", async () => {
      const validPayload = {
        userId: "507f1f77bcf86cd799439011",
        email: "user@example.com",
        username: "regularuser",
        role: "player",
        isAdmin: false,
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(null),
      } as any);

      const { requireAdmin } = await import("./requireAdmin");
      const result = await requireAdmin();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(403);
      }
    });

    it("returns 403 when user exists but is not an admin", async () => {
      const validPayload = {
        userId: "507f1f77bcf86cd799439011",
        email: "user@example.com",
        username: "regularuser",
        role: "player",
        isAdmin: false,
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(mockNonAdminUser),
      } as any);
      mockGetCharactersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(mockCharacter),
      } as any);

      const { requireAdmin } = await import("./requireAdmin");
      const result = await requireAdmin();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(403);
      }
    });

    it("returns 403 when user has isAdmin=false explicitly", async () => {
      const validPayload = {
        userId: "507f1f77bcf86cd799439011",
        email: "user@example.com",
        username: "regularuser",
        role: "player",
        isAdmin: false,
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(mockNonAdminUser),
      } as any);

      const { requireAdmin } = await import("./requireAdmin");
      const result = await requireAdmin();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(403);
      }
    });

    it("returns success with admin user when isAdmin=true", async () => {
      const validPayload = {
        userId: "507f1f77bcf86cd799439022",
        email: "admin@example.com",
        username: "adminuser",
        role: "admin",
        isAdmin: true,
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(mockAdminUser),
      } as any);
      mockGetCharactersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(mockCharacter),
      } as any);

      const { requireAdmin } = await import("./requireAdmin");
      const result = await requireAdmin();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.admin.userId).toBe(validPayload.userId);
        expect(result.admin.username).toBe(validPayload.username);
        expect(result.admin.isAdmin).toBe(true);
      }
    });

    it("returns success when user.role is 'admin' (legacy role check)", async () => {
      const legacyAdminUser = {
        ...mockAdminUser,
        isAdmin: false, // isAdmin not set
        role: "admin" as const, // but role is 'admin'
      };

      const validPayload = {
        userId: "507f1f77bcf86cd799439022",
        email: "legacyadmin@example.com",
        username: "legacyadmin",
        role: "admin",
        isAdmin: false,
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(legacyAdminUser),
      } as any);
      mockGetCharactersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(mockCharacter),
      } as any);

      const { requireAdmin } = await import("./requireAdmin");
      const result = await requireAdmin();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.admin.username).toBe("legacyadmin");
      }
    });

    it("provides full admin user data on success", async () => {
      const validPayload = {
        userId: "507f1f77bcf86cd799439022",
        email: "admin@example.com",
        username: "adminuser",
        role: "admin",
        isAdmin: true,
      };

      mockCookies.mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: "token" }),
      } as any);
      mockJwtVerify.mockResolvedValue({ payload: validPayload } as any);
      mockGetUsersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(mockAdminUser),
      } as any);
      mockGetCharactersCollection.mockResolvedValue({
        findOne: vi.fn().mockResolvedValue(mockCharacter),
      } as any);

      const { requireAdmin } = await import("./requireAdmin");
      const result = await requireAdmin();

      if (result.ok) {
        expect(result.admin.userId).toBe(validPayload.userId);
        expect(result.admin.email).toBe(validPayload.email);
        expect(result.admin.username).toBe(validPayload.username);
        expect(result.admin.role).toBe(validPayload.role);
        expect(result.admin.isAdmin).toBe(true);
        expect(result.admin.hasCharacter).toBe(true);
        if (result.admin.hasCharacter) {
          expect(result.admin.character).toEqual(mockCharacter);
        }
      }
    });
  });
});
