import { NextResponse } from "next/server";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import type { User } from "@/lib/db/types";
import { isPatreonActive } from "@/lib/db/types";
import { ObjectId } from "mongodb";

/** The desktop client uses this same-origin response to confirm its WebView session. */
export async function GET() {
  const auth = await requireBasicAuth();
  if (!auth.ok) return auth.response;

  const db = await getDb();
  const user = await db
    .collection<User>("users")
    .findOne(
      { _id: new ObjectId(auth.user.userId) },
      { projection: { displayName: 1, username: 1, patreonTier: 1, patreonExpiresAt: 1 } }
    );
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 401 });

  return NextResponse.json(
    {
      linked: true,
      displayName: user.displayName || user.username,
      supporter: isPatreonActive(user.patreonTier ?? null, user.patreonExpiresAt ?? null),
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
