import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const suggestionFindOne = vi.fn();
const commentFindOne = vi.fn();
const getCharacterByUserId = vi.fn();
const reportPlayer = vi.fn();

vi.mock("@/lib/mongodb", () => ({ getDb: async () => ({}) }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: async () => ({ ok: true, user: { userId: "507f1f77bcf86cd799439011" } }),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: () => ({ ok: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/db/collections/suggestions", () => ({
  getSuggestionsCollection: () => ({ findOne: suggestionFindOne }),
}));
vi.mock("@/lib/db/collections/suggestionComments", () => ({
  getSuggestionCommentsCollection: () => ({ findOne: commentFindOne }),
}));
vi.mock("@/lib/db/characterLookup", () => ({
  getCharacterByUserId: (...args: unknown[]) => getCharacterByUserId(...args),
}));
vi.mock("@/lib/safety/playerSafety", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/safety/playerSafety")>()),
  reportPlayer: (...args: unknown[]) => reportPlayer(...args),
}));

import { POST } from "./route";

function post(body: unknown, issue = "371") {
  return POST(
    new Request(`http://localhost/api/suggestions/public/${issue}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ issueNumber: issue }) }
  );
}

describe("POST /api/suggestions/public/[issueNumber]/report", () => {
  const posterId = new ObjectId();
  const characterId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    suggestionFindOne.mockResolvedValue({ _id: new ObjectId(), userId: posterId });
    getCharacterByUserId.mockResolvedValue({ _id: characterId });
  });

  it("reports the suggestion's author with context and location", async () => {
    const res = await post({ reason: "spam", details: "ad link" });
    expect(res.status).toBe(200);
    expect(getCharacterByUserId).toHaveBeenCalledWith({}, posterId);
    expect(reportPlayer).toHaveBeenCalledWith(
      {},
      "507f1f77bcf86cd799439011",
      characterId.toString(),
      { reason: "spam", context: "suggestion", details: "Suggestion S#371: ad link" }
    );
  });

  it("reports a reply's author when commentId is given", async () => {
    const replierId = new ObjectId();
    const commentId = new ObjectId().toString();
    commentFindOne.mockResolvedValue({ userId: replierId });
    const res = await post({ reason: "harassment", commentId });
    expect(res.status).toBe(200);
    expect(getCharacterByUserId).toHaveBeenCalledWith({}, replierId);
    expect(reportPlayer.mock.calls[0]![3].details).toBe(`Reply ${commentId} on suggestion S#371`);
  });

  it("404s for an unknown suggestion or reply", async () => {
    suggestionFindOne.mockResolvedValueOnce(null);
    expect((await post({ reason: "spam" })).status).toBe(404);
    commentFindOne.mockResolvedValueOnce(null);
    expect((await post({ reason: "spam", commentId: new ObjectId().toString() })).status).toBe(404);
  });

  it("400s when the post has no in-game author (Discord-only submission)", async () => {
    suggestionFindOne.mockResolvedValueOnce({ _id: new ObjectId(), userId: null });
    const res = await post({ reason: "spam" });
    expect(res.status).toBe(400);
    expect(reportPlayer).not.toHaveBeenCalled();
  });

  it("rejects an unknown reason", async () => {
    expect((await post({ reason: "boring" })).status).toBe(400);
  });
});
