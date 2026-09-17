import { clientAvatarUrl } from "@/lib/client/avatarUrl";
import { NextResponse } from "next/server";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import type { User } from "@/lib/db/types";
import { isPatreonActive, isPlusOrBetter } from "@/lib/db/types";
import { ObjectId } from "mongodb";
import { cookies } from "next/headers";
import { getAuthUserFromToken } from "@/lib/auth";

const OFFLINE_ENTITLEMENT_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** The desktop client uses this same-origin response to confirm its WebView session. */
export async function GET() {
  let auth = await requireBasicAuth();
  if (!auth.ok) {
    const bridgeToken = (await cookies()).get("auth-token")?.value;
    const bridgeUser = bridgeToken ? await getAuthUserFromToken(bridgeToken) : null;
    if (!bridgeUser) return auth.response;
    auth = { ok: true, user: bridgeUser };
  }

  const db = await getDb();
  const user = await db.collection<User>("users").findOne(
    { _id: new ObjectId(auth.user.userId) },
    {
      projection: {
        displayName: 1,
        activeCharacterId: 1,
        discordId: 1,
        discordAvatar: 1,
        username: 1,
        patreonTier: 1,
        patreonExpiresAt: 1,
        singleplayerEntitledAt: 1,
        clientAccessExpiresAt: 1,
      },
    }
  );
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 401 });
  const character = user.activeCharacterId
    ? await db.collection("characters").findOne(
        {
          _id: user.activeCharacterId,
          userId: new ObjectId(auth.user.userId),
          retiredAt: { $exists: false },
        },
        { projection: { avatarUrl: 1 } }
      )
    : null;
  const discordAvatar =
    user.discordId && user.discordAvatar
      ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.discordId)}/${encodeURIComponent(user.discordAvatar)}.png?size=128`
      : null;
  const avatarUrl = clientAvatarUrl(character?.avatarUrl) ?? clientAvatarUrl(discordAvatar);
  const nowMs = Date.now();
  const supporter = isPatreonActive(user.patreonTier ?? null, user.patreonExpiresAt ?? null);
  const plusActive = supporter && isPlusOrBetter(user.patreonTier ?? null);
  const tempExpiresMs = user.clientAccessExpiresAt
    ? new Date(user.clientAccessExpiresAt).getTime()
    : 0;
  const tempActive = tempExpiresMs > nowMs;
  const singleplayerEntitled =
    auth.user.isModerator === true ||
    Boolean(user.singleplayerEntitledAt) ||
    plusActive ||
    tempActive;

  const graceEnd = nowMs + OFFLINE_ENTITLEMENT_GRACE_MS;
  const tempOnly =
    tempActive && auth.user.isModerator !== true && !user.singleplayerEntitledAt && !plusActive;

  return NextResponse.json(
    {
      linked: true,
      displayName: user.displayName || user.username,
      supporter,
      avatarUrl,
      singleplayer: {
        entitled: singleplayerEntitled,
        // A bounded cache keeps officially entitled players working through a
        // short outage without making revocation permanently ineffective.
        // Temp-only grants cannot be extended past the real cutoff.
        expiresAt: singleplayerEntitled
          ? new Date(tempOnly ? Math.min(graceEnd, tempExpiresMs) : graceEnd).toISOString()
          : null,
      },
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
