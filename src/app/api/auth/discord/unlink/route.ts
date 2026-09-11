import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { verifyAuth } from "@/lib/auth";
import { credentialSessionIsCurrent } from "@/lib/auth/credentialSession";
import { invalidateCachedUser } from "@/lib/auth/userDocCache";
import {
  decideProviderUnlink,
  providerWriteSnapshotFilter,
} from "@/lib/auth/providerCredentialWrite";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { withNoStore } from "@/lib/api/withNoStore";
import type { User } from "@/lib/db/types";

// POST /api/auth/discord/unlink — Removes the Discord account link from the authenticated user's profile.
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 409, 429, 503
// Every path is per-account: withNoStore stamps the early rate-limit and
// outer error responses that carry no explicit Cache-Control header.
export const POST = withNoStore(async function POST() {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) {
      auth.response.headers.set("Cache-Control", "private, no-store");
      return auth.response;
    }
    const userId = auth.user.userId;

    const rateLimit = checkRateLimit(userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    const usersCollection = db.collection<User>("users");

    // Credential writes require the uncached account state, never the cached grant.
    const account = await usersCollection.findOne({ _id: new ObjectId(userId) });
    if (!account) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    // Verify the cryptographic cookie payload against the same fresh account
    // so a signed-out, revoked, or banned session cannot unlink a provider.
    if (!credentialSessionIsCurrent(userId, account, await verifyAuth())) {
      return NextResponse.json(
        { error: "Please sign in again before changing sign-in methods." },
        { status: 401, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    const unlink = decideProviderUnlink(account, "discord");
    if (!unlink.ok && unlink.reason === "not_linked") {
      return NextResponse.json(
        { success: true },
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }
    if (!unlink.ok) {
      return NextResponse.json(
        {
          error:
            "Cannot remove your last sign-in method. Set a password or link another account first.",
        },
        { status: 400, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    // Evict before the write so parallel requests re-read the pre-unlink record.
    // The key is canonical: the fresh account id, not the cached grant.
    const cacheKey = account._id.toHexString();
    invalidateCachedUser(cacheKey);
    const revokedAt = new Date();
    let write;
    try {
      write = await usersCollection.updateOne(
        {
          _id: new ObjectId(userId),
          ...providerWriteSnapshotFilter(account),
        },
        {
          $unset: {
            discordId: "",
            discordUsername: "",
            discordAvatar: "",
            discordLinkedAt: "",
          },
          // The credential relationship changed: revoke existing sessions so
          // the caller reauthenticates before further credential writes.
          $max: { authRevokedAt: revokedAt },
        }
      );
    } catch {
      return NextResponse.json(
        { error: "Unlink is temporarily unavailable. Please try again." },
        { status: 503, headers: { "Cache-Control": "private, no-store" } }
      );
    } finally {
      // A concurrent read may have repopulated the cache while the write was
      // pending; evict again after the settled write. A write can commit
      // despite a network error, so this also runs when the write throws or
      // goes unacknowledged.
      invalidateCachedUser(cacheKey);
    }
    if (write.acknowledged !== true) {
      return NextResponse.json(
        { error: "Unlink is temporarily unavailable. Please try again." },
        { status: 503, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    if (write.matchedCount !== 1) {
      // A concurrent provider, password, ban, or revocation write won the
      // snapshot race. Never report success without a confirmed write.
      return NextResponse.json(
        { error: "Your account changed during this request. Please sign in and try again." },
        { status: 409, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    return NextResponse.json(
      { success: true },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return handleRouteError(error);
  }
});
