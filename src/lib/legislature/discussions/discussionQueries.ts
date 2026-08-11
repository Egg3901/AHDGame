import { ObjectId, type Db, type Filter } from "mongodb";
import { fetchBordersByUserIds } from "@/lib/db/patreonBorders";
import type { AuthUserWithCharacter } from "@/lib/auth";
import type { BillDiscussion, BillDiscussionReaction } from "@/lib/db/types";
import { canPostBillDiscussion } from "./discussionEligibility";
import { serializeBillDiscussion } from "./dto/discussionView";
import {
  BILL_DISCUSSIONS_PAGE_SIZE,
  type BillDiscussionScope,
  type BillDiscussionListResult,
} from "./types";

interface ViewerOptions {
  user: AuthUserWithCharacter | null;
  page: number;
}

export async function getBillDiscussionsForViewer(
  db: Db,
  scope: BillDiscussionScope,
  { user, page }: ViewerOptions
): Promise<BillDiscussionListResult> {
  const isAdmin = user?.isAdmin === true;
  const viewerUserId = user?.userId ?? null;
  const safePage = Math.max(1, Math.floor(page) || 1);

  const filter: Filter<BillDiscussion> = {
    billScope: scope.kind,
    billId: new ObjectId(scope.billId),
    countryId: scope.countryId,
  };
  if (scope.kind === "state") filter.stateId = scope.stateId.toUpperCase();
  if (!isAdmin) filter["moderation.hidden"] = { $ne: true };

  const coll = db.collection<BillDiscussion>("billDiscussions");
  const total = await coll.countDocuments(filter);
  const totalPages = Math.max(1, Math.ceil(total / BILL_DISCUSSIONS_PAGE_SIZE));

  const docs = await coll
    .find(filter)
    .sort({ createdAt: -1 })
    .skip((safePage - 1) * BILL_DISCUSSIONS_PAGE_SIZE)
    .limit(BILL_DISCUSSIONS_PAGE_SIZE)
    .toArray();

  // Patreon border/tint (resolved fresh).
  const authorUserIds = [...new Set(docs.map((d) => d.authorUserId.toString()))].map(
    (s) => new ObjectId(s)
  );
  const borders = authorUserIds.length
    ? await fetchBordersByUserIds(db, authorUserIds)
    : new Map<string, { borderKey: string | null; tintColor: string | null }>();

  // Viewer's own reactions on the posts in this page.
  const reactionByPost = new Map<string, "agree" | "disagree">();
  if (viewerUserId && docs.length) {
    const rows = await db
      .collection<BillDiscussionReaction>("billDiscussionReactions")
      .find({ discussionId: { $in: docs.map((d) => d._id) }, userId: new ObjectId(viewerUserId) })
      .toArray();
    for (const r of rows) reactionByPost.set(r.discussionId.toString(), r.reaction);
  }

  const viewerCanPost = user?.character
    ? await canPostBillDiscussion(db, user.character, scope)
    : false;

  return {
    posts: docs.map((d) => {
      const b = borders.get(d.authorUserId.toString());
      return serializeBillDiscussion(
        d,
        b?.borderKey ?? null,
        b?.tintColor ?? null,
        reactionByPost.get(d._id.toString()) ?? null
      );
    }),
    page: safePage,
    totalPages,
    total,
    viewerCanPost,
    viewerIsAdmin: isAdmin,
  };
}
