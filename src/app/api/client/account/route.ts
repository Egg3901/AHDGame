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
        username: 1,
        patreonTier: 1,
        patreonExpiresAt: 1,
        singleplayerEntitledAt: 1,
      },
    }
  );
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 401 });
  const supporter = isPatreonActive(user.patreonTier ?? null, user.patreonExpiresAt ?? null);
  const singleplayerEntitled =
    Boolean(user.singleplayerEntitledAt) || (supporter && isPlusOrBetter(user.patreonTier ?? null));

  return NextResponse.json(
    {
      linked: true,
      displayName: user.displayName || user.username,
      supporter,
      singleplayer: {
        entitled: singleplayerEntitled,
        // A bounded cache keeps officially entitled players working through a
        // short outage without making revocation permanently ineffective.
        expiresAt: singleplayerEntitled
          ? new Date(Date.now() + OFFLINE_ENTITLEMENT_GRACE_MS).toISOString()
          : null,
      },
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
