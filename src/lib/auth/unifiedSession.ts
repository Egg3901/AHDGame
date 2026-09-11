import type { Db } from "mongodb";
import type { UserPayload } from "@/lib/auth";

export function isUnifiedPayload(payload: UserPayload): boolean {
  return payload.authSource === "unified" && typeof payload.sid === "string";
}

export async function unifiedSessionIsCurrent(db: Db, payload: UserPayload): Promise<boolean> {
  if (!isUnifiedPayload(payload)) return false;
  const session = await db
    .collection<{ _id: string; userId: string; revokedAt: Date | null; expiresAt: Date }>(
      "unifiedSessions"
    )
    .findOne({
      _id: payload.sid,
      userId: payload.userId,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
  return session !== null;
}
