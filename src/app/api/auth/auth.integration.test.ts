/**
 * Integration tests for auth API routes.
 * Tests validation, error responses, and success paths with mocked DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AUTH_COOKIE_NAME } from "@/lib/authCookieName";

// Mock dependencies before importing route handlers
vi.mock("@/lib/utils/network", () => ({
  getClientIp: vi.fn().mockResolvedValue("127.0.0.1"),
}));

vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi
    .fn()
    .mockReturnValue({ ok: true, limit: 100, remaining: 99, resetAt: Date.now() + 60_000 }),
  AUTH_LIMITS: { maxRequests: 10, windowMs: 60000 },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(null),
    set: vi.fn(),
  }),
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(null),
  }),
}));

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn().mockResolvedValue({
    collection: vi.fn().mockReturnValue({
      findOne: vi.fn().mockResolvedValue(null),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: "507f1f77bcf86cd799439011" }),
    }),
  }),
}));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    jwtVerify: vi.fn().mockResolvedValue({
      payload: {
        userId: "507f1f77bcf86cd799439011",
        email: "test@example.com",
        username: "testuser",
        role: "player",
        isAdmin: false,
        iat: Math.floor(Date.now() / 1000),
      },
      protectedHeader: {},
    }),
  };
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const rateLimit = await import("@/lib/api/rateLimit");
    vi.mocked(rateLimit.checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });
  });

  it("returns 400 for invalid JSON body", async () => {
    const { POST } = await import("./login/route");
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid JSON body");
  });

  it("returns 400 for missing email", async () => {
    const { POST } = await import("./login/route");
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: "testpass123" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("email");
  });

  it("returns 400 for missing password", async () => {
    const { POST } = await import("./login/route");
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "test@example.com" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  it("returns 401 when user not found", async () => {
    // getDb mock already returns findOne: null by default
    const { POST } = await import("./login/route");
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "nonexistent@example.com", password: "password123" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Invalid credentials");
  });

  it("returns 403 with banned details for banned users", async () => {
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue({
          _id: "507f1f77bcf86cd799439011",
          email: "banned@example.com",
          username: "banneduser",
          password: "$2b$10$abcdefghijklmnopqrstuv0123456789abcdefghiJKLmnopqrs",
          isBanned: true,
          banReason: "Rules violation",
        }),
      }),
    } as never);

    const { POST } = await import("./login/route");
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "banned@example.com", password: "password123" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("banned");
    expect(json.reason).toBe("Rules violation");
  });
});

describe("POST /api/auth/register", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const rateLimit = await import("@/lib/api/rateLimit");
    vi.mocked(rateLimit.checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });
  });

  it("returns 400 for invalid JSON body", async () => {
    const { POST } = await import("./register/route");
    const req = new Request("http://localhost/api/auth/register", {
      method: "POST",
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid JSON body");
  });

  it("returns 400 for invalid email", async () => {
    const { POST } = await import("./register/route");
    const req = new Request("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "not-an-email",
        username: "validuser",
        password: "password123",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("email");
  });

  it("returns 400 for short password", async () => {
    const { POST } = await import("./register/route");
    const req = new Request("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "test@example.com",
        username: "validuser",
        password: "short",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("8");
  });

  it("returns 400 for invalid username", async () => {
    const { POST } = await import("./register/route");
    const req = new Request("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: "test@example.com",
        username: "ab", // too short
        password: "password123",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("username");
  });
});

describe("POST /api/auth/change-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no auth cookie", async () => {
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
    } as never);

    const { POST } = await import("./change-password/route");
    const req = new Request("http://localhost/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: "old", newPassword: "newpass123" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Authentication required");
  });

  it("returns 400 for invalid body when authenticated", async () => {
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "valid.jwt.token" }),
      set: vi.fn(),
    } as never);

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "users") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: "507f1f77bcf86cd799439011",
              email: "test@example.com",
              username: "testuser",
              role: "player",
              isAdmin: false,
              isBanned: false,
            }),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
          updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
          insertOne: vi.fn().mockResolvedValue({ insertedId: "507f1f77bcf86cd799439011" }),
        };
      }),
    } as never);

    // jwtVerify is mocked to succeed; parseJsonBody fails on short password
    const { POST } = await import("./change-password/route");
    const req = new Request("http://localhost/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: "currentpass123", newPassword: "short" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("6");
  });

  it("returns 401 and clears the cookie for banned users", async () => {
    const cookieStore = {
      get: vi.fn().mockReturnValue({ value: "valid.jwt.token" }),
      set: vi.fn(),
    };
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue(cookieStore as never);

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "users") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: "507f1f77bcf86cd799439011",
              email: "banned@example.com",
              username: "banneduser",
              isBanned: true,
            }),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
        };
      }),
    } as never);

    const { POST } = await import("./change-password/route");
    const req = new Request("http://localhost/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: "oldpassword123", newPassword: "newpass123" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(cookieStore.set).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      "",
      expect.objectContaining({ maxAge: 0 })
    );
  });
});

describe("POST /api/auth/set-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 and clears the cookie for banned users", async () => {
    const cookieStore = {
      get: vi.fn().mockReturnValue({ value: "valid.jwt.token" }),
      set: vi.fn(),
    };
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue(cookieStore as never);

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "users") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: "507f1f77bcf86cd799439011",
              email: "banned@example.com",
              username: "banneduser",
              isBanned: true,
            }),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
        };
      }),
    } as never);

    const { POST } = await import("./set-password/route");
    const req = new Request("http://localhost/api/auth/set-password", {
      method: "POST",
      body: JSON.stringify({ newPassword: "newpass123" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(cookieStore.set).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      "",
      expect.objectContaining({ maxAge: 0 })
    );
  });
});

describe("DELETE /api/auth/delete-account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 and clears the cookie for banned users", async () => {
    const cookieStore = {
      get: vi.fn().mockReturnValue({ value: "valid.jwt.token" }),
      set: vi.fn(),
    };
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue(cookieStore as never);

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "users") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: "507f1f77bcf86cd799439011",
              email: "banned@example.com",
              username: "banneduser",
              isBanned: true,
            }),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
        };
      }),
    } as never);

    const { DELETE } = await import("./delete-account/route");
    const res = await DELETE();

    expect(res.status).toBe(401);
    expect(cookieStore.set).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      "",
      expect.objectContaining({ maxAge: 0 })
    );
  });
});

describe("GET /api/auth/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 and clears the cookie for banned users", async () => {
    const cookieStore = {
      get: vi.fn().mockReturnValue({ value: "valid.jwt.token" }),
      set: vi.fn(),
    };
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue(cookieStore as never);

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "users") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: "507f1f77bcf86cd799439011",
              email: "banned@example.com",
              username: "banneduser",
              isBanned: true,
              banReason: "Rules violation",
            }),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
          countDocuments: vi.fn().mockResolvedValue(0),
        };
      }),
    } as never);

    const { GET } = await import("./me/route");
    const res = await GET();

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("banned");
    expect(json.reason).toBe("Rules violation");
    expect(cookieStore.set).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      "",
      expect.objectContaining({ maxAge: 0 })
    );
  });
});
