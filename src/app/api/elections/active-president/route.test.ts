import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;
beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

describe("GET /api/elections/active-president", () => {
  it("scopes the lookup to the ?country= param", async () => {
    const ngId = new ObjectId();
    db.collection("elections").findOne.mockImplementation(async (q: Record<string, unknown>) =>
      q.state === "NG" ? { _id: ngId, seatId: "NG-president" } : null
    );
    const { GET } = await import("./route");
    const res = await GET(new Request("http://t/api/elections/active-president?country=ng"));
    const body = await res.json();
    expect(body).toEqual({ id: ngId.toString(), seatId: "NG-president" });
  });

  it("defaults to US when no country param is given", async () => {
    const usId = new ObjectId();
    db.collection("elections").findOne.mockImplementation(async (q: Record<string, unknown>) =>
      q.state === "US" ? { _id: usId, seatId: "US-president" } : null
    );
    const { GET } = await import("./route");
    const res = await GET(new Request("http://t/api/elections/active-president"));
    const body = await res.json();
    expect(body).toEqual({ id: usId.toString(), seatId: "US-president" });
  });

  it("returns null id when the country has no active/upcoming presidential race", async () => {
    // findOne defaults to null in the mock.
    const { GET } = await import("./route");
    const res = await GET(new Request("http://t/api/elections/active-president?country=ng"));
    const body = await res.json();
    expect(body).toEqual({ id: null, seatId: null });
  });
});
