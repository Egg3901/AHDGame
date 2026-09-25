import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { GET } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

vi.mock("@/lib/api/userApiAuth", () => ({
  requireUserApiKey: vi.fn(),
}));

vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({
    ok: true,
    limit: 30,
    remaining: 29,
    resetAt: 1_700_000_000_000,
  }),
  rateLimitHeaders: vi.fn().mockReturnValue({
    "X-RateLimit-Limit": "30",
    "X-RateLimit-Remaining": "29",
    "X-RateLimit-Reset": "1700000000",
  }),
  rateLimitResponse: vi.fn(),
}));

const KEY_ID = new ObjectId();
const OWNER_ID = new ObjectId();
const RAW_TOKEN = "ahd_pub_secretvalue";
const TOKEN_HASH = "deadbeef".repeat(8);

function mockAuth(result: unknown) {
  return import("@/lib/api/userApiAuth").then(({ requireUserApiKey }) =>
    vi.mocked(requireUserApiKey).mockResolvedValue(result as never)
  );
}

function mockKeyDoc(doc: Record<string, unknown> | null) {
  const findOne = vi.fn().mockResolvedValue(doc);
  return import("@/lib/mongodb").then(({ getDb }) => {
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockReturnValue({ findOne }),
    } as never);
    return findOne;
  });
}

function authedRequest() {
  return new Request("http://localhost/api/v1/key", {
    headers: { "X-API-Key": RAW_TOKEN },
  });
}

describe("GET /api/v1/key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the X-API-Key header is missing", async () => {
    await mockAuth({ ok: false, reason: "missing" });

    const res = await GET(new Request("http://localhost/api/v1/key"));

    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("returns 401 for an invalid or revoked key", async () => {
    await mockAuth({ ok: false, reason: "invalid" });

    const res = await GET(authedRequest());

    expect(res.status).toBe(401);
  });

  it("describes a public key with read-only operations", async () => {
    await mockAuth({
      ok: true,
      scope: "public",
      keyId: KEY_ID.toString(),
      ownerUserId: OWNER_ID.toString(),
    });
    const findOne = await mockKeyDoc({
      _id: KEY_ID,
      name: "discord-bot",
      prefix: "ahd_pub_abc12",
      scope: "public",
      createdAt: new Date("2026-09-01T00:00:00Z"),
      lastUsedAt: null,
      requestCount: 7,
      revokeAt: null,
    });

    const res = await GET(authedRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.key).toMatchObject({
      id: KEY_ID.toString(),
      name: "discord-bot",
      prefix: "ahd_pub_abc12",
      scope: "public",
      requestCount: 7,
    });
    expect(body.ownerUserId).toBe(OWNER_ID.toString());
    expect(body.allowedOperations).toEqual(["read"]);
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    expect(checkRateLimit).toHaveBeenCalledWith(`api-key-introspection:${KEY_ID}`, 30, 60_000);
    // The lookup must be scoped to the caller's own key id.
    expect(findOne).toHaveBeenCalledWith(
      { _id: KEY_ID, revokedAt: null },
      expect.objectContaining({ projection: expect.any(Object) })
    );
  });

  it("describes a private key with write operations", async () => {
    await mockAuth({
      ok: true,
      scope: "private",
      keyId: KEY_ID.toString(),
      ownerUserId: OWNER_ID.toString(),
    });
    await mockKeyDoc({
      _id: KEY_ID,
      name: "trading-bot",
      prefix: "ahd_priv_xyz99",
      scope: "private",
      createdAt: new Date("2026-09-01T00:00:00Z"),
      lastUsedAt: new Date("2026-09-10T00:00:00Z"),
      requestCount: 42,
      revokeAt: new Date("2026-09-26T00:00:00Z"),
    });

    const res = await GET(authedRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.key.scope).toBe("private");
    expect(body.key.revokeAt).toBe("2026-09-26T00:00:00.000Z");
    expect(body.allowedOperations).toEqual(["read", "transfer", "forex"]);
  });

  it("never returns the token, its hash, or another account's fields", async () => {
    await mockAuth({
      ok: true,
      scope: "public",
      keyId: KEY_ID.toString(),
      ownerUserId: OWNER_ID.toString(),
    });
    const findOne = await mockKeyDoc({
      _id: KEY_ID,
      userId: OWNER_ID,
      name: "leaky",
      prefix: "ahd_pub_abc12",
      scope: "public",
      tokenHash: TOKEN_HASH,
      requestCount: 1,
    });

    const res = await GET(authedRequest());
    const raw = await res.text();

    expect(raw).not.toContain(RAW_TOKEN);
    expect(raw).not.toContain(TOKEN_HASH);
    // The projection whitelists display fields only, so tokenHash is never read.
    const projection = findOne.mock.calls[0][1].projection as Record<string, number>;
    expect(projection).not.toHaveProperty("tokenHash");
    expect(projection).not.toHaveProperty("userId");
  });

  it("marks the response no-store and private-only", async () => {
    await mockAuth({
      ok: true,
      scope: "public",
      keyId: KEY_ID.toString(),
      ownerUserId: OWNER_ID.toString(),
    });
    await mockKeyDoc({ _id: KEY_ID, name: "bot", scope: "public" });

    const res = await GET(authedRequest());

    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("Cache-Control")).not.toContain("public");
    expect(res.headers.get("X-RateLimit-Limit")).toBe("30");
  });

  it("returns 429 when the caller is rate limited", async () => {
    await mockAuth({
      ok: true,
      scope: "public",
      keyId: KEY_ID.toString(),
      ownerUserId: OWNER_ID.toString(),
    });
    const { checkRateLimit, rateLimitResponse } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValueOnce({
      ok: false,
      limit: 30,
      remaining: 0,
      resetAt: 1_700_000_000_000,
      retryAfter: 12,
    });
    vi.mocked(rateLimitResponse).mockReturnValueOnce(
      NextResponse.json({ error: "slow down" }, { status: 429 })
    );

    const res = await GET(authedRequest());

    expect(res.status).toBe(429);
    expect(rateLimitResponse).toHaveBeenCalledWith(12);
  });

  it("returns 401 when the key document vanishes between auth and read", async () => {
    await mockAuth({
      ok: true,
      scope: "public",
      keyId: KEY_ID.toString(),
      ownerUserId: OWNER_ID.toString(),
    });
    await mockKeyDoc(null);

    const res = await GET(authedRequest());

    expect(res.status).toBe(401);
  });
});
