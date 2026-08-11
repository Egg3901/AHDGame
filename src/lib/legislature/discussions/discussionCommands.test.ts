import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  createBillDiscussion,
  reactToBillDiscussion,
  hideBillDiscussion,
} from "./discussionCommands";
import type { Character } from "@/lib/db/types";

vi.mock("@/lib/db/patreonBorders", () => ({
  fetchBordersByUserIds: vi.fn().mockResolvedValue(new Map()),
}));

function legislator(): Character {
  return {
    _id: new ObjectId(),
    userId: new ObjectId(),
    name: "Jane Rep",
    avatarUrl: "http://img/a.png",
    sequentialId: 7,
    party: "1",
    homeState: "CA",
  } as unknown as Character;
}

let db: MockDb;
beforeEach(() => {
  db = createMockDb();
  db.collection("electedOfficials");
  db.collection("politicalParties");
  db.collection("states");
  db.collection("billDiscussions");
  db.collection("billDiscussionReactions");
});

describe("createBillDiscussion", () => {
  it("inserts a post with denormalized author identity", async () => {
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue({ _id: new ObjectId() });
    db.collectionMocks.politicalParties!.findOne.mockResolvedValue({
      name: "Greens",
      color: "#0f0",
    });
    db.collectionMocks.states!.findOne.mockResolvedValue({ name: "California" });

    const { post } = await createBillDiscussion(db as never, {
      scope: { kind: "national", countryId: "US", billId: new ObjectId().toString() },
      character: legislator(),
      content: "  I support this.  ",
    });

    expect(db.collectionMocks.billDiscussions!.insertOne).toHaveBeenCalledOnce();
    const doc = db.collectionMocks.billDiscussions!.insertOne.mock.calls[0][0];
    expect(doc.content).toBe("I support this.");
    expect(doc.authorName).toBe("Jane Rep");
    expect(doc.authorParty).toBe("Greens");
    expect(doc.authorPartyColor).toBe("#0f0");
    expect(doc.authorRegionLabel).toBe("California");
    expect(doc.authorSequentialId).toBe(7);
    expect(doc.reactions).toEqual({ agree: 0, disagree: 0 });
    expect(post.content).toBe("I support this.");
  });

  it("rejects a non-legislator with 403", async () => {
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue(null);
    await expect(
      createBillDiscussion(db as never, {
        scope: { kind: "national", countryId: "US", billId: new ObjectId().toString() },
        character: legislator(),
        content: "hello",
      })
    ).rejects.toMatchObject({ status: 403 });
    expect(db.collectionMocks.billDiscussions!.insertOne).not.toHaveBeenCalled();
  });

  it("rejects a slur and does not insert", async () => {
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue({ _id: new ObjectId() });
    await expect(
      createBillDiscussion(db as never, {
        scope: { kind: "national", countryId: "US", billId: new ObjectId().toString() },
        character: legislator(),
        content: "you faggot",
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(db.collectionMocks.billDiscussions!.insertOne).not.toHaveBeenCalled();
  });
});

describe("reactToBillDiscussion", () => {
  const did = new ObjectId();
  const uid = new ObjectId();

  it("adds a new reaction and increments the count", async () => {
    db.collectionMocks
      .billDiscussions!.findOne.mockResolvedValueOnce({
        _id: did,
        reactions: { agree: 0, disagree: 0 },
      })
      .mockResolvedValueOnce({ _id: did, reactions: { agree: 1, disagree: 0 } });
    db.collectionMocks.billDiscussionReactions!.findOne.mockResolvedValue(null);

    const res = await reactToBillDiscussion(db as never, {
      discussionId: did.toString(),
      userId: uid.toString(),
      reaction: "agree",
    });
    expect(db.collectionMocks.billDiscussionReactions!.insertOne).toHaveBeenCalledOnce();
    const inc = db.collectionMocks.billDiscussions!.updateOne.mock.calls[0][1];
    expect(inc.$inc).toEqual({ "reactions.agree": 1 });
    expect(res.viewerReaction).toBe("agree");
  });

  it("removes the reaction when the same one is sent again", async () => {
    db.collectionMocks
      .billDiscussions!.findOne.mockResolvedValueOnce({
        _id: did,
        reactions: { agree: 1, disagree: 0 },
      })
      .mockResolvedValueOnce({ _id: did, reactions: { agree: 0, disagree: 0 } });
    db.collectionMocks.billDiscussionReactions!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      reaction: "agree",
    });

    const res = await reactToBillDiscussion(db as never, {
      discussionId: did.toString(),
      userId: uid.toString(),
      reaction: "agree",
    });
    expect(db.collectionMocks.billDiscussionReactions!.deleteOne).toHaveBeenCalledOnce();
    const inc = db.collectionMocks.billDiscussions!.updateOne.mock.calls[0][1];
    expect(inc.$inc).toEqual({ "reactions.agree": -1 });
    expect(res.viewerReaction).toBeNull();
  });

  it("switches the reaction, moving the count", async () => {
    db.collectionMocks
      .billDiscussions!.findOne.mockResolvedValueOnce({
        _id: did,
        reactions: { agree: 1, disagree: 0 },
      })
      .mockResolvedValueOnce({ _id: did, reactions: { agree: 0, disagree: 1 } });
    db.collectionMocks.billDiscussionReactions!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      reaction: "agree",
    });

    const res = await reactToBillDiscussion(db as never, {
      discussionId: did.toString(),
      userId: uid.toString(),
      reaction: "disagree",
    });
    const inc = db.collectionMocks.billDiscussions!.updateOne.mock.calls[0][1];
    expect(inc.$inc).toEqual({ "reactions.agree": -1, "reactions.disagree": 1 });
    expect(res.viewerReaction).toBe("disagree");
  });
});

describe("hideBillDiscussion", () => {
  it("sets the moderation flag", async () => {
    db.collectionMocks.billDiscussions!.updateOne.mockResolvedValue({ matchedCount: 1 });
    await hideBillDiscussion(db as never, {
      discussionId: new ObjectId().toString(),
      adminUserId: new ObjectId().toString(),
    });
    const update = db.collectionMocks.billDiscussions!.updateOne.mock.calls[0][1];
    expect(update.$set.moderation.hidden).toBe(true);
  });

  it("404s when the post does not exist", async () => {
    db.collectionMocks.billDiscussions!.updateOne.mockResolvedValue({ matchedCount: 0 });
    await expect(
      hideBillDiscussion(db as never, {
        discussionId: new ObjectId().toString(),
        adminUserId: new ObjectId().toString(),
      })
    ).rejects.toMatchObject({ status: 404 });
  });
});
