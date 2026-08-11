import { describe, it, expect, vi, afterEach } from "vitest";
import { requireAdminOrApiKey } from "./requireAdminOrApiKey";
import { getAuthAdmin } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({
  getAuthAdmin: vi.fn(),
}));

describe("requireAdminOrApiKey", () => {
  const originalApiKey = process.env.INTERNAL_API_KEY;

  afterEach(() => {
    if (originalApiKey) {
      process.env.INTERNAL_API_KEY = originalApiKey;
    } else {
      delete process.env.INTERNAL_API_KEY;
    }
    vi.clearAllMocks();
  });

  describe("API key authentication", () => {
    it("returns ok with via=apiKey when x-api-key header matches", async () => {
      process.env.INTERNAL_API_KEY = "test-api-key-123";
      const mockRequest = {
        headers: {
          get: vi.fn().mockReturnValue("test-api-key-123"),
        },
      } as unknown as Request;

      const result = await requireAdminOrApiKey(mockRequest);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.via).toBe("apiKey");
        expect(result.admin).toBeNull();
      }
    });

    it("returns 401 when x-api-key header does not match", async () => {
      process.env.INTERNAL_API_KEY = "test-api-key-123";
      const mockRequest = {
        headers: {
          get: vi.fn().mockReturnValue("wrong-key"),
        },
      } as unknown as Request;

      const result = await requireAdminOrApiKey(mockRequest);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(401);
      }
    });

    it("returns 500 when INTERNAL_API_KEY is not configured", async () => {
      delete process.env.INTERNAL_API_KEY;
      const mockRequest = {
        headers: {
          get: vi.fn().mockReturnValue("any-key"),
        },
      } as unknown as Request;

      const result = await requireAdminOrApiKey(mockRequest);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(500);
        const json = await result.response.json();
        expect(json.error).toBe("INTERNAL_API_KEY not configured");
      }
    });
  });

  describe("session authentication fallback", () => {
    it("returns ok with via=session and admin user when session is valid", async () => {
      delete process.env.INTERNAL_API_KEY;
      const mockAdmin: any = {
        userId: "admin-123",
        username: "admin",
        email: "admin@example.com",
        role: "admin",
        isAdmin: true,
        hasCharacter: true,
        character: { id: "char-1", name: "Test Character" },
      };
      vi.mocked(getAuthAdmin).mockResolvedValue(mockAdmin);

      const mockRequest = {
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      } as unknown as Request;

      const result = await requireAdminOrApiKey(mockRequest);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.via).toBe("session");
        expect(result.admin).toEqual(mockAdmin);
      }
    });

    it("returns 403 when session is invalid", async () => {
      delete process.env.INTERNAL_API_KEY;
      vi.mocked(getAuthAdmin).mockResolvedValue(null);

      const mockRequest = {
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      } as unknown as Request;

      const result = await requireAdminOrApiKey(mockRequest);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(403);
      }
    });
  });

  describe("auth priority", () => {
    it("checks API key before session (fast path)", async () => {
      process.env.INTERNAL_API_KEY = "test-key";
      const mockAdmin = {
        userId: "admin-123",
        username: "admin",
        email: "admin@example.com",
        role: "admin",
        isAdmin: true,
        hasCharacter: false,
      };
      vi.mocked(getAuthAdmin).mockResolvedValue(mockAdmin);

      const mockRequest = {
        headers: {
          get: vi.fn().mockReturnValue("test-key"),
        },
      } as unknown as Request;

      const result = await requireAdminOrApiKey(mockRequest);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.via).toBe("apiKey");
        expect(result.admin).toBeNull();
      }
      // Session should not have been checked since API key matched
      expect(getAuthAdmin).not.toHaveBeenCalled();
    });
  });
});
