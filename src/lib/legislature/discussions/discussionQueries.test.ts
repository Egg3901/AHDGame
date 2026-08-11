import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getBillDiscussionsForViewer } from "./discussionQueries";
import { BILL_DISCUSSIONS_PAGE_SIZE } from "./types";

vi.mock("@/lib/db/patreonBorders", () => ({
  fetchBordersByUserIds: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("./discussionEligibility", () => ({
  canPostBillDiscussion: vi.fn().mockResolvedValue(true),
}));

function makeCursor(docs: unknown[]) {
  return {
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(docs),
  };
}

function postDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    authorId: new ObjectId(),
    authorUserId: new ObjectId(),
    authorName: "Rep A",
    authorAvatarUrl: null,
    authorSequentialId: 1,
    authorParty: "Greens",
    authorPartyColor: "#0f0",
    authorRegionLabel: "California",
    content: "hi",
    reactions: { agree: 0, disagree: 0 },
    createdAt: new Date(),
    ...overrides,
  };
}

let db: MockDb;
beforeEach(() => {
  db = createMockDb();
  db.collection("billDiscussions");
  db.collection("billDiscussionReactions");
});

const scope = {
  kind: "national" as const,
  countryId: "US" as const,
  billId: new ObjectId().toString(),
};

describe("getBillDiscussionsForViewer", () => {
  it("sorts newest-first, pages by 10, and computes totalPages", async () => {
    const cursor = makeCursor([postDoc()]);
    db.collectionMocks.billDiscussions!.find.mockReturnValue(cursor as never);
    db.collectionMocks.billDiscussions!.countDocuments.mockResolvedValue(23);

    const res = await getBillDiscussionsForViewer(db as never, scope, { user: null, page: 2 });

    expect(cursor.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(cursor.skip).toHaveBeenCalledWith(BILL_DISCUSSIONS_PAGE_SIZE);
    expect(cursor.limit).toHaveBeenCalledWith(BILL_DISCUSSIONS_PAGE_SIZE);
    expect(res.total).toBe(23);
    expect(res.totalPages).toBe(3);
    expect(res.page).toBe(2);
    expect(res.viewerCanPost).toBe(false);
    expect(res.viewerIsAdmin).toBe(false);
  });

  it("excludes hidden posts for non-admins", async () => {
    const cursor = makeCursor([]);
    db.collectionMocks.billDiscussions!.find.mockReturnValue(cursor as never);
    db.collectionMocks.billDiscussions!.countDocuments.mockResolvedValue(0);

    await getBillDiscussionsForViewer(db as never, scope, { user: null, page: 1 });
    const filter = db.collectionMocks.billDiscussions!.find.mock.calls[0][0];
    expect(filter["moderation.hidden"]).toEqual({ $ne: true });
  });

  it("includes hidden posts for admins and reports viewerIsAdmin", async () => {
    const cursor = makeCursor([]);
    db.collectionMocks.billDiscussions!.find.mockReturnValue(cursor as never);
    db.collectionMocks.billDiscussions!.countDocuments.mockResolvedValue(0);

    const res = await getBillDiscussionsForViewer(db as never, scope, {
      user: {
        userId: new ObjectId().toString(),
        isAdmin: true,
        character: { _id: new ObjectId() },
      } as never,
      page: 1,
    });
    const filter = db.collectionMocks.billDiscussions!.find.mock.calls[0][0];
    expect(filter["moderation.hidden"]).toBeUndefined();
    expect(res.viewerIsAdmin).toBe(true);
  });

  it("resolves the viewer's own reaction", async () => {
    const post = postDoc();
    const cursor = makeCursor([post]);
    db.collectionMocks.billDiscussions!.find.mockReturnValue(cursor as never);
    db.collectionMocks.billDiscussions!.countDocuments.mockResolvedValue(1);
    db.collectionMocks.billDiscussionReactions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ discussionId: post._id, reaction: "agree" }]),
    } as never);

    const res = await getBillDiscussionsForViewer(db as never, scope, {
      user: {
        userId: new ObjectId().toString(),
        isAdmin: false,
        character: { _id: new ObjectId() },
      } as never,
      page: 1,
    });
    expect(res.posts[0].viewerReaction).toBe("agree");
    expect(res.viewerCanPost).toBe(true);
  });
});
