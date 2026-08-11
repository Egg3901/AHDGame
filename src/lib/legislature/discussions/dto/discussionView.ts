import type { BillDiscussion } from "@/lib/db/types";
import type { BillDiscussionView } from "../types";

export function serializeBillDiscussion(
  doc: BillDiscussion,
  authorBorderKey: string | null,
  authorTintColor: string | null,
  viewerReaction: "agree" | "disagree" | null
): BillDiscussionView {
  return {
    _id: doc._id.toString(),
    authorId: doc.authorId.toString(),
    authorSequentialId: doc.authorSequentialId,
    authorName: doc.authorName,
    authorAvatarUrl: doc.authorAvatarUrl,
    authorParty: doc.authorParty,
    authorPartyColor: doc.authorPartyColor,
    authorRegionLabel: doc.authorRegionLabel,
    authorBorderKey,
    authorTintColor,
    content: doc.content,
    reactions: doc.reactions,
    viewerReaction,
    createdAt: doc.createdAt.toISOString(),
  };
}
