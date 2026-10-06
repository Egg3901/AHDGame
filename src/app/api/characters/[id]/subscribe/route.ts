import { NextResponse } from "next/server";
import { withNoStore } from "@/lib/api/withNoStore";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth"; // Optional auth — intentionally uses getAuthUser() in GET
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import type { Character, UserSubscription } from "@/lib/db/types";
import { getCharacterByUserId } from "@/lib/db/characterLookup";

// GET /api/characters/[id]/subscribe — Returns the authenticated user's subscription status and subscriber count for a character
// Auth: public
// Errors: 400
async function handleGET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ subscribed: false });

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return errorResponse(400, "Invalid character ID");
    }

    const db = await getDb();
    const targetCharacterId = new ObjectId(id);

    // Get the subscriber's character
    const myCharacter = await getCharacterByUserId(db, user.userId);

    if (!myCharacter) return NextResponse.json({ subscribed: false });

    const existing = await db.collection<UserSubscription>("userSubscriptions").findOne({
      subscriberCharacterId: myCharacter._id,
      subscribedToCharacterId: targetCharacterId,
    });

    // Get subscriber count for the target
    const subscriberCount = await db
      .collection<UserSubscription>("userSubscriptions")
      .countDocuments({ subscribedToCharacterId: targetCharacterId });

    return NextResponse.json({ subscribed: !!existing, subscriberCount });
  } catch (err) {
    return handleRouteError(err);
  }
}

export const GET = withNoStore(handleGET);

// POST /api/characters/[id]/subscribe — Subscribes the authenticated character to the target character
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 404, 429
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return errorResponse(400, "Invalid character ID");
    }

    const db = await getDb();
    const targetCharacterId = new ObjectId(id);

    // Get subscriber's character
    const myCharacter = await getCharacterByUserId(db, user.userId);

    if (!myCharacter) {
      return errorResponse(403, "Character required to subscribe");
    }

    // Can't subscribe to yourself
    if (myCharacter._id.equals(targetCharacterId)) {
      return errorResponse(400, "Cannot subscribe to yourself");
    }

    // Target must exist
    const targetCharacter = await db
      .collection<Character>("characters")
      .findOne({ _id: targetCharacterId });

    if (!targetCharacter) {
      return errorResponse(404, "Character not found");
    }

    // Upsert subscription
    await db.collection<Omit<UserSubscription, "_id">>("userSubscriptions").updateOne(
      {
        subscriberCharacterId: myCharacter._id,
        subscribedToCharacterId: targetCharacterId,
      },
      {
        $setOnInsert: {
          subscriberUserId: new ObjectId(user.userId),
          subscriberCharacterId: myCharacter._id,
          subscribedToCharacterId: targetCharacterId,
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );

    const subscriberCount = await db
      .collection<UserSubscription>("userSubscriptions")
      .countDocuments({ subscribedToCharacterId: targetCharacterId });

    try {
      const { awardAchievement, resolveUserIdFromCharacter } = await import("@/lib/achievements");
      const { checkSubscriberAchievements } = await import("@/lib/achievements/triggers");
      await awardAchievement(new ObjectId(user.userId), "first_subscriber", myCharacter._id);
      // Target character's userId must be resolved for subscriber achievements
      const targetUserId = await resolveUserIdFromCharacter(targetCharacterId);
      if (targetUserId) {
        await checkSubscriberAchievements(targetUserId, targetCharacterId);
      }
    } catch (e) {
      console.error("Achievement check failed:", e);
    }

    return NextResponse.json({ subscribed: true, subscriberCount });
  } catch (err) {
    return handleRouteError(err);
  }
}

// DELETE /api/characters/[id]/subscribe — Unsubscribes the authenticated character from the target character
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 429
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return errorResponse(400, "Invalid character ID");
    }

    const db = await getDb();
    const targetCharacterId = new ObjectId(id);

    const myCharacter = await getCharacterByUserId(db, user.userId);

    if (!myCharacter) {
      return errorResponse(403, "Character required");
    }

    await db.collection<UserSubscription>("userSubscriptions").deleteOne({
      subscriberCharacterId: myCharacter._id,
      subscribedToCharacterId: targetCharacterId,
    });

    const subscriberCount = await db
      .collection<UserSubscription>("userSubscriptions")
      .countDocuments({ subscribedToCharacterId: targetCharacterId });

    return NextResponse.json({ subscribed: false, subscriberCount });
  } catch (err) {
    return handleRouteError(err);
  }
}
