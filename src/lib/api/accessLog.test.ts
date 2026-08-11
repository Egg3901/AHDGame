import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function makeRequest(url = "https://ahd.example/api/public/v1/elections?country=US") {
  return new Request(url, {
    method: "GET",
    headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "scraper/1.0" },
  });
}

describe("logApiAccess", () => {
  let insertOne: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    insertOne = vi.fn().mockResolvedValue({ insertedId: "x" });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({ insertOne }),
    } as never);
  });

  afterEach(() => vi.restoreAllMocks());

  it("records path, method, client ip, user agent and provided fields", async () => {
    const { logApiAccess } = await import("./accessLog");
    logApiAccess(makeRequest(), {
      bucket: "elections",
      authType: "user-key",
      userId: "u1",
      status: 200,
    });

    // Fire-and-forget: let the microtask flush.
    await new Promise((r) => setTimeout(r, 0));

    expect(insertOne).toHaveBeenCalledTimes(1);
    const entry = insertOne.mock.calls[0][0];
    expect(entry.path).toBe("/api/public/v1/elections");
    expect(entry.method).toBe("GET");
    expect(entry.ip).toBe("203.0.113.7"); // first hop of x-forwarded-for
    expect(entry.userAgent).toBe("scraper/1.0");
    expect(entry.bucket).toBe("elections");
    expect(entry.authType).toBe("user-key");
    expect(entry.userId).toBe("u1");
    expect(entry.status).toBe(200);
    expect(entry.timestamp).toBeInstanceOf(Date);
  });

  it("never throws when the DB write fails", async () => {
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockRejectedValue(new Error("db down"));
    const { logApiAccess } = await import("./accessLog");

    expect(() => logApiAccess(makeRequest(), { bucket: "elections" })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
