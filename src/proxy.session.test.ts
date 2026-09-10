import { afterEach, describe, expect, it, vi } from "vitest";

const mockGetAuthUserFromToken = vi.hoisted(() => vi.fn());
const mockMaintenanceStatus = vi.hoisted(() =>
  vi.fn(async (): Promise<{ mode: "off" | "partial" | "full"; enabled: boolean }> => ({
    mode: "off",
    enabled: false,
  }))
);
const mockPublicViewingMode = vi.hoisted(() => vi.fn(async (): Promise<boolean> => true));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getAuthUserFromToken: mockGetAuthUserFromToken };
});

vi.mock("@/lib/maintenanceStatus", () => ({
  getCachedMaintenanceStatus: mockMaintenanceStatus,
  isMaintenanceBypassPath: () => false,
}));

vi.mock("@/lib/publicViewing", () => ({
  getCachedPublicViewingMode: mockPublicViewingMode,
  isPublicApiReadBypassPath: () => false,
}));

vi.mock("@/lib/auth/characterGate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/characterGate")>();
  return { ...actual, isCharacterGatedPath: () => false };
});

import { NextRequest } from "next/server";
import { proxy } from "./proxy";
import { AUTH_COOKIE_NAME } from "@/lib/authCookieName";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  mockMaintenanceStatus.mockResolvedValue({ mode: "off", enabled: false });
  mockPublicViewingMode.mockResolvedValue(true);
});

function makeRequest(
  urlStr: string,
  opts: { host?: string; cookies?: Record<string, string>; method?: string } = {}
): NextRequest {
  const headers = new Headers();
  if (opts.host) headers.set("host", opts.host);
  const req = new NextRequest(new URL(urlStr), {
    headers,
    method: opts.method ?? "GET",
  });
  for (const [k, v] of Object.entries(opts.cookies ?? {})) req.cookies.set(k, v);
  return req;
}

function adminUser() {
  return {
    userId: "507f1f77bcf86cd799439011",
    username: "staffer",
    email: "staff@example.com",
    role: "admin",
    isAdmin: true,
    isModerator: true,
  };
}

function playerUser() {
  return {
    userId: "507f1f77bcf86cd799439011",
    username: "player",
    email: "player@example.com",
    role: "player",
    isAdmin: false,
    isModerator: false,
  };
}

describe("proxy() current-account session validation", () => {
  it("denies maintenance bypass to a stale admin token after demotion", async () => {
    mockMaintenanceStatus.mockResolvedValueOnce({ mode: "full", enabled: true });
    mockGetAuthUserFromToken.mockResolvedValueOnce(playerUser());
    const res = await proxy(
      makeRequest("https://ahousedividedgame.com/dashboard", {
        host: "ahousedividedgame.com",
        cookies: { [AUTH_COOKIE_NAME]: "stale-admin-token" },
      })
    );
    expect(mockGetAuthUserFromToken).toHaveBeenCalledWith("stale-admin-token");
    expect(res.headers.get("location")).toContain("/maintenance");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("permits a current staff account through full maintenance", async () => {
    mockMaintenanceStatus.mockResolvedValueOnce({ mode: "full", enabled: true });
    mockGetAuthUserFromToken.mockResolvedValueOnce(adminUser());
    const res = await proxy(
      makeRequest("https://ahousedividedgame.com/dashboard", {
        host: "ahousedividedgame.com",
        cookies: { [AUTH_COOKIE_NAME]: "current-staff-token" },
      })
    );
    expect(res.headers.get("location")).toBeNull();
  });

  it("denies the API read gate to revoked or deleted sessions", async () => {
    mockPublicViewingMode.mockResolvedValueOnce(false);
    mockGetAuthUserFromToken.mockResolvedValueOnce(null);
    const res = await proxy(
      makeRequest("https://ahousedividedgame.com/api/mail", {
        host: "ahousedividedgame.com",
        cookies: { [AUTH_COOKIE_NAME]: "revoked-token" },
      })
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("fails closed with 503 and no cookie clear when the read-gate session lookup fails", async () => {
    mockPublicViewingMode.mockResolvedValueOnce(false);
    mockGetAuthUserFromToken.mockRejectedValueOnce(new Error("db down"));
    const res = await proxy(
      makeRequest("https://ahousedividedgame.com/api/mail", {
        host: "ahousedividedgame.com",
        cookies: { [AUTH_COOKIE_NAME]: "valid-token" },
      })
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("fails closed with 503 and no cookie clear when the maintenance session lookup fails", async () => {
    mockMaintenanceStatus.mockResolvedValueOnce({ mode: "full", enabled: true });
    mockGetAuthUserFromToken.mockRejectedValueOnce(new Error("db down"));
    const res = await proxy(
      makeRequest("https://ahousedividedgame.com/dashboard", {
        host: "ahousedividedgame.com",
        cookies: { [AUTH_COOKIE_NAME]: "valid-token" },
      })
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("still mints the offline singleplayer session without touching the account DB", async () => {
    vi.stubEnv("SINGLEPLAYER", "1");
    vi.stubEnv("AUTH_SECRET", "local-world-test-secret");
    vi.stubEnv("MONGODB_URI", "mongodb://127.0.0.1:27099/ahd-singleplayer");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "http://127.0.0.1:3111");
    const res = await proxy(
      makeRequest("http://127.0.0.1:3111/dashboard", {
        host: "127.0.0.1:3111",
      })
    );
    expect(mockGetAuthUserFromToken).not.toHaveBeenCalled();
    expect(res.cookies.get(AUTH_COOKIE_NAME)?.value).toBeTruthy();
  });
});
