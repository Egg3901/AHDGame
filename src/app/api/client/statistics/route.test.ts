import { beforeEach, describe, expect, it, vi } from "vitest";

const insertOne = vi.fn();
const collection = vi.fn();

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(async () => ({ collection })),
}));

import { getDb } from "@/lib/mongodb";
import { COLLECTION_NAME } from "@/lib/clientStatistics";
import { POST } from "./route";

function validBody() {
  return {
    version: 1,
    createdAt: "2026-09-06T12:34:56.000Z",
    appMajorVersion: 2,
    setup: {
      era: "2019",
      mode: "normal",
      difficulty: "normal",
      autonomy: "v1",
      featureFlags: { forexEnabled: true },
    },
    metrics: { partyCount: 12, revenueBySector: { energy: 5e9 } },
    turn: 42,
  };
}

function post(body: unknown, contentType = "application/json"): Request {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("http://localhost/api/client/statistics", {
    method: "POST",
    body: text,
    headers: { "content-type": contentType },
  });
}

describe("POST /api/client/statistics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collection.mockReturnValue({ insertOne });
    insertOne.mockResolvedValue({ acknowledged: true });
  });

  it("stores a sanitized aggregate and returns a minimal no-store 202", async () => {
    const response = await POST(post(validBody()));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(collection).toHaveBeenCalledWith(COLLECTION_NAME);
    expect(insertOne).toHaveBeenCalledTimes(1);

    const doc = insertOne.mock.calls[0][0];
    expect(doc.version).toBe(1);
    expect(doc.appMajorVersion).toBe(2);
    expect(doc.turn).toBe(42);
    expect(doc.setup.era).toBe("2019");
    expect(doc.createdAt).toBeInstanceOf(Date);
    expect(doc.createdAt.getUTCHours()).toBe(0);
    expect(doc.expiresAt.getTime() - doc.createdAt.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    const serialized = JSON.stringify(doc);
    expect(serialized).not.toContain("12:34:56");
    expect(doc).not.toHaveProperty("accountId");
  });

  it("rejects non-JSON content types without touching the database", async () => {
    const response = await POST(post(validBody(), "text/plain"));

    expect(response.status).toBe(415);
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies before parsing", async () => {
    const big = new Request("http://localhost/api/client/statistics", {
      method: "POST",
      body: "x".repeat(9000),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(big);

    expect(response.status).toBe(413);
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("returns a generic error for malformed JSON", async () => {
    const response = await POST(post("{not json", "application/json"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Invalid report" });
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("returns a generic error that never echoes the payload", async () => {
    const evil = {
      ...validBody(),
      accountId: "507f1f77bcf86cd799439011",
      displayName: "Ada",
    };
    const response = await POST(post(evil));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Invalid report" });
    expect(JSON.stringify(body)).not.toContain("507f1f77bcf86cd799439011");
    expect(JSON.stringify(body)).not.toContain("Ada");
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("rejects out-of-range metrics generically", async () => {
    const response = await POST(post({ ...validBody(), metrics: { partyCount: -1 } }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Invalid report" });
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("returns a generic error when storage fails", async () => {
    insertOne.mockRejectedValueOnce(new Error("db down"));

    const response = await POST(post(validBody()));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Unable to store report" });
  });

  it("sends no cookies and needs no auth headers", async () => {
    const request = post(validBody());
    expect(request.headers.get("cookie")).toBeNull();

    const response = await POST(request);

    expect(response.status).toBe(202);
    expect(getDb).toHaveBeenCalledTimes(1);
  });
});
