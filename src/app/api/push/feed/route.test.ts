import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { GET } from "./route";
import { requireBasicAuth } from "@/lib/api/requireAuth";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));

const userId = "507f1f77bcf86cd799439011";
let db: MockDb;
let call = 0;
const request = (after?: string) =>
  new Request(`https://example.com/api/push/feed${after ? `?after=${after}` : ""}`);
const alert = (overrides: Record<string, unknown> = {}) => ({
  _id: new ObjectId(),
  type: "primary_win",
  title: "You won the Ohio Senate race",
  message: "52.1% of the vote, a margin of 4.3 points.",
  metadata: {},
  read: false,
  createdAt: new Date(),
  ...overrides,
});
function scan(rows: unknown[]) {
  const cursor = db.collection("notifications").find();
  cursor.toArray.mockResolvedValue(rows);
}

beforeEach(async () => {
  vi.resetAllMocks();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: {
      userId: `${userId.slice(0, -1)}${call++ % 10}`,
      username: "test",
      email: "test@example.com",
      role: "player",
      isAdmin: false,
    },
  });
  db.collection("users").findOne.mockResolvedValue({ notificationPreferences: {} });
});

describe("desktop push feed", () => {
  it("starts at the newest notification without replaying the inbox", async () => {
    const newest = new ObjectId();
    db.collection("notifications").findOne.mockResolvedValue({ _id: newest });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ cursor: newest.toString(), items: [], more: 0 });
  });

  it("returns the newest alerts first with their own text, category and page", async () => {
    const rows = [1, 2, 3, 4].map((n) => alert({ title: `Alert ${n}` }));
    scan(rows);
    const body = await (await GET(request(new ObjectId().toString()))).json();
    expect(body.cursor).toBe(rows[3]._id.toString());
    expect(body.more).toBe(1);
    expect(body.items.map((item: { title: string }) => item.title)).toEqual([
      "Alert 4",
      "Alert 3",
      "Alert 2",
    ]);
    expect(body.items[0]).toMatchObject({
      id: rows[3]._id.toString(),
      subtitle: "Election",
      body: "52.1% of the vote, a margin of 4.3 points.",
      thread: "election",
    });
    expect(body.items[0].href.startsWith("/")).toBe(true);
  });

  it("applies the mobile push policy and still advances past filtered alerts", async () => {
    const muted = alert({ type: "primary_win" });
    const read = alert({ type: "bill_passed", read: true });
    const routine = alert({ type: "turn_advance" });
    const stale = alert({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60_000) });
    db.collection("users").findOne.mockResolvedValue({
      notificationPreferences: { mutedTypes: ["primary_win"] },
    });
    scan([stale, muted, read, routine]);
    const body = await (await GET(request(new ObjectId().toString()))).json();
    expect(body).toEqual({ cursor: routine._id.toString(), items: [], more: 0 });
  });

  it("keeps the cursor when nothing new arrived", async () => {
    const after = new ObjectId().toString();
    scan([]);
    expect(await (await GET(request(after))).json()).toEqual({ cursor: after, items: [], more: 0 });
  });

  it("rejects unauthenticated callers and malformed cursors", async () => {
    vi.mocked(requireBasicAuth).mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({}, { status: 401 }),
    });
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("not-an-id"))).status).toBe(400);
  });
});
