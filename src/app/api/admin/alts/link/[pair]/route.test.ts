import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireModerator", () => ({ requireModerator: vi.fn() }));

let db: MockDb;

const userA = new ObjectId();
const userB = new ObjectId();

function sortedPairString() {
  return userA.toString() <= userB.toString()
    ? `${userA.toString()}_${userB.toString()}`
    : `${userB.toString()}_${userA.toString()}`;
}

function makeLink() {
  const [a, b] = userA.toString() <= userB.toString() ? [userA, userB] : [userB, userA];
  return {
    _id: new ObjectId(),
    userA: a,
    userB: b,
    confidence: 0.6,
    signals: [
      {
        type: "trackingId_exact",
        weight: 0.9,
        contribution: 0.9,
        evidence: "Shared browser tracking cookie",
        detectedAt: new Date(),
      },
    ],
    updatedAt: new Date(),
    turn: 3,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("altLinks");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

async function mockModerator(isAdmin = false) {
  const { requireModerator } = await import("@/lib/api/requireModerator");
  vi.mocked(requireModerator).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString(), username: "mod1", isAdmin },
  } as Awaited<ReturnType<typeof requireModerator>>);
}

function get(pair: string) {
  return import("./route").then(({ GET }) =>
    GET(new Request(`http://localhost/api/admin/alts/link/${pair}`), {
      params: Promise.resolve({ pair }),
    })
  );
}

describe("GET /api/admin/alts/link/[pair]", () => {
  it("returns 403 when not a moderator/admin", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as Awaited<ReturnType<typeof requireModerator>>);

    const res = await get(sortedPairString());
    expect(res.status).toBe(403);
  });

  it("rejects a malformed pair", async () => {
    await mockModerator();
    const res = await get("not-a-pair");
    expect(res.status).toBe(400);
  });

  it("returns 404 when no link exists for the pair", async () => {
    await mockModerator();
    db.collectionMocks.altLinks.findOne.mockResolvedValue(null);
    const res = await get(sortedPairString());
    expect(res.status).toBe(404);
  });

  it("looks up the pair in sorted order regardless of request order", async () => {
    await mockModerator();
    const link = makeLink();
    db.collectionMocks.altLinks.findOne.mockResolvedValue(link);

    // Request in reverse order from the sorted storage order.
    const reversed = `${link.userB.toString()}_${link.userA.toString()}`;
    const res = await get(reversed);
    expect(res.status).toBe(200);
    expect(db.collectionMocks.altLinks.findOne).toHaveBeenCalledWith({
      userA: link.userA,
      userB: link.userB,
    });
    const data = await res.json();
    expect(data.userA).toBe(link.userA.toString());
    expect(data.userB).toBe(link.userB.toString());
    expect(data.signals).toHaveLength(1);
  });
});
