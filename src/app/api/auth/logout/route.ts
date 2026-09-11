import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { handleRouteError } from "@/lib/api/errors";
import { verifyAuth, clearAuthCookie } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { getClientIp } from "@/lib/utils/network";
import { invalidateCachedUser } from "@/lib/auth/userDocCache";
import { ObjectId } from "mongodb";
import { recordAudit } from "@/lib/audit/recordAudit";
import { classifyDevice } from "@/lib/utils/userAgent";
import { createHash } from "crypto";

/** Partially redact an IP for display in forensic surfaces — never store the
 * raw address in `actionAuditLog.net` (plan §3.1 "net" doc-comment). */
function maskIp(ip: string): string {
  if (!ip || ip === "unknown") return "unknown";
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return `${parts.slice(0, 3).join(":")}::`;
  }
  const parts = ip.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.xxx` : "unknown";
}

/** One-way hash so alt-detection can still match "same IP" across rows
 * without a second copy of the raw address anywhere in the audit spine. */
function hashIp(ip: string): string | undefined {
  if (!ip || ip === "unknown") return undefined;
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

// POST /api/auth/logout — Clears the auth cookie. Clients should navigate to / after success.
// Auth: public
// Errors: 503
export async function POST(request: Request) {
  try {
    // Read auth payload and session context before clearing the cookie so we can
    // record the logout (mirrors the context the login routes capture).
    const payload = await verifyAuth();
    const clientIp = await getClientIp();
    const userAgent = request.headers.get("user-agent") ?? undefined;
    const trackingId = (await cookies()).get("__ahd_track")?.value;

    // Confirm account-wide revocation before reporting successful logout.
    // Activity logging is best effort; the security write is not.
    if (payload) {
      const userId = new ObjectId(payload.userId);
      invalidateCachedUser(payload.userId);
      let db;
      try {
        db = await getDb();
        const now = new Date();
        const result = await db
          .collection("users")
          .updateOne({ _id: userId }, { $max: { authRevokedAt: now }, $set: { lastLogout: now } });
        if (result.acknowledged !== true) throw new Error("Revocation was not acknowledged");
        if (payload.authSource === "unified" && payload.sid) {
          const sessionResult = await db
            .collection<{ _id: string; userId: string; revokedAt: Date | null }>("unifiedSessions")
            .updateOne(
              { _id: payload.sid, userId: payload.userId, revokedAt: null },
              { $set: { revokedAt: now } }
            );
          if (sessionResult.acknowledged !== true)
            throw new Error("Session revocation was not acknowledged");
        }
      } catch {
        return NextResponse.json(
          { error: "Logout is temporarily unavailable. Please try again." },
          { status: 503, headers: { "Cache-Control": "private, no-store" } }
        );
      }
      // A concurrent read may have repopulated this process's cache while
      // the database write was pending. Evict again after acknowledgment.
      invalidateCachedUser(payload.userId);
      void db
        .collection("activityLog")
        .insertOne({
          type: "logout",
          timestamp: new Date(),
          userId,
          username: payload.username,
          ipAddress: clientIp ?? undefined,
          userAgent,
          trackingId: trackingId || undefined,
        })
        .catch(() => {});

      recordAudit({
        source: "api",
        category: "auth",
        action: "auth.logout",
        subject: { type: "user", id: userId, name: payload.username },
        net: {
          ipMasked: maskIp(clientIp),
          ipHash: hashIp(clientIp),
          trackingId,
          uaClass: classifyDevice(userAgent),
        },
        outcome: "ok",
      });
    }

    await clearAuthCookie("user_logout");
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
