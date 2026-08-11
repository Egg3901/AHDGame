import { ObjectId, type Db } from "mongodb";
import { badRequest, forbidden, notFound } from "@/lib/api/errors";
import { containsSlur } from "@/lib/moderation";
import { fetchBordersByUserIds } from "@/lib/db/patreonBorders";
import { getCountryConfig } from "@/lib/constants/countries";
import type {
  BillDiscussion,
  BillDiscussionReaction,
  Character,
  PoliticalParty,
  State,
} from "@/lib/db/types";
import { canPostBillDiscussion } from "./discussionEligibility";
import { serializeBillDiscussion } from "./dto/discussionView";
import type { BillDiscussionScope, BillDiscussionView } from "./types";

interface CreateInput {
  scope: BillDiscussionScope;
  character: Character;
  content: string;
}

/** Human-readable 403 message for a non-legislator attempting to post. */
export function eligibilityDeniedMessage(scope: BillDiscussionScope): string {
  const config = getCountryConfig(scope.countryId);
  if (scope.kind === "national") {
    return `Only ${config.legislature.name} members can post a discussion on this bill.`;
  }
  const chamber = config.subNationalChamber?.name ?? "State Senate";
  return `Only ${chamber} members in this region can post a discussion on this bill.`;
}

export async function createBillDiscussion(
  db: Db,
  { scope, character, content }: CreateInput
): Promise<{ post: BillDiscussionView }> {
  const trimmed = content.trim();
  if (!trimmed) throw badRequest("Discussion content is required.");
  if (containsSlur(trimmed)) {
    throw badRequest("Your post contains prohibited language and cannot be submitted.");
  }

  const eligible = await canPostBillDiscussion(db, character, scope);
  if (!eligible) throw forbidden(eligibilityDeniedMessage(scope));

  // Resolve party name + color (character.party stores the party sequentialId).
  const partySeq = parseInt(character.party ?? "", 10);
  const party = Number.isNaN(partySeq)
    ? null
    : await db
        .collection<PoliticalParty>("politicalParties")
        .findOne(
          { sequentialId: partySeq, countryId: scope.countryId },
          { projection: { name: 1, color: 1 } }
        );

  // Resolve region display label.
  const state = await db
    .collection<State>("states")
    .findOne({ _id: character.homeState, countryId: scope.countryId }, { projection: { name: 1 } });

  const doc: BillDiscussion = {
    _id: new ObjectId(),
    billScope: scope.kind,
    billId: new ObjectId(scope.billId),
    countryId: scope.countryId,
    ...(scope.kind === "state" ? { stateId: scope.stateId.toUpperCase() } : {}),
    authorId: character._id,
    authorUserId: character.userId,
    authorName: character.name,
    authorAvatarUrl: character.avatarUrl ?? null,
    authorSequentialId: character.sequentialId ?? null,
    authorParty: party?.name ?? null,
    authorPartyColor: party?.color ?? null,
    authorRegionLabel: state?.name ?? null,
    content: trimmed,
    reactions: { agree: 0, disagree: 0 },
    createdAt: new Date(),
  };
  await db.collection<BillDiscussion>("billDiscussions").insertOne(doc);

  const borders = await fetchBordersByUserIds(db, [doc.authorUserId]);
  const border = borders.get(doc.authorUserId.toString());
  return {
    post: serializeBillDiscussion(doc, border?.borderKey ?? null, border?.tintColor ?? null, null),
  };
}

interface ReactInput {
  discussionId: string;
  userId: string;
  reaction: "agree" | "disagree";
}

export async function reactToBillDiscussion(
  db: Db,
  { discussionId, userId, reaction }: ReactInput
): Promise<{
  reactions: { agree: number; disagree: number };
  viewerReaction: "agree" | "disagree" | null;
}> {
  if (!ObjectId.isValid(discussionId)) throw badRequest("Invalid discussion ID");
  const did = new ObjectId(discussionId);
  const uid = new ObjectId(userId);
  const posts = db.collection<BillDiscussion>("billDiscussions");
  const reactions = db.collection<BillDiscussionReaction>("billDiscussionReactions");

  const post = await posts.findOne({ _id: did });
  if (!post) throw notFound("Discussion not found");

  const existing = await reactions.findOne({ discussionId: did, userId: uid });

  let viewerReaction: "agree" | "disagree" | null = reaction;
  if (!existing) {
    await reactions.insertOne({
      _id: new ObjectId(),
      discussionId: did,
      userId: uid,
      reaction,
      createdAt: new Date(),
    });
    await posts.updateOne({ _id: did }, { $inc: { [`reactions.${reaction}`]: 1 } });
  } else if (existing.reaction === reaction) {
    await reactions.deleteOne({ _id: existing._id });
    await posts.updateOne({ _id: did }, { $inc: { [`reactions.${reaction}`]: -1 } });
    viewerReaction = null;
  } else {
    await reactions.updateOne({ _id: existing._id }, { $set: { reaction } });
    await posts.updateOne(
      { _id: did },
      { $inc: { [`reactions.${existing.reaction}`]: -1, [`reactions.${reaction}`]: 1 } }
    );
  }

  const updated = await posts.findOne({ _id: did });
  return { reactions: updated?.reactions ?? { agree: 0, disagree: 0 }, viewerReaction };
}

interface HideInput {
  discussionId: string;
  adminUserId: string;
}

export async function hideBillDiscussion(
  db: Db,
  { discussionId, adminUserId }: HideInput
): Promise<{ hidden: true }> {
  if (!ObjectId.isValid(discussionId)) throw badRequest("Invalid discussion ID");
  const res = await db.collection<BillDiscussion>("billDiscussions").updateOne(
    { _id: new ObjectId(discussionId) },
    {
      $set: {
        moderation: { hidden: true, hiddenBy: new ObjectId(adminUserId), hiddenAt: new Date() },
      },
    }
  );
  if (res.matchedCount === 0) throw notFound("Discussion not found");
  return { hidden: true };
}
